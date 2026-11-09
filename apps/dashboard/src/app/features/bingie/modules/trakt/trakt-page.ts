import { Component, ChangeDetectionStrategy, OnInit, inject, computed, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { NexusService } from '../../../../core/services/nexus.service';
import { PageHeaderComponent } from '../../../../shared/page-header/page-header';
import { TraktDevice, TraktTitle } from '@nexus/shared-types';
import { writeFailure } from '../../bingie-session';

// Sans ces jetons, Nexus perdrait son accès ou les sauvegardes s'arrêteraient.
const PROTECTED_DEVICES = ['nexus', 'sauvegarde-rpi5'];

@Component({
  selector: 'app-trakt-page',
  standalone: true,
  imports: [PageHeaderComponent, RouterLink],
  templateUrl: './trakt-page.html',
  styleUrl: './trakt-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TraktPage implements OnInit {
  private readonly http = inject(HttpClient);
  readonly nexus = inject(NexusService);
  readonly status = this.nexus.trakt;

  readonly reachable = computed(() => this.status()?.reachable ?? false);
  readonly alerts    = computed(() => this.status()?.alerts ?? []);
  readonly devices   = computed(() => this.status()?.devices ?? []);
  readonly missing   = computed(() => this.status()?.missing_routes ?? []);
  readonly confirming = signal<string | null>(null);
  readonly error      = signal<string | null>(null);

  readonly jellyfin  = computed(() => this.status()?.jellyfin ?? null);
  readonly loopShows = computed(() => this.status()?.loop_shows ?? []);
  readonly isLoop    = (slug: string) => this.loopShows().some(s => s.slug === slug);

  readonly query = signal('');
  readonly results = signal<TraktTitle[] | null>(null);
  readonly hidden = signal<TraktTitle[]>([]);
  readonly isHidden = (tmdb: number) => this.hidden().some(s => s.tmdb === tmdb);

  ngOnInit(): void {
    void this.loadHidden();
  }

  // --- Recherche, boucle, masquage ---

  async search(): Promise<void> {
    const query = this.query().trim();
    if (!query) return;
    await this.attempt('Recherche impossible', async () => {
      const params = { q: query };
      this.results.set(await firstValueFrom(this.http.get<TraktTitle[]>('/api/trakt/search', { params })));
    });
  }

  async setLoop(slug: string, loop: boolean): Promise<void> {
    const url = `/api/trakt/shows/${encodeURIComponent(slug)}/loop`;
    await this.attempt('Mode boucle impossible à changer', async () => {
      await firstValueFrom(loop ? this.http.put(url, {}) : this.http.delete(url));
    });
  }

  private async loadHidden(): Promise<void> {
    await this.attempt('Séries masquées indisponibles', async () => {
      this.hidden.set(await firstValueFrom(this.http.get<TraktTitle[]>('/api/trakt/hidden')));
    });
  }

  async setHidden(tmdb: number, hide: boolean): Promise<void> {
    await this.attempt('Masquage impossible à changer', async () => {
      const url = `/api/trakt/hidden/${tmdb}`;
      await firstValueFrom(hide ? this.http.put(url, {}) : this.http.delete(url));
      await this.loadHidden();
    });
  }

  private async attempt(message: string, action: () => Promise<void>): Promise<void> {
    this.error.set(null);
    try {
      await action();
    } catch (error) {
      this.error.set(writeFailure(error, message));
    }
  }

  isProtected(device: TraktDevice): boolean {
    return PROTECTED_DEVICES.includes(device.device);
  }

  async revoke(device: string): Promise<void> {
    this.error.set(null);
    try {
      await firstValueFrom(this.http.delete(`/api/trakt/devices/${encodeURIComponent(device)}`));
      this.confirming.set(null);
    } catch (error) {
      this.error.set(writeFailure(error, `Impossible de révoquer ${device}`));
    }
  }

  /** "à l'instant" / "12 min" / "3 h" / "2 j". */
  ago(iso: string | null): string {
    if (!iso) return 'jamais';
    const sec = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
    if (sec < 60) return 'à l\'instant';
    if (sec < 3600) return `il y a ${Math.floor(sec / 60)} min`;
    if (sec < 86400) return `il y a ${Math.floor(sec / 3600)} h`;
    return `il y a ${Math.floor(sec / 86400)} j`;
  }
}
