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

export interface TraktStatus {
  reachable: boolean;
  generated_at: string;
  counts: TraktCounts | null;
  last_watched_at: string | null;
  last_backup: string | null;
  catalog: { at: string; error: string | null } | null;
  now_playing: TraktNowPlaying | null;
  devices: TraktDevice[];
  missing_routes: TraktMissingRoute[];
  alerts: string[];
}
