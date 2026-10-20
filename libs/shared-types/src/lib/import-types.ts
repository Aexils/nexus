import { ExpensePaidBy } from './expense-types';

/**
 * Import de relevés bancaires (Banque Nationale) et classement automatique.
 *
 * Le classement est 100 % déterministe : une table de règles `merchant_rules`
 * fait correspondre un motif du libellé bancaire brut à une enseigne, une
 * catégorie et une destination. Aucun appel à un LLM au runtime — les règles
 * sont écrites par l'écran de révision quand l'utilisateur corrige une ligne.
 */

export type ImportFormat = 'ofx' | 'qfx' | 'csv';

/** Où part une ligne une fois validée. */
export type StagedDestination = 'maison' | 'perso' | 'ignore';

export type RuleMatchType = 'exact' | 'contains' | 'regex';

/** D'où vient le classement proposé pour une ligne. */
export type ClassificationSource = 'rule' | 'manual' | 'unmatched';

export type StagedStatus = 'pending' | 'applied' | 'rejected';

/** D'où vient une règle — sert à mesurer l'autonomie du système. */
export type RuleOrigin = 'seed' | 'user' | 'claude';

/** Une transaction telle que lue dans le fichier, avant tout classement. */
export interface ParsedTransaction {
  /** Identifiant unique fourni par la banque (OFX/QFX). '' en CSV. */
  fitid: string;
  /** Libellé brut, jamais réécrit — c'est la matière première des règles. */
  rawLabel: string;
  date: string;        // YYYY-MM-DD
  /** Toujours positif. Un débit de 45,67 $ donne 45.67. */
  amount: number;
  /** true pour un dépôt / remboursement / paiement de carte. */
  isCredit: boolean;
}

/** Résultat du parsing d'un fichier, avant insertion en staging. */
export interface ParsedStatement {
  format: ImportFormat;
  /** 4 derniers chiffres du compte — sert à détecter un relevé mal attribué. */
  accountMask: string;
  transactions: ParsedTransaction[];
}

export interface ImportBatch {
  id: number;
  filename: string;
  format: ImportFormat;
  /** À qui appartient le compte — détermine `paidBy` des dépenses maison. */
  accountOwner: ExpensePaidBy;
  accountMask: string;
  importedAt: string;
  /** Lignes lues dans le fichier. */
  txTotal: number;
  /** Lignes retenues après déduplication. */
  txNew: number;
  /** Lignes écartées car déjà importées. */
  txDuplicate: number;
  /** Lignes encore à valider. */
  pending: number;
  /** Lignes sans règle — c'est ce chiffre qui doit tendre vers zéro. */
  unmatched: number;
}

export interface StagedTransaction {
  id: number;
  batchId: number;
  fitid: string;
  dedupKey: string;
  rawLabel: string;
  date: string;
  amount: number;
  isCredit: boolean;

  // ── Classement proposé (modifiable dans l'écran de révision) ──────────────
  destination: StagedDestination;
  /** Qui, quand destination = 'perso'. Par défaut le titulaire du compte. */
  persoUser: ExpensePaidBy | null;
  enseigne: string;
  category: string;
  subcategory: string;
  source: ClassificationSource;
  ruleId: number | null;

  /** Id d'une dépense existante qui ressemble à celle-ci (même date, même montant). */
  duplicateOfId: number | null;
  status: StagedStatus;
  /** Id de la dépense créée à la validation. */
  appliedExpenseId: number | null;
}

export interface MerchantRule {
  id: number;
  /** Motif cherché dans le libellé normalisé (majuscules, sans accents). */
  pattern: string;
  matchType: RuleMatchType;
  enseigne: string;
  category: string;
  subcategory: string;
  destination: StagedDestination;
  /** Départage deux règles qui matchent : le plus grand gagne. */
  priority: number;
  hits: number;
  origin: RuleOrigin;
  createdAt: string;
  lastUsedAt: string | null;
}

/** Ce que l'écran de révision renvoie pour valider un lot. */
export interface ApplyDecision {
  id: number;
  destination: StagedDestination;
  persoUser?: ExpensePaidBy | null;
  enseigne?: string;
  category?: string;
  subcategory?: string;
  /** Écrire une règle depuis cette ligne pour que le prochain import la connaisse. */
  learnRule?: boolean;
}

export interface ApplyResult {
  applied: number;
  rejected: number;
  rulesLearned: number;
  batch: ImportBatch;
}

/**
 * Santé du classement automatique, affichée dans l'écran de révision.
 * `autoRate` à 100 % = le système n'a plus besoin de personne.
 */
export interface ImportHealth {
  totalRules: number;
  rulesByOrigin: Record<RuleOrigin, number>;
  /** Part des lignes classées par une règle, sur les N derniers lots. */
  autoRate: number;
  recentBatches: { batchId: number; month: string; autoRate: number }[];
}
