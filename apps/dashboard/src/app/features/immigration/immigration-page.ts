import {
  Component, ChangeDetectionStrategy, inject, signal, computed, OnInit,
} from '@angular/core';

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
 * Explication de chaque type de document, condensée depuis les **infobulles officielles du
 * portail IRCC** relevées le 08/09/2026 sur le profil E004432006 (et non depuis un guide tiers).
 * La liste de contrôle de l'eAPR étant générée dynamiquement, ces textes font foi pour ce
 * dossier précis. Clé = `name` du document.
 */
const DOC_INFO: Record<string, string> = {
  'Études':
    "Preuve d'achèvement des études postsecondaires : un diplôme ou un grade universitaire. " +
    "Sont acceptés les formations en apprentissage, les diplômes de premier cycle (baccalauréat), " +
    "les maîtrises et les doctorats. L'évaluation des diplômes (EDE/WES) n'est pas réclamée par " +
    "cette case — elle est validée automatiquement depuis le profil Entrée Express.",
  "Relevé d'emploi":
    "Lettre de référence de l'employeur, sur papier à en-tête, portant ton nom, les coordonnées de " +
    "l'entreprise et la signature de ton supérieur immédiat. Elle doit indiquer tous les postes " +
    "occupés, et pour chacun : titre, fonctions, situation d'emploi, dates de début et de fin, " +
    "NOMBRE D'HEURES PAR SEMAINE, salaire annuel et avantages sociaux. Les relevés de paie " +
    "antérieurs sont explicitement bienvenus. Un seul fichier par expérience, et un fichier " +
    "distinct pour chaque expérience.",
  'Preuve de ressources financières suffisantes':
    "Lettre officielle de l'institution financière indiquant : tous les comptes (opérations, " +
    "épargne, placements) avec leurs numéros, leur date d'ouverture et leur solde sur les SIX " +
    "DERNIERS MOIS ; la liste des dettes non réglées ; le tout sur papier à en-tête, avec ton nom " +
    "et les coordonnées de l'institution. Un simple relevé de compte ne suffit pas. " +
    "À noter : la preuve de fonds n'est pas une exigence légale en Catégorie de l'expérience canadienne.",
  'Certificat de police':
    "Certificat délivré par le pays ou territoire concerné. Il permet à IRCC de déterminer si tu as " +
    "un casier judiciaire et si tu représentes un risque pour la sécurité du Canada.",
  'Photographie':
    "Tête de face, visage au centre, haut des épaules inclus. Tête de 31 à 36 mm du menton au " +
    "sommet. Image d'au moins 420 × 540 pixels, cadre final d'au moins 35 × 45 mm, format JPEG ou " +
    "JPEG2000, couleur 24 bits RGB, environ 240 Ko et 4 Mo maximum. Photo numérisée : 600 ppp " +
    "minimum. Les coordonnées du photographe (nom, adresse, date de prise de vue) se téléversent " +
    "sous « Renseignements du client ».",
  'Passeports / titres de voyage':
    "Copie lisible du titre de voyage valide : la page montrant la date de naissance et le pays " +
    "d'origine, ET TOUTE PAGE portant des timbres, visas ou inscriptions. À défaut de passeport, un " +
    "titre délivré par un gouvernement mentionnant nom, date de naissance, numéro, citoyenneté ou " +
    "statut de résidence, photo et date d'expiration.",
  "Preuve d'examen médical préalable":
    "Imprimé du rapport médical ou formulaire Rapport médical préalable IMM 1017B, remis par le " +
    "médecin désigné à l'issue de l'examen. Si l'examen ne peut pas avoir lieu avant la date " +
    "limite, une preuve de rendez-vous est acceptée.",
  "Déclaration officielle d'union de fait":
    "Au-delà du formulaire IMM 5409 : des documents prouvant que vous avez mis vos affaires en " +
    "commun et établi un ménage au même domicile — relevé de compte ou de carte conjoints, " +
    "propriété ou bail conjoint, reçu de location, facture de service public commune, preuve de " +
    "gestion conjointe des dépenses, achat conjoint, courrier adressé à la même adresse.",
  "Document d'identité national":
    "Copie de la ou des pièces d'identité nationales, en complément du passeport. " +
    "(Aucune infobulle dédiée sur le portail pour cette case.)",
  'Renseignements du client':
    "Case facultative servant de dépôt aux documents complémentaires : lettres d'explication (LOE) " +
    "et coordonnées du photographe exigées par la case Photographie. C'est l'endroit prévu pour " +
    "expliquer une pièce incomplète ou une incohérence apparente entre deux documents.",
};

@Component({
  selector: 'app-immigration-page',
  standalone: true,
  imports: [FormsModule, LucideAngularModule, PageHeaderComponent],
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

  /**
   * Encart « À savoir » — points de vigilance propres à CE dossier (CEC, ITA du 22/07/2026),
   * tirés des infobulles du portail IRCC et de l'audit des pièces.
   */
  readonly tips: { title: string; items: string[] }[] = [
    {
      title: 'Échéance & dépôt',
      items: [
        "IRCC ferme à la fin de la journée d'échéance EN UTC, soit 20 h heure de Montréal — quatre heures plus tôt que ce que « minuit » laisse croire.",
        "Aucune prolongation n'est accordée (texte de l'ITA).",
        "Téléverser ne suffit pas : tant que la demande n'est pas soumise, tout reste au statut « Documents téléversés – pas soumis à IRCC ».",
      ],
    },
    {
      title: 'Validité des pièces',
      items: [
        "Test de langue : moins de 2 ans LE JOUR DU DÉPÔT, pas le jour de l'invitation. Aucune case ne le réclame, mais c'est une condition d'admissibilité.",
        "Examen médical : valide 12 mois. Sans le consentement eMedical, le dossier n'est pas transmis à IRCC.",
        'Évaluation des diplômes (EDE/WES) : valide 5 ans.',
        'Certificat de police du pays de résidence : le plus récent fait foi.',
      ],
    },
    {
      title: 'Forme et format',
      items: [
        '4 Mo maximum par fichier téléversé.',
        'Un seul fichier par case : fusionner les pièces multiples en un PDF.',
        "Un fichier DISTINCT par expérience de travail — ne jamais regrouper plusieurs emplois dans le même PDF.",
        "Documents acceptés en anglais ou en français uniquement, sinon traduction certifiée + affidavit.",
      ],
    },
    {
      title: 'Lettre d\'emploi — les 3 oublis classiques',
      items: [
        "Le nombre d'heures PAR SEMAINE, en chiffre précis (« 35 heures par semaine », pas « temps plein »).",
        'Le salaire ANNUEL et les avantages sociaux — un taux horaire seul ne suffit pas.',
        "La signature du supérieur immédiat. À défaut, une attestation RH s'explique en une ligne dans « Renseignements du client ».",
        'À défaut de lettre parfaite : bulletins de paie, T4 et avis de cotisation complètent utilement.',
      ],
    },
    {
      title: 'Spécificités CEC',
      items: [
        "L'admissibilité repose sur l'expérience canadienne : 1 560 h en 3 ans, dans un poste TEER 0/1/2/3.",
        "L'expérience doit avoir été acquise avec une autorisation de travail valide.",
        "La preuve de fonds n'est pas une exigence légale en CEC, même si la case est marquée « requis ».",
        "L'expérience étrangère ne joue pas sur l'admissibilité, mais pèse sur le score CRS — elle doit rester défendable.",
      ],
    },
    {
      title: 'Pièges à éviter',
      items: [
        "Fausses déclarations : refus et interdiction de territoire jusqu'à 5 ans. Ne rien gonfler, tout documenter.",
        "Ne pas ouvrir de case inutile : une expérience déclarée seulement dans « Activités personnelles » n'exige aucune lettre.",
        'Vérifier chaque fichier téléchargé du portail : un PDF de 0 octet passe inaperçu.',
        'Garder une copie de tout, y compris les versions antérieures des attestations.',
      ],
    },
  ];

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
  /**
   * Instant réel de fermeture : IRCC accepte jusqu'à la fin de la journée d'échéance **en UTC**.
   * À Montréal cela tombe quatre heures plus tôt que « minuit », d'où le calcul explicite.
   */
  private readonly cutoff = computed(() => {
    const ov = this.overview();
    return ov ? new Date(`${ov.deadline}T23:59:59Z`) : null;
  });

  readonly daysLeft = computed(() => {
    const c = this.cutoff();
    return c ? Math.floor((c.getTime() - Date.now()) / 86_400_000) : null;
  });

  /** Heures restantes — affiché à la place des jours le dernier jour. */
  readonly hoursLeft = computed(() => {
    const c = this.cutoff();
    return c ? Math.max(0, Math.floor((c.getTime() - Date.now()) / 3_600_000)) : null;
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
    const cutoff = new Date(`${iso}T23:59:59Z`);
    const date = cutoff.toLocaleDateString('fr-CA', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      timeZone: 'America/Montreal',
    });
    const time = cutoff.toLocaleTimeString('fr-CA', {
      hour: '2-digit', minute: '2-digit', timeZone: 'America/Montreal',
    });
    return `${date}, ${time} (heure de Montréal)`;
  }

  commentDate(iso: string): string {
    // SQLite renvoie "YYYY-MM-DD HH:MM:SS" en UTC
    const d = new Date(iso.replace(' ', 'T') + 'Z');
    return d.toLocaleDateString('fr-CA', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  }
}
