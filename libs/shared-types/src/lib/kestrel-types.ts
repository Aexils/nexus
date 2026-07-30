// Types du microservice Kestrel (veille de prix). Le wire est en snake_case (FastAPI/SQLModel)
// — on colle au JSON réel, sans couche de transformation. Domaine-agnostique côté cœur.

export interface KestrelSource {
  id: string;
  params_schema: Record<string, unknown>;
  providers: string[];
}

export interface KestrelTarget {
  id: number;
  source: string;
  label: string;
  params: Record<string, unknown>;
  interval_minutes: number;
  currency: string;
  active: boolean;
  created_at: string;
}

export interface KestrelObservation {
  id: number;
  target_id: number;
  provider: string;
  price: number;
  currency: string;
  observed_at: string;
  deep_link: string | null;
  trusted: boolean;
  variant: string | null;
  all_in: boolean;
  raw: Record<string, unknown>;
}

export type KestrelRuleKind = 'threshold' | 'relative_drop';

export interface KestrelRule {
  id: number;
  target_id: number;
  kind: KestrelRuleKind;
  config: Record<string, unknown>;
  active: boolean;
  created_at: string;
}

export interface KestrelAlert {
  id: number;
  target_id: number;
  rule_id: number;
  price: number;
  currency: string;
  message: string;
  notified_at: string;
}

// Corps de création d'une cible (POST /targets).
export interface KestrelTargetCreate {
  source: string;
  label?: string;
  params?: Record<string, unknown>;
  interval_minutes?: number;
  currency?: string;
}
