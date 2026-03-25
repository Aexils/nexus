import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  LucideAngularModule,
  Tv2, WifiOff, Play, Pause, Monitor, User, Clock,
  Film, Clapperboard, Search, Star,
} from 'lucide-angular';
import { NexusService } from '../../core/services/nexus.service';
import { StatusBadge } from '../../shared/components/status-badge/status-badge';
import { JellyfinLibraryItem, JellyfinSession } from '@nexus/shared-types';

type LibraryFilter = 'all' | 'Movie' | 'Series';

@Component({
  selector: 'app-jellyfin-page',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, StatusBadge],
  templateUrl: './jellyfin-page.html',
  styleUrl: './jellyfin-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JellyfinPage implements OnInit {
  readonly nexus = inject(NexusService);
  readonly icons = { Tv2, WifiOff, Play, Pause, Monitor, User, Clock, Film, Clapperboard, Search, Star };

  readonly status  = this.nexus.jellyfinStatus;
  readonly library = this.nexus.jellyfinLibrary;
  readonly loading = this.nexus.jellyfinLibraryLoading;

  readonly libraryFilter = signal<LibraryFilter>('all');
  readonly searchQuery   = signal('');

  get connected()  { return this.status().connected; }
  get sessions()   { return this.status().activeSessions; }
  get version()    { return this.status().version; }
  get serverName() { return this.status().serverName; }

  readonly filteredLibrary = computed<JellyfinLibraryItem[]>(() => {
    const filter = this.libraryFilter();
    const query  = this.searchQuery().toLowerCase().trim();
    return this.library().filter(item => {
      if (filter !== 'all' && item.type !== filter) return false;
      if (query && !item.name.toLowerCase().includes(query)) return false;
      return true;
    });
  });

  readonly movieCount  = computed(() => this.library().filter(i => i.type === 'Movie').length);
  readonly seriesCount = computed(() => this.library().filter(i => i.type === 'Series').length);

  ngOnInit() { this.nexus.loadJellyfinLibrary(); }

  setFilter(f: LibraryFilter) { this.libraryFilter.set(f); }

  onSearch(e: Event) {
    this.searchQuery.set((e.target as HTMLInputElement).value);
  }

  coverUrl(itemId: string): string {
    return `/api/jellyfin/image/${itemId}`;
  }

  progressPct(session: JellyfinSession): number {
    const rt  = session.nowPlaying?.runTimeTicks;
    const pos = session.positionTicks;
    if (!rt || !pos || rt === 0) return 0;
    return Math.min(100, Math.round((pos / rt) * 100));
  }

  formatTicks(ticks: number | undefined): string {
    if (!ticks) return '—';
    const totalSec = Math.floor(ticks / 10_000_000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  mediaTypeLabel(type: string): string {
    switch (type) {
      case 'Movie':      return 'Film';
      case 'Episode':    return 'Épisode';
      case 'MusicVideo': return 'Clip';
      case 'Audio':      return 'Musique';
      default:           return type;
    }
  }

  typeLabel(type: string): string {
    return type === 'Movie' ? 'Film' : type === 'Series' ? 'Série' : type;
  }

  ratingStars(rating?: number): string {
    if (!rating) return '';
    return (rating / 2).toFixed(1);
  }

  trackSession(_: number, s: JellyfinSession) { return s.id; }
  trackItem(_: number, i: JellyfinLibraryItem) { return i.id; }
}
