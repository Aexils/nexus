export interface GpuInfo {
  index: number;
  usedPercent: number;    // 3D engine usage, 0–100
  vramUsedGB: number;
  vramTotalGB: number;
  tempCelsius: number | null;
}

export interface DiskInfo {
  mount: string;      // "C:" or "/"
  totalGB: number;
  usedGB: number;
  usedPercent: number; // 0–100
}

export interface SystemMetrics {
  cpuPercent: number;       // 0–100, average across all cores
  ramPercent: number;       // 0–100
  ramUsedGB: number;
  ramTotalGB: number;
  netRxBytesPerSec: number; // bytes/s received (all ifaces except lo)
  netTxBytesPerSec: number;
  disks: DiskInfo[];
  gpus: GpuInfo[];
  cpuTempCelsius: number | null;
  timestamp: number;        // Date.now()
}
