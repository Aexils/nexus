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
    if (h > 0) return mn > 0 ? `${h}h ${mn}min` : `${h}h`;
    if (mn > 0) return `${mn} min`;
    return '<1 min';
  }

  formatDate(iso: string): string {
    try {
      return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch { return ''; }
  }

  formatRelative(iso: string): string {
    try {
      const diff = Date.now() - new Date(iso).getTime();
      const m = Math.floor(diff / 60_000);
      if (m < 1)   return "à l'instant";
      if (m < 60)  return `il y a ${m} min`;
      const h = Math.floor(m / 60);
      if (h < 24)  return `il y a ${h}h`;
      const d = Math.floor(h / 24);
      if (d === 1) return 'hier';
      if (d < 7)   return `il y a ${d} jours`;
      return this.formatDate(iso);
    } catch { return ''; }
  }

  /** Find stats (playCount, playDuration) for the current game from recentGames */
  currentGameStats(): { playCount?: number; playDuration?: string } | null {
    const cg = this.psn().currentGame;
    if (!cg) return null;
    const match = this.psn().recentGames?.find(g => g.titleId === cg.titleId);
    return match ? { playCount: match.playCount, playDuration: match.playDuration } : null;
  }

  formatPlatform(platform?: string): string {
    if (!platform) return '';
    const p = platform.toLowerCase();
    if (p.startsWith('ps5')) return 'PS5';
    if (p.startsWith('ps4')) return 'PS4';
    if (p.startsWith('ps3')) return 'PS3';
    if (p.startsWith('ps2')) return 'PS2';
    if (p.startsWith('ps1') || p === 'ps_game') return 'PS1';
    if (p.includes('vita')) return 'PS Vita';
    return platform.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  onImgError(e: Event): void {
    const img = e.target as HTMLImageElement;
    img.style.display = 'none';
    img.parentElement?.classList.remove('has-img');
  }
}
