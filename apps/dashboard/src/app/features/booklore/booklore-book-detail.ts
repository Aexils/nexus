import {
  Component, ChangeDetectionStrategy, inject, computed,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import {
  LucideAngularModule,
  BookOpen, ChevronLeft, CheckCheck, User, Tag, Building2, Calendar, FileText,
} from 'lucide-angular';
import { NexusService } from '../../core/services/nexus.service';

const COVER_GRADIENTS = [
  ['#7c3aed', '#5b21b6'], ['#2563eb', '#1d4ed8'], ['#0891b2', '#0e7490'],
  ['#059669', '#047857'], ['#d97706', '#b45309'], ['#dc2626', '#b91c1c'],
  ['#db2777', '#be185d'], ['#7c3aed', '#a21caf'],
];

@Component({
  selector: 'app-booklore-book-detail',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  templateUrl: './booklore-book-detail.html',
  styleUrl: './booklore-book-detail.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BookloreBookDetail {
  private readonly route  = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly nexus          = inject(NexusService);

  readonly icons = { BookOpen, ChevronLeft, CheckCheck, User, Tag, Building2, Calendar, FileText };

  readonly bookId = parseInt(this.route.snapshot.paramMap.get('id') ?? '0', 10);

  readonly book = computed(() =>
    this.nexus.bookloreLibrary().find(b => b.id === this.bookId),
  );

  getGradient(title: string): string {
    const code = (title.charCodeAt(0) ?? 65) + (title.charCodeAt(1) ?? 65);
    const [a, b] = COVER_GRADIENTS[code % COVER_GRADIENTS.length];
    return `linear-gradient(150deg, ${a} 0%, ${b} 100%)`;
  }

  getInitials(title: string): string {
    return title.split(/\s+/).slice(0, 2).map(w => w[0] ?? '').join('').toUpperCase();
  }

  coverUrl(id: number): string { return `/api/booklore/cover/${id}`; }
  onImgError(e: Event): void   { (e.target as HTMLImageElement).style.display = 'none'; }

  back(): void { this.router.navigate(['/booklore']); }
}
