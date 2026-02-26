import {
  Component,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  inject,
  OnInit,
  OnDestroy,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  LucideAngularModule,
  Star, Users, Clapperboard, Tv, Music2,
  Building2, WifiOff, MonitorPlay,
} from 'lucide-angular';
import { NexusService } from '../../core/services/nexus.service';
import { StatusBadge } from '../../shared/components/status-badge/status-badge';
import { KodiNowPlaying } from '@nexus/shared-types';

@Component({
  selector: 'app-kodi-page',
  standalone: true,
  imports: [CommonModule, StatusBadge, LucideAngularModule],
  templateUrl: './kodi-page.html',
  styleUrl: './kodi-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class KodiPage implements OnInit, OnDestroy {
  private readonly cdr = inject(ChangeDetectorRef);
  readonly nexus = inject(NexusService);
  private intervals: ReturnType<typeof setInterval>[] = [];

  readonly kodiStatus = this.nexus.kodiStatus;
  readonly icons = { Star, Users, Clapperboard, Tv, Music2, Building2, WifiOff, MonitorPlay };

  positionSec = signal(0);
  artLoaded   = signal(false);
  artFailed   = signal(false);
  private lastWsPositionSec = 0;
  private lastWsTimestamp   = 0;
  private lastTrackedTitle  = '';

  get kodiConnected(): boolean { return this.kodiStatus().connected; }
  get np(): KodiNowPlaying | null { return this.kodiStatus().nowPlaying; }
  get isPlaying(): boolean { return !!this.np && !this.np.paused; }
  get volume():    number  { return this.np?.volume ?? 0; }

  get progressPercent(): number {
    const dur = this.np?.durationSec ?? 0;
    if (!dur) return 0;
    return Math.min((this.positionSec() / dur) * 100, 100);
  }

  typeLabel(type: string): string {
    const labels: Record<string, string> = {
      movie: 'Film', episode: 'Série', music: 'Musique', none: '',
    };
    return labels[type] ?? type;
  }

  formatTime(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
  }

  artUrl(np: KodiNowPlaying): string | null {
    const raw = np.art?.poster || np.art?.thumb || np.thumbnail;
    if (!raw) return null;
    return `/api/kodi/art?url=${encodeURIComponent(raw)}`;
  }

  onArtLoad():  void { this.artLoaded.set(true); }
  onArtError(): void { this.artFailed.set(true); }

  ratingStars(rating: number): number[] {
    return Array.from({ length: 5 }, (_, i) => i < Math.round(rating / 2) ? 1 : 0);
  }

  seekClick(event: MouseEvent): void {
    const target = event.currentTarget as HTMLElement;
    const rect   = target.getBoundingClientRect();
    const ratio  = (event.clientX - rect.left) / rect.width;
    const dur    = this.np?.durationSec ?? 0;
    if (!dur) return;
    this.nexus.seek(Math.round(ratio * dur));
  }

  togglePlayback(): void { this.nexus.playPause(); }
  stop():           void { this.nexus.stop(); }

  ngOnInit(): void {
    this.intervals.push(setInterval(() => {
      const np = this.kodiStatus().nowPlaying;
      if (!np) return;

      // Reset art state when track changes
      if (np.title !== this.lastTrackedTitle) {
        this.lastTrackedTitle = np.title;
        this.artLoaded.set(false);
        this.artFailed.set(false);
      }

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
