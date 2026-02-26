import {
  Component, ChangeDetectionStrategy, inject,
  computed, OnInit,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import {
  LucideAngularModule,
  Headphones, BookOpen, LibraryBig, CheckCheck,
  Clock3, Mic, WifiOff, BookMarked, ChevronRight,
} from 'lucide-angular';
import { NexusService } from '../../core/services/nexus.service';
import { StatusBadge } from '../../shared/components/status-badge/status-badge';
import { AbsLibraryItem } from '@nexus/shared-types';

interface SeriesGroup { name: string; items: AbsLibraryItem[]; }

const COVER_GRADIENTS = [
  ['#667eea', '#764ba2'], ['#f97316', '#d97706'], ['#22d3ee', '#3b82f6'],
  ['#22c55e', '#16a34a'], ['#ec4899', '#db2777'], ['#8b5cf6', '#7c3aed'],
  ['#f43f5e', '#e11d48'], ['#06b6d4', '#0284c7'],
];

@Component({
  selector: 'app-abs-page',
  standalone: true,
  imports: [CommonModule, RouterLink, StatusBadge, LucideAngularModule],
  templateUrl: './abs-page.html',
  styleUrl: './abs-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AbsPage implements OnInit {
  readonly nexus     = inject(NexusService);
  readonly absStatus = this.nexus.absStatus;

  readonly library        = this.nexus.absLibrary;
  readonly libraryLoading = this.nexus.absLibraryLoading;

  readonly icons = { Headphones, BookOpen, LibraryBig, CheckCheck, Clock3, Mic, WifiOff, BookMarked, ChevronRight };

  get absConnected() { return this.absStatus().connected; }
  get sessions()     { return this.absStatus().activeSessions; }

  readonly seriesGroups = computed<SeriesGroup[]>(() => {
    const groups = new Map<string, AbsLibraryItem[]>();
    for (const item of this.library()) {
      const key = item.series ?? '—';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(item);
    }
    for (const items of groups.values()) {
      items.sort((a, b) => {
        const aSeq = parseFloat(a.seriesSequence ?? '9999');
        const bSeq = parseFloat(b.seriesSequence ?? '9999');
        return aSeq - bSeq || a.title.localeCompare(b.title, 'fr');
      });
    }
    return [...groups.entries()]
      .sort(([a], [b]) => {
        if (a === '—') return 1;
        if (b === '—') return -1;
        return a.localeCompare(b, 'fr');
      })
      .map(([name, items]) => ({ name, items }));
  });

  ngOnInit() { this.nexus.loadAbsLibrary(); }

  progressPct(current: number, duration: number): number {
    return duration ? Math.min((current / duration) * 100, 100) : 0;
  }

  formatTime(sec: number): string {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60).toString().padStart(2, '0');
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
  }

  remaining(current: number, duration: number): string {
    const r = duration - current;
    const h = Math.floor(r / 3600);
    const m = Math.floor((r % 3600) / 60);
    return h > 0 ? `-${h}h ${m}m` : `-${m}m`;
  }

  getInitials(title: string): string {
    return title.split(/\s+/).slice(0, 2).map(w => w[0] ?? '').join('').toUpperCase();
  }

  getGradient(title: string): string {
    const code = (title.charCodeAt(0) ?? 65) + (title.charCodeAt(1) ?? 65);
    const [a, b] = COVER_GRADIENTS[code % COVER_GRADIENTS.length];
    return `linear-gradient(150deg, ${a} 0%, ${b} 100%)`;
  }

  coverUrl(itemId: string): string { return `/api/abs/cover/${itemId}`; }
  onImgError(e: Event): void { (e.target as HTMLImageElement).style.display = 'none'; }
}
