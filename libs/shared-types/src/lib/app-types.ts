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
export type LogSource = 'kodi' | 'abs' | 'psn' | 'sideloadly' | 'urbackup' | 'jellyfin' | 'booklore' | 'system' | 'nexus';

export interface LogEntry {
  id:        string;
  timestamp: number;   // Unix ms
  level:     LogLevel;
  source:    LogSource;
  message:   string;
}
