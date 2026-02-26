export type PsnPresence = 'online' | 'offline' | 'ingame' | 'away';

export interface PsnProfile {
  onlineId:   string;
  avatarUrl?: string;
  presence:   PsnPresence;
  lastOnline?: string; // ISO date — last time the user was seen online
}

export interface PsnGame {
  titleId:      string;
  name:         string;
  imageUrl?:    string;
  platform?:    string; // 'PS5' | 'PS4' | ...
  playCount?:   number;
  playDuration?: string; // ISO 8601 duration e.g. "PT12H30M"
  lastPlayedAt?: string; // ISO date
}

export interface PsnTrophySummary {
  level:    number;
  progress: number; // 0–100
  platinum: number;
  gold:     number;
  silver:   number;
  bronze:   number;
}

export interface PsnStatus {
  connected:     boolean;
  profile?:      PsnProfile;
  currentGame?:  PsnGame;       // game currently being played
  recentGames?:  PsnGame[];     // last 6 played titles
  trophySummary?: PsnTrophySummary;
}
