/** Latest versions fetched from public release APIs (GitHub, sideloadly.io, etc.) */
export interface AppLatestVersions {
  kodi?:          string; // e.g. "21.1"
  abs?:           string; // e.g. "2.17.4"
  urbackup?:      string; // e.g. "2.5.25"
  jellyfin?:      string; // e.g. "10.10.6"
  sideloadly?:    string; // e.g. "0.60.0"
  dockerDesktop?: string; // e.g. "4.38.0"
  booklore?:      string; // e.g. "1.17.0"
}
