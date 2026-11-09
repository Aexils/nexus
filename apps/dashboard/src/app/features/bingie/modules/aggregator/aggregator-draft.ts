import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, effect, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AggregatorError, AggregatorPreferencesState, AggregatorPreview } from '@nexus/shared-types';
import { BingieUnsaved } from '../../bingie-unsaved';
import { ApiError, PreferencesApi, PreferencesStore } from './preferences-store';

/** Brouillon des préférences, hors de la page : il survit à la navigation entre modules Bingie. */
@Injectable({ providedIn: 'root' })
export class AggregatorDraft {
  private readonly http = inject(HttpClient);
  /** Révision : la page relit le magasin (objets mutables) quand elle change. */
  readonly rev = signal(0);
  readonly store = new PreferencesStore(this.api(), () => this.rev.update(n => n + 1));
  private loaded = false;

  constructor() {
    const unsaved = inject(BingieUnsaved);
    effect(() => { this.rev(); unsaved.set('sources', this.store.dirty); });
  }

  /** Premier affichage : chargement ; retour sur la page avec un brouillon : rien n'est perdu. */
  async open(): Promise<void> {
    if (this.loaded && this.store.dirty) return;
    await this.store.load();
    this.loaded = true;
  }

  api(): PreferencesApi {
    const call = async <T>(request: () => Promise<T>): Promise<T> => {
      try {
        return await request();
      } catch (error) {
        if (error instanceof HttpErrorResponse) {
          const body = (error.error && typeof error.error === 'object' ? error.error : { status: 'unavailable' }) as AggregatorError;
          throw new ApiError(error.status, body);
        }
        throw error;
      }
    };
    return {
      get: () => call(() => firstValueFrom(this.http.get<AggregatorPreferencesState>('/api/aggregator/preferences'))),
      // Jeton anti-CSRF ajouté par l'intercepteur Bingie (session commune).
      put: (version, preferences) => call(() => firstValueFrom(this.http.put<AggregatorPreferencesState>(
        '/api/aggregator/preferences', { version, preferences }))),
      preview: request => call(() => firstValueFrom(this.http.post<AggregatorPreview>('/api/aggregator/preview', request))),
    };
  }
}
