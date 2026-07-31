import {
  Component, ChangeDetectionStrategy, inject, signal, computed, OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { PageHeaderComponent } from '../../shared/page-header/page-header';
import {
  LucideAngularModule,
  Plane, CalendarDays, Pencil, MessageSquare, Plus, X, Check,
  Clock, Circle, Trash2, ChevronDown, Sparkles,
} from 'lucide-angular';
import {
  ImmigrationOverview, ApplicantProgress, RequiredDocument, DocComment,
  DocStatus, DOC_STATUS_LABELS,
} from '@nexus/shared-types';

const STATUSES: { value: DocStatus; label: string }[] = [
  { value: 'not_provided', label: DOC_STATUS_LABELS.not_provided },
  { value: 'in_progress',  label: DOC_STATUS_LABELS.in_progress  },
  { value: 'provided',     label: DOC_STATUS_LABELS.provided     },
];

@Component({
  selector: 'app-immigration-page',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule, PageHeaderComponent],
  templateUrl: './immigration-page.html',
  styleUrl: './immigration-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ImmigrationPage implements OnInit {
  private readonly http = inject(HttpClient);

  readonly icons = {
    Plane, CalendarDays, Pencil, MessageSquare, Plus, X, Check,
    Clock, Circle, Trash2, ChevronDown, Sparkles,
  };
  readonly statuses = STATUSES;

  // ── State ────────────────────────────────────────────────────────────────
  readonly overview   = signal<ImmigrationOverview | null>(null);
  readonly loading    = signal(true);

  readonly editingDeadline = signal(false);
  deadlineDraft = '';

  /** Document dont le panneau de commentaires est ouvert. */
  readonly commentDoc = signal<RequiredDocument | null>(null);
  readonly comments   = signal<DocComment[]>([]);
  readonly commentsLoading = signal(false);
  newComment = '';

  // ── Computeds ──────────────────────────────────────────────────────────────
  readonly daysLeft = computed(() => {
    const ov = this.overview();
    if (!ov) return null;
    const target = new Date(ov.deadline + 'T12:00:00');
    const today  = new Date();
    today.setHours(12, 0, 0, 0);
    return Math.round((target.getTime() - today.getTime()) / 86_400_000);
  });

  /** green > 30j · orange 10–30j · red < 10j (ou dépassé) */
  readonly urgency = computed<'green' | 'orange' | 'red'>(() => {
    const d = this.daysLeft();
    if (d === null) return 'green';
    if (d < 10)  return 'red';
    if (d <= 30) return 'orange';
    return 'green';
  });

  readonly globalPercent = computed(() => {
    const ov = this.overview();
    if (!ov || ov.totalRequired === 0) return 0;
    return Math.round((ov.totalProvided / ov.totalRequired) * 100);
  });

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.http.get<ImmigrationOverview>('/api/immigration/overview').subscribe({
      next: ov => { this.overview.set(ov); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  // ── Progression par personne ─────────────────────────────────────────────
  percentFor(a: ApplicantProgress): number {
    return a.requiredTotal === 0 ? 0 : Math.round((a.requiredProvided / a.requiredTotal) * 100);
  }

  requiredDocs(a: ApplicantProgress): RequiredDocument[] {
    return a.documents.filter(d => d.category === 'required');
  }

  optionalDocs(a: ApplicantProgress): RequiredDocument[] {
    return a.documents.filter(d => d.category === 'optional');
  }

  // ── Statut ─────────────────────────────────────────────────────────────────
  setStatus(doc: RequiredDocument, status: DocStatus): void {
    if (doc.status === status) return;
    const previous = doc.status;
    this.patchDocLocally(doc.id, status);   // feedback optimiste immédiat
    this.http.patch<RequiredDocument>(`/api/immigration/documents/${doc.id}/status`, { status })
      .subscribe({ error: () => this.patchDocLocally(doc.id, previous) });
  }

  private patchDocLocally(id: number, status: DocStatus): void {
    this.overview.update(ov => {
      if (!ov) return ov;
      const applicants = ov.applicants.map(a => ({
        ...a,
        documents: a.documents.map(d => d.id === id ? { ...d, status } : d),
      }));
      // recompute counters
      let totalProvided = 0;
      for (const a of applicants) {
        const req = a.documents.filter(d => d.category === 'required');
        a.requiredProvided   = req.filter(d => d.status === 'provided').length;
        a.requiredInProgress = req.filter(d => d.status === 'in_progress').length;
        totalProvided += a.requiredProvided;
      }
      return { ...ov, applicants, totalProvided };
    });
  }

  // ── Échéance ─────────────────────────────────────────────────────────────
  startEditDeadline(): void {
    this.deadlineDraft = this.overview()?.deadline ?? '';
    this.editingDeadline.set(true);
  }

  saveDeadline(): void {
    const deadline = this.deadlineDraft;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline)) return;
    this.http.put<{ deadline: string }>('/api/immigration/deadline', { deadline }).subscribe({
      next: res => {
        this.overview.update(ov => ov ? { ...ov, deadline: res.deadline } : ov);
        this.editingDeadline.set(false);
      },
    });
  }

  // ── Commentaires ─────────────────────────────────────────────────────────
  openComments(doc: RequiredDocument): void {
    this.commentDoc.set(doc);
    this.comments.set([]);
    this.newComment = '';
    this.commentsLoading.set(true);
    this.http.get<DocComment[]>(`/api/immigration/documents/${doc.id}/comments`).subscribe({
      next: c => { this.comments.set(c); this.commentsLoading.set(false); },
      error: () => this.commentsLoading.set(false),
    });
  }

  closeComments(): void {
    this.commentDoc.set(null);
  }

  addComment(): void {
    const doc = this.commentDoc();
    const text = this.newComment.trim();
    if (!doc || !text) return;
    this.http.post<DocComment>(`/api/immigration/documents/${doc.id}/comments`, { text }).subscribe({
      next: c => {
        this.comments.update(list => [c, ...list]);
        this.newComment = '';
        this.bumpCommentCount(doc.id, 1);
      },
    });
  }

  deleteComment(c: DocComment): void {
    const doc = this.commentDoc();
    if (!doc) return;
    this.http.delete(`/api/immigration/comments/${c.id}`).subscribe({
      next: () => {
        this.comments.update(list => list.filter(x => x.id !== c.id));
        this.bumpCommentCount(doc.id, -1);
      },
    });
  }

  private bumpCommentCount(id: number, delta: number): void {
    this.overview.update(ov => {
      if (!ov) return ov;
      return {
        ...ov,
        applicants: ov.applicants.map(a => ({
          ...a,
          documents: a.documents.map(d =>
            d.id === id ? { ...d, commentCount: Math.max(0, d.commentCount + delta) } : d),
        })),
      };
    });
    // garde le doc du panneau synchro pour le compteur d'en-tête
    this.commentDoc.update(d => d && d.id === id
      ? { ...d, commentCount: Math.max(0, d.commentCount + delta) } : d);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  avatarInitial(id: string): string { return id === 'alexis' ? 'A' : 'M'; }
  avatarClass(id: string): string   { return `avatar-${id}`; }

  daysLabel(): string {
    const d = this.daysLeft();
    if (d === null) return '—';
    if (d < 0)  return `${Math.abs(d)} j`;
    return `${d}`;
  }

  deadlineDisplay(iso: string): string {
    return new Date(iso + 'T12:00:00').toLocaleDateString('fr-CA', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
  }

  commentDate(iso: string): string {
    // SQLite renvoie "YYYY-MM-DD HH:MM:SS" en UTC
    const d = new Date(iso.replace(' ', 'T') + 'Z');
    return d.toLocaleDateString('fr-CA', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  }
}
