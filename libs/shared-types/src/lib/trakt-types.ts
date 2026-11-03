// État de kube-trakt (serveur compatible Trakt du homelab) — voir Aexils/kube-trakt.

export interface TraktCounts {
  movies_watched: number;
  episodes_watched: number;
  shows_followed: number;
  plays: number;
  lists: number;
  catalog_items: number;
}

export interface TraktDevice {
  device: string;
  created_at: number;
  last_seen: string | null;
}

export interface TraktMissingRoute {
  method: string;
  path: string;
  count: number;
  last_seen: string;
}

export interface TraktNowPlaying {
  title: string | null;
  season: number | null;
  number: number | null;
  progress: number;
  at: string;
}

export interface TraktJellyfinStatus {
  at?: string;
  error: string | null;
  added?: number;
  resume_points?: number;
  shows?: number;
  unmatched?: string[];
}

export interface TraktLoopShow {
  title: string | null;
  tmdb: number;
  slug: string;
}

export type TraktMediaKind = 'movie' | 'show';

// Origine du contenu d'une liste ; null pour une liste tenue à la main.
export type TraktListSource =
  | { type: 'provider'; provider: number; country: string; kinds: TraktMediaKind[]; theme?: string; keyword?: number }
  | { type: 'netflix_top10'; country: string; kinds: TraktMediaKind[] };

export interface TraktList {
  name: string;
  description: string;
  item_count: number;
  ids: { trakt: number; slug: string };
  source: TraktListSource | null;
  source_status: { at: string; error: string | null; unmatched: string[] } | null;
}

export interface TraktNewList {
  name: string;
  source?: { type: 'provider' | 'netflix_top10'; provider?: number; kinds?: TraktMediaKind[]; theme?: string };
}

/** Film ou série, tel que renvoyé par les recherches et les listes de kube-trakt. */
export interface TraktTitle {
  kind: TraktMediaKind;
  title: string;
  year: number | null;
  tmdb: number;
  slug: string;
}

export interface TraktStatus {
  reachable: boolean;
  generated_at: string;
  counts: TraktCounts | null;
  last_watched_at: string | null;
  last_backup: string | null;
  catalog: { at: string; error: string | null } | null;
  jellyfin: TraktJellyfinStatus | null;
  loop_shows: TraktLoopShow[];
  now_playing: TraktNowPlaying | null;
  devices: TraktDevice[];
  missing_routes: TraktMissingRoute[];
  alerts: string[];
}
