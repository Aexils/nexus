import { Component, ChangeDetectionStrategy, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  LucideAngularModule,
  Gamepad2, WifiOff, Trophy, Clock, User, Star,
  ArrowUpDown, ChevronLeft, ChevronRight,
} from 'lucide-angular';
import { NexusService } from '../../core/services/nexus.service';
import { StatusBadge } from '../../shared/components/status-badge/status-badge';
import { PsnGame, PsnPresence, PsnTrophyTitle } from '@nexus/shared-types';

type GameSort    = 'lastPlayed' | 'name' | 'playCount' | 'playTime';
type TrophySort  = 'progress' | 'name' | 'lastUpdated' | 'platinum';

const PAGE_SIZE = 10;

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
  readonly icons = { Gamepad2, WifiOff, Trophy, Clock, User, Star, ArrowUpDown, ChevronLeft, ChevronRight };

  // ── Sort + Pagination ──────────────────────────────────────────────────────

  readonly sortBy   = signal<GameSort>('lastPlayed');
  readonly page     = signal(0);

  readonly sortedGames = computed<PsnGame[]>(() => {
    const games = [...(this.psn().recentGames ?? [])];
    const sort  = this.sortBy();
    switch (sort) {
      case 'name':
        return games.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
      case 'playCount':
        return games.sort((a, b) => (b.playCount ?? 0) - (a.playCount ?? 0));
      case 'playTime':
        return games.sort((a, b) =>
          this.durationToSec(b.playDuration) - this.durationToSec(a.playDuration));
      default: // lastPlayed
        return games.sort((a, b) => {
          if (!a.lastPlayedAt && !b.lastPlayedAt) return 0;
          if (!a.lastPlayedAt) return 1;
          if (!b.lastPlayedAt) return -1;
          return new Date(b.lastPlayedAt).getTime() - new Date(a.lastPlayedAt).getTime();
        });
    }
  });

  readonly totalPages = computed(() => Math.ceil(this.sortedGames().length / PAGE_SIZE));

  readonly pagedGames = computed<PsnGame[]>(() => {
    const p = this.page();
    return this.sortedGames().slice(p * PAGE_SIZE, (p + 1) * PAGE_SIZE);
  });

  setSort(s: GameSort): void {
    this.sortBy.set(s);
    this.page.set(0);
  }

  prevPage(): void { if (this.page() > 0) this.page.update(p => p - 1); }
  nextPage(): void { if (this.page() < this.totalPages() - 1) this.page.update(p => p + 1); }

  private durationToSec(iso?: string): number {
    if (!iso) return 0;
    const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!m) return 0;
    return (parseInt(m[1] ?? '0') * 3600) + (parseInt(m[2] ?? '0') * 60) + parseInt(m[3] ?? '0');
  }

  // ── Status ────────────────────────────────────────────────────────────────

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

  readonly sortOptions: { value: GameSort; label: string }[] = [
    { value: 'lastPlayed', label: 'Dernière partie' },
    { value: 'name',       label: 'Nom' },
    { value: 'playCount',  label: 'Parties jouées' },
    { value: 'playTime',   label: 'Temps de jeu' },
  ];

  // ── Trophy sort + pagination ───────────────────────────────────────────────

  readonly trophySortBy  = signal<TrophySort>('progress');
  readonly trophyPage    = signal(0);

  readonly sortedTrophyTitles = computed<PsnTrophyTitle[]>(() => {
    const titles = [...(this.psn().trophyTitles ?? [])];
    switch (this.trophySortBy()) {
      case 'name':
        return titles.sort((a, b) => a.trophyTitleName.localeCompare(b.trophyTitleName, 'fr'));
      case 'lastUpdated':
        return titles.sort((a, b) => {
          if (!a.lastUpdatedDateTime && !b.lastUpdatedDateTime) return 0;
          if (!a.lastUpdatedDateTime) return 1;
          if (!b.lastUpdatedDateTime) return -1;
          return new Date(b.lastUpdatedDateTime).getTime() - new Date(a.lastUpdatedDateTime).getTime();
        });
      case 'platinum':
        return titles.sort((a, b) =>
          (b.earnedTrophies.platinum - a.earnedTrophies.platinum) ||
          (b.progress - a.progress));
      default: // progress
        return titles.sort((a, b) => b.progress - a.progress);
    }
  });

  readonly totalTrophyPages = computed(() => Math.ceil(this.sortedTrophyTitles().length / PAGE_SIZE));

  readonly pagedTrophyTitles = computed<PsnTrophyTitle[]>(() => {
    const p = this.trophyPage();
    return this.sortedTrophyTitles().slice(p * PAGE_SIZE, (p + 1) * PAGE_SIZE);
  });

  setTrophySort(s: TrophySort): void { this.trophySortBy.set(s); this.trophyPage.set(0); }
  prevTrophyPage(): void { if (this.trophyPage() > 0) this.trophyPage.update(p => p - 1); }
  nextTrophyPage(): void { if (this.trophyPage() < this.totalTrophyPages() - 1) this.trophyPage.update(p => p + 1); }

  readonly trophySortOptions: { value: TrophySort; label: string }[] = [
    { value: 'progress',    label: 'Complétion' },
    { value: 'name',        label: 'Nom' },
    { value: 'lastUpdated', label: 'Mis à jour' },
    { value: 'platinum',    label: 'Platine' },
  ];
}
