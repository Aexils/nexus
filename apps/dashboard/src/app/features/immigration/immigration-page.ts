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
  Clock, Circle, Trash2, ChevronDown, Sparkles, Info,
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

/**
 * Explication de chaque type de document (bulle d'info), d'après le guide pvtistes.net
 * « Entrée Express » et les exigences d'IRCC. Indicatif — vérifier sur le site officiel
 * d'IRCC pour ta situation précise. Clé = `name` du document.
 */
const DOC_INFO: Record<string, string> = {
  'Études':
    "Preuve de tes études déclarées : en général l'Évaluation des Diplômes d'Études (EDE) — " +
    "numéro de référence + attestation d'un organisme agréé (IRCC la vérifie auprès de lui). " +
    "Tes diplômes/grades et relevés de notes (lycée, université) peuvent aussi être demandés.",
  "Relevé d'emploi":
    "Preuve d'une expérience déclarée : lettre de l'employeur sur papier en-tête (postes, " +
    "fonctions, période, heures/semaine, salaire, avantages), signée par ton supérieur ou le RH, " +
    "cohérente avec le code CNP déclaré. Au Canada : aussi T4 / avis de cotisation. " +
    "Travailleur autonome : preuves de statut, de revenus et de clients.",
  'Preuve de ressources financières suffisantes':
    "Preuve de fonds : lettre de ta banque (en-tête, tes numéros de comptes, dates d'ouverture, " +
    "solde actuel et solde moyen des 6 derniers mois, dettes/emprunts). Non exigée si tu es déjà au " +
    "Canada avec un permis de travail, avec une offre d'emploi valide, ou via la Catégorie de " +
    "l'expérience canadienne.",
  'Certificat de police':
    "Extrait de casier judiciaire pour chaque pays où tu as vécu 6 mois consécutifs ou plus depuis " +
    "tes 18 ans. Celui de ton pays de résidence actuel doit dater de moins de 6 mois. Anticipe : " +
    "certains pays sont longs. Exemptions IRCC : séjours < 6 mois, avant 18 ans, ou il y a plus de 20 ans.",
  'Photographie':
    "2 photos d'identité numériques aux normes IRCC pour résidents permanents (pas de photomaton), " +
    "prises chez un photographe pro dans les 6 derniers mois. Garde le reçu daté. Mieux vaut attendre " +
    "l'invitation (validité 6 mois).",
  'Passeports / titres de voyage':
    "Copie des pages d'identification de ton passeport, valide et à jour. Anticipe un renouvellement " +
    "si l'expiration approche, sous peine de retards.",
  "Preuve d'examen médical préalable":
    "Confirmation d'une visite médicale chez un médecin désigné par IRCC (liste sur leur site). " +
    "Valide moins d'un an, ~250–300 €, non remboursée. À faire AVANT de soumettre la demande. Tous " +
    "les membres de la famille doivent la passer, même les enfants à charge non accompagnants.",
  "Déclaration officielle d'union de fait":
    "Formulaire IMM 5409, à remplir si tu te déclares en union de fait, avec preuve de vie commune " +
    "depuis au moins 12 mois : comptes conjoints, bail ou acte commun, factures (eau, électricité) " +
    "aux deux noms.",
  "Document d'identité national":
    "Copie de ta ou tes pièces d'identité nationales (carte d'identité), en complément du passeport.",
  'Renseignements du client':
    "Renseignements personnels complémentaires demandés via ton compte IRCC (adresses successives, " +
    "voyages, historique familial…). Si tu recours à un représentant en immigration agréé, tu le " +
    "déclares avec le formulaire IMM 5476 (et IMM 5475 pour l'autorisation de communiquer tes " +
    "renseignements).",
};

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
    Clock, Circle, Trash2, ChevronDown, Sparkles, Info,
  };
  readonly statuses = STATUSES;

  /** Texte de la bulle d'info d'un document (par son intitulé), ou null si aucun. */
  docInfo(name: string): string | null {
    return DOC_INFO[name] ?? null;
  }

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
