export interface SideloadlyAccount {
  appleId: string;
  remaining: number;       // app slots remaining (out of 10)
  nearestTtl: string;      // ISO timestamp of nearest expiry
  nextRenewalMs: number;   // ms until nearest TTL (negative = past due)
}

export interface SideloadlyDevice {
  udid: string;
  name: string;
  lastSeen: string | null;
  lastError: string;
  failuresCount: number;
}

export interface SideloadlyApp {
  id: number;
  name: string;
  bundleId: string;
  version: string;
  deviceUdid: string;
  deviceName: string;
  appleId: string;
  installedAt: string;
  lastRenewedAt: string;
  nextRenewalAt: string;
  expiresInMs: number;
  status: 'ok' | 'expiring' | 'expired';
  lastError: string | null;
  failuresCount: number;
  lastFailureAt: string | null;
}

export interface SideloadlyDaemon {
  alive: boolean;
  startedAt: string | null;   // ISO timestamp of last daemon startup
  uptimeSec: number | null;   // seconds since startup
  ramMB: number | null;       // working set in MB (from windows_exporter)
}

export interface SideloadlyStatus {
  connected: boolean;
  daemon: SideloadlyDaemon;
  accounts: SideloadlyAccount[];
  devices: SideloadlyDevice[];
  apps: SideloadlyApp[];
}
