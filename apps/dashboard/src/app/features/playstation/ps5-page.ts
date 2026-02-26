import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  LucideAngularModule,
  Gamepad2, WifiOff, Trophy, Clock, User, Star,
} from 'lucide-angular';
import { NexusService } from '../../core/services/nexus.service';
import { StatusBadge } from '../../shared/components/status-badge/status-badge';
import { PsnPresence } from '@nexus/shared-types';

@Component({
  selector: 'app-ps5-page',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, StatusBadge],
  templateUrl: './ps5-page.html',
  styleUrl: './ps5-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Ps5Page {
  private readonly nexus = inject(NexusService);

  readonly psn   = this.nexus.psnStatus;
  readonly icons = { Gamepad2, WifiOff, Trophy, Clock, User, Star };

  presenceLabel(p: PsnPresence): string {
    switch (p) {
      case 'ingame':  return 'En jeu';
      case 'online':  return 'En ligne';
      case 'away':    return 'Absent';
      default:        return 'Hors ligne';
    }
  }

  badgeStatus(): 'playing' | 'running' | 'stopped' | 'error' {
    const hasData = !!(this.psn().profile || this.psn().recentGames?.length);
    if (!hasData)                                      return 'error';
    const p = this.psn().profile?.presence;
    if (p === 'ingame')                                return 'playing';
    if (p === 'online' || p === 'away')                return 'running';
    return 'stopped';
  }

  /** Convert ISO 8601 duration (PT12H30M) to human-readable */
  formatDuration(iso: string): string {
    const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!m) return iso;
    const h  = parseInt(m[1] ?? '0', 10);
    const mn = parseInt(m[2] ?? '0', 10);
    if (h > 0) return `${h}h${mn > 0 ? mn + 'm' : ''}`;
    if (mn > 0) return `${mn} min`;
    return '<1 min';
  }

  formatDate(iso: string): string {
    try {
      return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch { return ''; }
  }

  onImgError(e: Event): void {
    const img = e.target as HTMLImageElement;
    img.style.display = 'none';
    img.parentElement?.classList.remove('has-img');
  }
}
