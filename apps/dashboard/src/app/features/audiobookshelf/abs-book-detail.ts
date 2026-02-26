import { Component, ChangeDetectionStrategy, inject, computed, OnInit } from '@angular/core';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import {
  LucideAngularModule,
  ArrowLeft, Headphones, Mic, CalendarDays,
  Clock3, CheckCheck, BookOpen, TrendingUp,
} from 'lucide-angular';
import { NexusService } from '../../core/services/nexus.service';

const COVER_GRADIENTS = [
  ['#667eea', '#764ba2'], ['#f97316', '#d97706'], ['#22d3ee', '#3b82f6'],
  ['#22c55e', '#16a34a'], ['#ec4899', '#db2777'], ['#8b5cf6', '#7c3aed'],
  ['#f43f5e', '#e11d48'], ['#06b6d4', '#0284c7'],
];

@Component({
  selector: 'app-abs-book-detail',
  standalone: true,
  imports: [CommonModule, RouterLink, LucideAngularModule],
  templateUrl: './abs-book-detail.html',
  styleUrl: './abs-book-detail.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AbsBookDetail implements OnInit {
  private readonly route = inject(ActivatedRoute);
  readonly nexus = inject(NexusService);

  readonly icons = { ArrowLeft, Headphones, Mic, CalendarDays, Clock3, CheckCheck, BookOpen, TrendingUp };

  readonly book = computed(() => {
    const id = this.route.snapshot.paramMap.get('id');
    return this.nexus.absLibrary().find(b => b.id === id) ?? null;
  });

  readonly loading = this.nexus.absLibraryLoading;

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

  formatDuration(sec: number): string {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return h > 0 ? `${h}h ${m > 0 ? m + 'm' : ''}`.trim() : `${m}m`;
  }

  remaining(current: number, duration: number): string {
    const r = duration - current;
    const h = Math.floor(r / 3600);
    const m = Math.floor((r % 3600) / 60);
    return h > 0 ? `-${h}h ${m}m restant` : `-${m}m restant`;
  }

  getInitials(title: string): string {
    return title.split(/\s+/).slice(0, 2).map(w => w[0] ?? '').join('').toUpperCase();
  }

  getGradient(title: string): string {
    const code = (title.charCodeAt(0) ?? 65) + (title.charCodeAt(1) ?? 65);
    const [a, b] = COVER_GRADIENTS[code % COVER_GRADIENTS.length];
    return `linear-gradient(150deg, ${a} 0%, ${b} 100%)`;
  }

  coverUrl(id: string): string { return `/api/abs/cover/${id}`; }
  onImgError(e: Event): void { (e.target as HTMLImageElement).style.display = 'none'; }
}
