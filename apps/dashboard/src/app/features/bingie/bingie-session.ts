import { HttpErrorResponse, HttpHandlerFn, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { catchError, firstValueFrom, throwError } from 'rxjs';
import { NexusSession } from '@nexus/shared-types';

/** API dont les ÉCRITURES exigent la session d'administration (lectures publiques). */
export const BINGIE_WRITE_APIS = ['/api/trakt/', '/api/aggregator/'];
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
/** Aperçu Aggregator : POST, mais sans rien enregistrer (lecture publique côté API). */
const READ_ONLY_POSTS = ['/api/aggregator/preview'];

export function isBingieWrite(method: string, url: string): boolean {
  const path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
  return !READ_METHODS.has(method.toUpperCase())
    && BINGIE_WRITE_APIS.some(prefix => path.startsWith(prefix))
    && !READ_ONLY_POSTS.includes(path);
}

/** Message d'un échec d'écriture : un refus de session dit quoi faire, sinon le message du module. */
export function writeFailure(error: unknown, fallback: string): string {
  if (error instanceof HttpErrorResponse
      && (error.status === 401 || (error.status === 403 && (error.error as { status?: string } | null)?.status === 'csrf'))) {
    return 'Connexion requise : connecte-toi en haut à droite, puis recommence.';
  }
  return fallback;
}

/** Session d'administration commune à tous les modules Bingie (une seule connexion). */
@Injectable({ providedIn: 'root' })
export class BingieSession {
  private readonly http = inject(HttpClient);
  readonly state = signal<NexusSession | null>(null);
  /** Une écriture a été refusée faute de session : le cadre propose la connexion. */
  readonly loginNeeded = signal(false);
  readonly error = signal<string | null>(null);
  readonly authenticated = computed(() => !!this.state()?.authenticated);
  readonly configured = computed(() => this.state()?.configured ?? false);
  readonly csrf = computed(() => this.state()?.csrf ?? null);

  async refresh(): Promise<void> {
    try {
      this.state.set(await firstValueFrom(this.http.get<NexusSession>('/api/auth/session')));
    } catch {
      this.state.set({ authenticated: false, csrf: null, configured: false });
    }
  }

  async login(password: string): Promise<boolean> {
    this.error.set(null);
    try {
      this.state.set(await firstValueFrom(this.http.post<NexusSession>('/api/auth/login', { password })));
      this.loginNeeded.set(false);
      return true;
    } catch (error) {
      const body = error instanceof HttpErrorResponse ? (error.error as { error?: string } | null) : null;
      this.error.set(body?.error ?? 'connexion impossible');
      return false;
    }
  }

  async logout(): Promise<void> {
    await firstValueFrom(this.http.post('/api/auth/logout', {})).catch(() => undefined);
    await this.refresh();
  }

  /** Appelé par l'intercepteur : session absente, expirée ou jeton anti-CSRF périmé. */
  writeRefused(): void {
    this.loginNeeded.set(true);
    void this.refresh();
  }
}

/** Ajoute le jeton anti-CSRF aux écritures Bingie ; un refus (401, ou 403 CSRF) ouvre la connexion. */
export const bingieWriteInterceptor: HttpInterceptorFn = (request: HttpRequest<unknown>, next: HttpHandlerFn) => {
  if (!isBingieWrite(request.method, request.url)) return next(request);
  const session = inject(BingieSession);
  const csrf = session.csrf();
  const sent = csrf ? request.clone({ setHeaders: { 'X-CSRF-Token': csrf } }) : request;
  return next(sent).pipe(catchError((error: unknown) => {
    if (error instanceof HttpErrorResponse
        && (error.status === 401 || (error.status === 403 && (error.error as { status?: string } | null)?.status === 'csrf'))) {
      session.writeRefused();
    }
    return throwError(() => error);
  }));
};
