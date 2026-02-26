import {
  Component,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  inject,
  OnInit,
  OnDestroy,
  signal,
  computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { NexusService } from '../../core/services/nexus.service';
import { StatusBadge } from '../../shared/components/status-badge/status-badge';
import { LogLevel, LogSource } from '@nexus/shared-types';

const COVER_GRADIENTS = [
  ['#667eea', '#764ba2'], ['#f97316', '#d97706'], ['#22d3ee', '#3b82f6'],
  ['#22c55e', '#16a34a'], ['#ec4899', '#db2777'], ['#8b5cf6', '#7c3aed'],
  ['#f43f5e', '#e11d48'], ['#06b6d4', '#0284c7'],
];

type FilterLevel  = LogLevel | 'all';
type FilterSource = LogSource | 'all';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, StatusBadge],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Dashboard implements OnInit, OnDestroy {
  private readonly cdr    = inject(ChangeDetectorRef);
  private readonly router = inject(Router);
  readonly nexus = inject(NexusService);
  private intervals: ReturnType<typeof setInterval>[] = [];

  readonly kodiStatus = this.nexus.kodiStatus;
  readonly absStatus  = this.nexus.absStatus;
  readonly psnStatus  = this.nexus.psnStatus;

  positionSec = signal(0);
  private lastWsPositionSec = 0;
  private lastWsTimestamp   = 0;

  // ── Log filters ───────────────────────────────────────────────────────────
  filterLevel  = signal<FilterLevel>('all');
  filterSource = signal<FilterSource>('all');
  showDebug    = signal(false);

  readonly filteredLogs = computed(() => {
    const level  = this.filterLevel();
    const source = this.filterSource();
    const debug  = this.showDebug();
    return this.nexus.logs().filter(e =>
      (debug  || e.level !== 'debug') &&
      (level  === 'all' || e.level  === level) &&
      (source === 'all' || e.source === source),
    );
  });

  // ── Computed getters ──────────────────────────────────────────────────────

  get kodiConnected():  boolean { return this.kodiStatus().connected; }
  get absConnected():   boolean { return this.absStatus().connected; }
  get psnConnected():   boolean { return this.psnStatus().connected; }
  get psnHasData():     boolean { return !!(this.psnStatus().profile || this.psnStatus().recentGames?.length); }
  get absSessionCount(): number { return this.absStatus().activeSessions.length; }
  get connectedCount():  number { return (this.kodiConnected ? 1 : 0) + (this.absConnected ? 1 : 0) + (this.psnConnected ? 1 : 0); }
  get anyConnected():   boolean { return this.connectedCount > 0; }
  get isPlaying():      boolean { const np = this.kodiStatus().nowPlaying; return !!np && !np.paused; }

  get progressPercent(): number {
    const dur = this.kodiStatus().nowPlaying?.durationSec ?? 0;
    if (!dur) return 0;
    return Math.min((this.positionSec() / dur) * 100, 100);
  }

  // ── Navigation ────────────────────────────────────────────────────────────

  openKodi(): void { this.router.navigate(['/kodi']); }
  openAbs():  void { this.router.navigate(['/audiobookshelf']); }
  openPsn():  void { this.router.navigate(['/playstation']); }

  coverUrl(libraryItemId: string): string { return `/api/abs/cover/${libraryItemId}`; }
  onImgError(e: Event): void { (e.target as HTMLImageElement).style.display = 'none'; }

  kodiArtUrl(np: { art?: { poster?: string; thumb?: string }; thumbnail?: string }): string | null {
    const raw = np.art?.poster || np.art?.thumb || np.thumbnail;
    if (!raw) return null;
    return `/api/kodi/art?url=${encodeURIComponent(raw)}`;
  }
  onKodiArtError(e: Event): void {
    const img = e.target as HTMLImageElement;
    img.style.display = 'none';
    (img.parentElement as HTMLElement).classList.add('no-art');
  }

  sessionGradient(title: string): string {
    const code = (title.charCodeAt(0) ?? 65) + (title.charCodeAt(1) ?? 65);
    const [a, b] = COVER_GRADIENTS[code % COVER_GRADIENTS.length];
    return `linear-gradient(150deg, ${a} 0%, ${b} 100%)`;
  }

  // ── Log filter helpers ────────────────────────────────────────────────────

  setFilterLevel(level: FilterLevel):   void { this.filterLevel.set(level); }
  setFilterSource(src: FilterSource):   void { this.filterSource.set(src); }
  toggleDebug():                        void { this.showDebug.update(v => !v); }
  clearLogs():                          void { this.nexus.logs.set([]); }

  logLevelClass(level: LogLevel): string {
    return level === 'ok' ? 'ok' : level === 'warn' ? 'warn' : level === 'error' ? 'error' : level === 'debug' ? 'debug' : 'info';
  }

  logLevelLabel(level: LogLevel): string {
    return level === 'ok' ? 'OK' : level === 'debug' ? 'DBG' : level.toUpperCase();
  }

  formatTime(ts: number): string {
    return new Date(ts).toTimeString().slice(0, 8);
  }

  formatRelativeDate(iso: string): string {
    try {
      const diffDays = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
      if (diffDays === 0) return "Aujourd'hui";
      if (diffDays === 1) return 'Hier';
      if (diffDays < 7)   return `Il y a ${diffDays} jours`;
      return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
    } catch { return ''; }
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  ngOnInit(): void {
    this.intervals.push(setInterval(() => {
      const np = this.kodiStatus().nowPlaying;
      if (!np) return;
      if (np.positionSec !== this.lastWsPositionSec) {
        this.lastWsPositionSec = np.positionSec;
        this.lastWsTimestamp   = Date.now();
      }
      if (!np.paused) {
        const elapsed = (Date.now() - this.lastWsTimestamp) / 1000;
        this.positionSec.set(Math.min(Math.round(this.lastWsPositionSec + elapsed), np.durationSec));
      } else {
        this.positionSec.set(np.positionSec);
      }
      this.cdr.markForCheck();
    }, 500));
  }

  ngOnDestroy(): void {
    this.intervals.forEach(clearInterval);
  }
}
