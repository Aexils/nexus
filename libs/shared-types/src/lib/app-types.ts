export type AppStatus = 'running' | 'stopped' | 'error' | 'starting';

export interface AppInfo {
  id: string;           // 'kodi' | 'plex' | 'vlc' | 'obs'
  name: string;
  version?: string;
  status: AppStatus;
  pid?: number;
  port?: number;
  uptime?: number;      // secondes
  cpuPercent?: number;
  memMB?: number;
}

export type LogLevel  = 'info' | 'warn' | 'error' | 'ok' | 'debug';
export type LogSource = 'kodi' | 'abs' | 'psn' | 'sideloadly' | 'sideloop' | 'urbackup' | 'jellyfin' | 'booklore' | 'nextcloud' | 'system' | 'nexus' | 'events' | 'jobs' | 'vzdump';

export interface LogEntry {
  id:        string;
  timestamp: number;   // Unix ms
  level:     LogLevel;
  source:    LogSource;
  message:   string;
}

// État Nextcloud (API serverinfo) — sync photos iPhone, espace, activité
export interface NextcloudStatus {
  reachable:    boolean;
  checkedAt:    number;    // Unix ms
  version?:     string;    // ex. "34.0.1.2"
  freeBytes?:   number;    // espace libre du volume data
  numFiles?:    number;
  numUsers?:    number;
  active5m?:    number;    // utilisateurs actifs < 5 min (sync en cours ?)
  active24h?:   number;
  dbSizeBytes?: number;
}
