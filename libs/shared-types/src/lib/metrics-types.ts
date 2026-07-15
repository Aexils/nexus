export interface DiskInfo {
  mount: string;       // "/", "/mnt/media", ...
  totalGB: number;
  usedGB: number;
  usedPercent: number; // 0–100
  fstype?: string;     // ext4, ntfs, vfat, lvm-thin…
}

/** Un disque physique + les filesystems qui vivent dessus (regroupés). */
export interface DiskGroup {
  disk: string;        // "nvme0n1", "sda", "sdb"
  model: string;       // "CT500P3PSSD8", "SD8", "ST1000LM025…"
  totalGB: number;     // taille physique du disque
  label: string;       // libellé lisible : "NVMe interne", "USB · Media"…
  mounts: DiskInfo[];  // partitions/mounts sur ce disque
}

export interface TempInfo {
  label: string;        // "CPU", "NVMe", "iGPU"
  celsius: number;
}

/** Métriques globales du mini-PC (hôte Proxmox), via node_exporter. */
export interface HostMetrics {
  cpuPercent: number;        // 0–100, moyenne tous cœurs
  ramPercent: number;        // 0–100
  ramUsedGB: number;
  ramTotalGB: number;
  netRxBytesPerSec: number;  // bytes/s reçus (hors lo)
  netTxBytesPerSec: number;
  disks: DiskInfo[];         // à plat (compat)
  diskGroups: DiskGroup[];   // regroupés par disque physique
  temps: TempInfo[];         // CPU / NVMe / iGPU
  cpuTempCelsius: number | null; // raccourci : la temp CPU (Tctl)
  timestamp: number;         // Date.now()
}

/** Alias de compatibilité (l'ancien nom, le temps de la refonte du front). */
export type SystemMetrics = HostMetrics;

/** Métriques par nœud Kubernetes (via metrics-server). */
export interface NodeMetrics {
  name: string;
  role: string;              // "control-plane" | "worker"
  cpuMillicores: number;
  cpuPercent: number;        // vs allocatable
  ramBytes: number;
  ramPercent: number;        // vs allocatable
  ready: boolean;
}

/** Un pod (pour le détail d'un workload, vue k9s). */
export interface PodMetric {
  name: string;
  cpuMillicores: number;
  ramBytes: number;
  node: string;
  restarts: number;
  ready: boolean;
  phase: string;             // Running, Pending, Succeeded…
}

/** Une "application" = un namespace, agrégeant ses pods (vraie conso via metrics-server). */
export interface WorkloadMetric {
  namespace: string;
  kind: 'infra' | 'workload';
  cpuMillicores: number;
  ramBytes: number;
  podCount: number;
  readyCount: number;
  pods: PodMetric[];
}
