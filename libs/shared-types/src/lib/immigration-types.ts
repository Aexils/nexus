// ── Entrée Express — suivi de dossier d'immigration Canada ──────────────────

export type ImmigrationApplicant = 'alexis' | 'marion';

export type DocStatus = 'not_provided' | 'in_progress' | 'provided';
export type DocCategory = 'required' | 'optional';

/** Un commentaire horodaté rattaché à un document (historique d'annotations). */
export interface DocComment {
  id: number;
  text: string;
  createdAt: string; // ISO
}

/** Un document requis pour le dossier d'un candidat. */
export interface RequiredDocument {
  id: number;
  applicantId: ImmigrationApplicant;
  name: string;             // intitulé du document
  detail: string;           // employeur / période / précision (peut être vide)
  category: DocCategory;
  status: DocStatus;
  commentCount: number;
  comments: DocComment[];   // vide tant que le panneau n'est pas ouvert
  updatedAt: string;        // ISO
}

/** Bloc d'un candidat : ses documents + sa progression. */
export interface ApplicantProgress {
  id: ImmigrationApplicant;
  name: string;
  documents: RequiredDocument[];
  requiredTotal: number;
  requiredProvided: number;
  requiredInProgress: number;
}

/** Vue complète du dossier, servie en un seul appel pour le dashboard. */
export interface ImmigrationOverview {
  deadline: string;         // YYYY-MM-DD — échéance projet éditable
  applicants: ApplicantProgress[];
  totalRequired: number;
  totalProvided: number;
}

export const DOC_STATUS_ORDER: DocStatus[] = ['not_provided', 'in_progress', 'provided'];

export const DOC_STATUS_LABELS: Record<DocStatus, string> = {
  not_provided: 'Manquant',
  in_progress:  'En cours',
  provided:     'Fourni',
};
