// Préférences de qualité partagées avec Kodi Aggregator. Source de vérité : kube-aggregator
// (GET/PUT /v1/preferences, POST /v1/preferences/preview). Nexus n'évalue aucune règle.

export type AggregatorTier = 'jellyfin' | 'vstream' | 'pov' | 'other';
export type AggregatorHdrMode = 'any' | 'prefer' | 'require' | 'forbid';
export type AggregatorUnknown = 'accept' | 'reject';
export type AggregatorResolution = '480p' | '720p' | '1080p' | '1440p' | '2160p';

export interface AggregatorProfile {
  label: string;
  /** Règles ordonnées, séparées par « | », dans la grammaire du moteur commun. */
  rules: string;
}

export interface AggregatorPreferences {
  schema: 1;
  active_profile: string;
  profiles: Record<string, AggregatorProfile>;
  profile_strict: boolean;
  provider_order: AggregatorTier[];
  unknown: AggregatorUnknown;
  strict: {
    min_resolution: AggregatorResolution | null;
    required_languages: string[];
    allowed_codecs: string[];
    hdr: AggregatorHdrMode;
    min_size_gb: number | null;
    max_size_gb: number | null;
    require_known_availability: boolean;
    excluded_formats: string[];
  };
  soft: {
    preferred_resolution: AggregatorResolution | null;
    preferred_languages: string[];
    preferred_codecs: string[];
  };
}

export interface AggregatorPreferencesState {
  /** 0 : jamais enregistrées, Kodi garde ses réglages locaux. */
  version: number;
  updated_at: number | null;
  updated_by: string | null;
  preferences: AggregatorPreferences;
}

export interface AggregatorPreviewRequest {
  preferences: AggregatorPreferences;
  media_type: 'movie' | 'episode';
  tmdb: string;
  season?: number;
  episode?: number;
}

export interface AggregatorPreviewRelease {
  release_id: string;
  tier: AggregatorTier;
  rank: number;
  explanation: string;
  refusal: string | null;
  source: string | null;
  resolution: string | null;
  hdr: string | null;
  languages: string[];
  file_size_gb: number | null;
  access: string | null;
}

export interface AggregatorPreview {
  profile: string;
  rules: string[];
  /** Ordre d'essai de l'autoplay (identifiants de release). */
  autoplay: string[];
  refused: Record<string, number>;
  releases: AggregatorPreviewRelease[];
}

/** Erreur relayée telle quelle depuis kube-aggregator ou Nexus. */
export interface AggregatorError {
  status: 'forbidden' | 'conflict' | 'invalid' | 'unavailable' | 'unauthenticated' | 'csrf';
  error?: string;
  /** Version courante du backend, pour un conflit. */
  version?: number;
}

export interface NexusSession {
  authenticated: boolean;
  /** Jeton anti-CSRF à renvoyer dans l'en-tête X-CSRF-Token des écritures. */
  csrf: string | null;
  /** Authentification configurée sur ce déploiement (mot de passe et secret présents). */
  configured: boolean;
}

/** Profils fournis par le moteur, en lecture seule (mêmes clés que le backend). */
export const AGGREGATOR_BUILTIN_PROFILES: Record<string, AggregatorProfile> = {
  preferred: { label: '4K SDR MULTi → 4K HDR MULTi → 1080p SDR MULTi', rules: '4K SDR MULTI | 4K HDR MULTI | 1080p SDR MULTI' },
  max_quality: { label: 'Qualité maximale', rules: '4K DV | 4K HDR | 4K | 1080p HDR | 1080p | 720p' },
  fast_start: { label: 'Démarrage rapide', rules: '1080p <=4 | 720p <=2 | 1080p <=8 | 4K <=20' },
};
