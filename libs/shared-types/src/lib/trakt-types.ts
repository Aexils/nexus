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

export type TraktChart = 'trending' | 'popular' | 'favorited' | 'watched' | 'streaming';

// Origine du contenu d'une liste ; null pour une liste tenue à la main.
export type TraktListSource =
  | { type: 'provider'; provider: number; country: string; kinds: TraktMediaKind[]; theme?: string; keyword?: number }
  | { type: 'netflix_top10'; country: string; kinds: TraktMediaKind[] }
  | { type: 'chart'; chart: TraktChart; kinds: TraktMediaKind[] };

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

/** Élément d'une rangée telle que la télé l'affiche. */
export interface TraktRowItem {
  kind: 'episode' | TraktMediaKind;
  label: string;
  title: string;
  showtitle?: string;
  season?: number;
  episode?: number;
  plot: string;
  runtime: number;
  rating: number;
  year: number;
  genres: string[];
  tmdb: number;
  percent?: number;
  art: { poster?: string; fanart?: string; landscape?: string; thumb?: string; clearlogo?: string };
}

/** Résultat de recherche ou d'aperçu : rien n'est encore enregistré. */
export interface TraktPreview {
  kind: TraktMediaKind;
  tmdb: number;
  title: string;
  year: number | null;
  rating: number;
  plot: string;
  poster: string | null;
  backdrop: string | null;
}

/** Rangée d'un écran créé depuis Nexus. */
export type TraktScreenRow =
  | { kind: 'next' }
  | { kind: 'list'; list: number }
  | { kind: 'addon'; title: string; path: string };

export interface TraktCustomScreen {
  id: string;
  name: string;
  icon: string;
  rows: TraktScreenRow[];
  /** Écrans d'origine : le skin ne prévoit pas le même nombre de rangées partout. */
  max_rows?: number;
}

export interface TraktCustomScreens {
  builtin: TraktCustomScreen[];
  screens: TraktCustomScreen[];
  max_screens: number;
  max_rows: number;
  max_builtin_rows: number;
  catalog: { title: string; path: string }[];
}

/** Aperçu d'une rangée d'addon, envoyé par le rpi5. */
export interface TraktSnapshotItem {
  label: string;
  title: string;
  plot: string;
  year: number;
  rating: number;
  runtime: number;
  genres: string[];
  art: TraktRowItem['art'];
}

/** Entrée du menu de gauche de la télé. */
export interface TraktNavEntry {
  key: string;
  builtin: boolean;
  name: string;
  icon: string;
  window: string;
  has_rows: boolean;
  hidden: boolean;
}

export interface TraktProviderLogo {
  name: string;
  logo: string;
}

/** Réglage de Kodi, tel que le rpi5 l'expose. */
export interface KodiSetting {
  id: string;
  section: string;
  category: string;
  label: string;
  help: string;
  type: string;
  value: unknown;
  default: unknown;
  options?: { label: string; value: unknown }[] | null;
  minimum?: number | null;
  maximum?: number | null;
  step?: number | null;
  editable: boolean;
}

export interface SkinSetting {
  kind: 'bool' | 'color';
  setting: string;
  label: string;
  group: string;
  value: boolean | string;
  inverted?: boolean;
}

export interface TraktSettings {
  kodi?: KodiSetting[];
  skin?: { id: string; name: string; items: SkinSetting[] }[];
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
