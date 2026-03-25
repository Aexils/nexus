import {
  Component, ChangeDetectionStrategy, inject,
  computed, signal, OnInit,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import {
  LucideAngularModule,
  BookOpen, Search, WifiOff, CheckCheck, Clock3, BookMarked, ChevronRight, User,
} from 'lucide-angular';
import { NexusService } from '../../core/services/nexus.service';
import { StatusBadge } from '../../shared/components/status-badge/status-badge';
import { BookloreBook } from '@nexus/shared-types';
import { UserService } from '../../core/services/user.service';

interface AuthorGroup { name: string; items: BookloreBook[]; }

const COVER_GRADIENTS = [
  ['#7c3aed', '#5b21b6'], ['#2563eb', '#1d4ed8'], ['#0891b2', '#0e7490'],
  ['#059669', '#047857'], ['#d97706', '#b45309'], ['#dc2626', '#b91c1c'],
  ['#db2777', '#be185d'], ['#7c3aed', '#a21caf'],
];

@Component({
  selector: 'app-booklore-page',
  standalone: true,
  imports: [CommonModule, RouterLink, StatusBadge, LucideAngularModule],
  templateUrl: './booklore-page.html',
  styleUrl: './booklore-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BooklorePage implements OnInit {
  readonly nexus     = inject(NexusService);
  readonly userSvc   = inject(UserService);

  readonly bookloreStatus = this.nexus.bookloreStatus;
  readonly library        = this.nexus.bookloreLibrary;
  readonly libraryLoading = this.nexus.bookloreLibraryLoading;

  readonly icons = { BookOpen, Search, WifiOff, CheckCheck, Clock3, BookMarked, ChevronRight, User };

  get connected()      { return this.bookloreStatus().connected; }
  get currentlyReading(){ return this.bookloreStatus().currentlyReading; }
  get totalBooks()     { return this.bookloreStatus().totalBooks ?? 0; }

  readonly searchQuery = signal('');

  readonly filteredLibrary = computed<BookloreBook[]>(() => {
    const q = this.searchQuery().toLowerCase().trim();
    if (!q) return this.library();
    return this.library().filter(b =>
      b.title.toLowerCase().includes(q) ||
      b.authors.some(a => a.toLowerCase().includes(q)) ||
      (b.seriesName?.toLowerCase().includes(q) ?? false) ||
      b.categories.some(c => c.toLowerCase().includes(q)),
    );
  });

  readonly authorGroups = computed<AuthorGroup[]>(() => {
    const groups = new Map<string, BookloreBook[]>();
    for (const item of this.filteredLibrary()) {
      const key = item.authors[0] ?? '—';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(item);
    }
    for (const items of groups.values()) {
      items.sort((a, b) => a.title.localeCompare(b.title, 'fr'));
    }
    return [...groups.entries()]
      .sort(([a], [b]) => {
        if (a === '—') return 1;
        if (b === '—') return -1;
        return a.localeCompare(b, 'fr');
      })
      .map(([name, items]) => ({ name, items }));
  });

  ngOnInit() { this.nexus.loadBookloreLibrary(); }

  getInitials(title: string): string {
    return title.split(/\s+/).slice(0, 2).map(w => w[0] ?? '').join('').toUpperCase();
  }

  getGradient(title: string): string {
    const code = (title.charCodeAt(0) ?? 65) + (title.charCodeAt(1) ?? 65);
    const [a, b] = COVER_GRADIENTS[code % COVER_GRADIENTS.length];
    return `linear-gradient(150deg, ${a} 0%, ${b} 100%)`;
  }

  coverUrl(id: number): string { return `/api/booklore/cover/${id}`; }
  onImgError(e: Event): void   { (e.target as HTMLImageElement).style.display = 'none'; }

  progressColor(pct: number): string {
    if (pct >= 100) return 'var(--green)';
    if (pct > 0)    return '#7c3aed';
    return 'var(--border)';
  }

  onSearch(e: Event): void {
    this.searchQuery.set((e.target as HTMLInputElement).value);
  }
}
