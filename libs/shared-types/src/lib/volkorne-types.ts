// Types du microservice Volkorne (suivi d'une production de Volkornes, Dofus).
// Le wire est en snake_case (FastAPI/SQLModel) — on colle au JSON réel, sans couche
// de transformation, comme pour Kestrel.

export type VolkorneMountStatus = 'captured' | 'leveling' | 'ready' | 'broken' | 'sold';

export interface VolkorneLiveMount {
  id: number | null;
  name: string | null;
  status: VolkorneMountStatus;
  xp: number;
  xp_remaining: number;
  target_level: number;
  /** Instant prédit d'atteinte de la cible. null = la jauge s'épuise avant. */
  eta_target: string | null;
  is_done: boolean;
}

/** L'écran prioritaire de la spec : tout y est CALCULÉ, rien n'est lu tel quel en base. */
export interface VolkorneEnclosState {
  id: number;
  name: string;
  now: string;
  gauge_value: number;
  gauge_active: boolean;
  /** Instant de la panne sèche. null si rien ne se consomme. */
  empty_at: string | null;
  consumes: boolean;
  capacity: number;
  mount_count: number;
  /** Enclos incomplet avec jauge active : le carburant coûte pareil pour 1 que pour 10. */
  is_underfilled: boolean;
  all_ready: boolean;
  mounts: VolkorneLiveMount[];
  extracts_to_finish: number;
  finishes_at: string | null;
}

export interface VolkorneEnclos {
  id: number;
  name: string;
  server_id: number | null;
  capacity: number;
  notes: string | null;
}

export interface VolkorneRefillResponse {
  enclos_id: number;
  extracts_used: number;
  gauge_before: number;
  gauge_after: number;
  empty_at: string | null;
  stock_remaining: number;
  /** Plus consommé que déclaré à l'achat : le stock ET le coût des fournées sont faux. */
  stock_inconsistent: boolean;
}

export type VolkorneVerdict = 'accept' | 'review' | 'reject';

/** Réponse d'un relevé manuel de jauge, après contrôle de plausibilité. */
export interface VolkorneCheckpointResponse {
  applied: boolean;
  verdict: VolkorneVerdict;
  reason: string;
  observed: number;
  predicted: number;
  deviation: number;
  tolerance: number;
  likely_unlogged_refill: boolean;
  gauge_value: number;
  empty_at: string | null;
}

export interface VolkorneBatchYield {
  batch_id: number;
  started_at: string;
  finished_at: string | null;
  mounts_broken: number;
  ga_pa: number;
  /** Le rendement réel. null si rien n'a encore été brisé. */
  ga_pa_per_mount: number | null;
  cash_cost: number;
  /** null plutôt que 0 : une fournée stérile n'est pas la plus rentable. */
  cash_per_ga_pa: number | null;
  extracts_consumed: number;
}

export type VolkorneTrend = 'insufficient_data' | 'declining' | 'stable' | 'improving';

/** Rapport temps / dépense / bénéfice. Absent tant qu'aucun prix de Ga PA n'est connu. */
export interface VolkorneProfitability {
  ga_pa_price: number;
  total_ga_pa: number;
  revenue: number;
  cash_cost: number;
  profit: number;
  margin: number | null;
  hours: number;
  /** Le juge de paix : comparable à n'importe quelle autre activité du jeu. */
  kamas_per_hour: number | null;
  is_profitable: boolean;
}

/** La réponse au § 8 : combien coûte une Ga PA, et est-ce que le rendement baisse. */
export interface VolkorneYieldReport {
  batches: VolkorneBatchYield[];
  trend: VolkorneTrend;
  slope_per_batch: number | null;
  mean_ga_pa_per_mount: number | null;
  last_ga_pa_per_mount: number | null;
  /** Repère théorique de la spec (0,755). Sert à situer, jamais à remplacer le mesuré. */
  theoretical: number;
  deviation_from_theory: number | null;
  overall_cash_per_ga_pa: number | null;
  total_ga_pa: number;
  total_cash_cost: number;
  profitability: VolkorneProfitability | null;
}

export interface VolkorneStock {
  item_id: number;
  item_name: string;
  quantity: number;
  unit_cash_cost: number;
  unit_market_value: number;
  total_cash_cost: number;
  total_market_value: number;
  inconsistent: boolean;
  shortfall: number;
}


/** Un palier de carburant de mangeoire. Les cinq plafonnent à 40 000. */
export interface VolkorneFuel {
  name: string;
  label: string;
  /** Points de jauge rechargés par unité : de 1 000 (Minuscule) à 5 000 (Gigantesque). */
  gauge_points: number;
  fill_cap: number;
  dofusdb_id: number | null;
  /** Icône DofusDB. Purement décorative : rien ne casse si elle ne répond pas. */
  img: string | null;
  is_default: boolean;
}

export interface VolkorneCatalog {
  fuels: VolkorneFuel[];
  gauge_max: number;
  catalog: Record<string, unknown>;
}
