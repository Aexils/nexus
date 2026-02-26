export interface KodiNowPlaying {
  type:   'movie' | 'episode' | 'music' | 'none';
  title:  string;
  year?:  number;
  // Raw Kodi thumbnail (kept for backward compat / fallback)
  thumbnail?: string;
  // Structured artwork (poster preferred over thumbnail for cover display)
  art?: { poster?: string; fanart?: string; thumb?: string };
  // Rich metadata
  plot?:      string;
  tagline?:   string;
  rating?:    number;    // 0–10
  genres?:    string[];
  directors?: string[];
  cast?:      string[];  // first 5 names
  studio?:    string[];
  // Music-specific
  artist?: string;
  album?:  string;
  // Playback state
  durationSec: number;
  positionSec: number;
  paused:      boolean;
  volume:      number;
}

export interface KodiStatus {
  connected:   boolean;
  version?:    string;
  nowPlaying:  KodiNowPlaying | null;
  lastPlayed?: { item: KodiNowPlaying; stoppedAt: string } | null;
}
