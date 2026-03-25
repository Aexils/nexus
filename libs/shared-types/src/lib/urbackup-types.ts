export interface UrbackupClient {
  id: number;
  name: string;
  online: boolean;
  osSimple: string;          // 'windows' | 'linux' | 'macos'
  clientVersion: string;
  lastFileBackup: number | null;   // Unix seconds, null if never
  lastImageBackup: number | null;  // Unix seconds, null if never
  fileOk: boolean;
  imageOk: boolean;
  filesUsedGB: number;
  imagesUsedGB: number;
}

export interface UrbackupActivity {
  id: number;
  clientId: number;
  clientName: string;
  backupTime: number;  // Unix seconds
  duration: number;    // seconds
  sizeGB: number;
  details: string;     // e.g. 'C:'
  isImage: boolean;
  isIncremental: boolean;
}

export interface UrbackupProgress {
  clientId: number;
  clientName: string;
  percentDone: number;
  eta: number;         // seconds
  details: string;
  action: number;
}

export interface UrbackupStatus {
  connected: boolean;
  serverVersion: string;
  clients: UrbackupClient[];
  recentActivities: UrbackupActivity[];
  activeProgress: UrbackupProgress[];
}
