import { Component, ChangeDetectionStrategy, inject, computed, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { NexusService } from '../../core/services/nexus.service';
import { PageHeaderComponent } from '../../shared/page-header/page-header';
import { TraktDevice } from '@nexus/shared-types';

// Sans ces jetons, Nexus perdrait son accès ou les sauvegardes s'arrêteraient.
const PROTECTED_DEVICES = ['nexus', 'sauvegarde-rpi5'];

@Component({
  selector: 'app-trakt-page',
  standalone: true,
  imports: [PageHeaderComponent],
  templateUrl: './trakt-page.html',
  styleUrl: './trakt-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TraktPage {
  private readonly http = inject(HttpClient);
  readonly nexus = inject(NexusService);
  readonly status = this.nexus.trakt;

  readonly reachable = computed(() => this.status()?.reachable ?? false);
  readonly alerts    = computed(() => this.status()?.alerts ?? []);
  readonly devices   = computed(() => this.status()?.devices ?? []);
  readonly missing   = computed(() => this.status()?.missing_routes ?? []);
  readonly confirming = signal<string | null>(null);
  readonly error      = signal<string | null>(null);

  isProtected(device: TraktDevice): boolean {
    return PROTECTED_DEVICES.includes(device.device);
  }

  async revoke(device: string): Promise<void> {
    this.error.set(null);
    try {
      await firstValueFrom(this.http.delete(`/api/trakt/devices/${encodeURIComponent(device)}`));
      this.confirming.set(null);
    } catch {
      this.error.set(`Impossible de révoquer ${device}`);
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
