import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { NexusGateway } from '../gateway/nexus.gateway';
import { DiskGroup, HostMetrics, TempInfo } from '@nexus/shared-types';

interface CpuSnapshot { idle: number; total: number; }
interface NetSnapshot { rx: number; tx: number; }

// node_exporter sur l'hôte Proxmox (pve) — métriques globales du mini-PC.
const NODE_EXPORTER_URL = process.env['NODE_EXPORTER_URL'] ?? 'http://10.10.10.1:9100/metrics';

@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);

  private prevCpu: CpuSnapshot | null = null;
  private prevNet: NetSnapshot | null = null;
  private warnEmitted = false;

  constructor(private readonly gateway: NexusGateway) {
    this.logger.log(`Métriques hôte via node_exporter: ${NODE_EXPORTER_URL}`);
    this.gateway.addLog('debug', 'system', `Métriques hôte via ${NODE_EXPORTER_URL}`);
  }

  @Interval(3000)
  async collect() {
    let raw: string;
    try {
      const res = await fetch(NODE_EXPORTER_URL, { signal: AbortSignal.timeout(2500) });
      raw = await res.text();
      this.warnEmitted = false;
    } catch {
      if (!this.warnEmitted) {
        this.warnEmitted = true;
        this.logger.warn(`node_exporter injoignable: ${NODE_EXPORTER_URL}`);
        this.gateway.addLog('warn', 'system', `node_exporter injoignable — ${NODE_EXPORTER_URL}`);
      }
      return;
    }

    const lines = raw.split('\n');
    const cpuPercent = this.getCpu(lines);
    const ram = this.getRam(lines);
    const net = this.getNet(lines);
    const diskGroups = this.getDiskGroups(lines);
    const disks = diskGroups.flatMap(g => g.mounts);
    const temps = this.getTemps(lines);

    // Premier tick : on amorce les deltas CPU/net, on n'émet pas encore.
    if (cpuPercent === null || net === null) return;

    const cpuTemp = temps.find(t => t.label === 'CPU')?.celsius ?? null;

    const payload: HostMetrics = {
      cpuPercent,
      ...ram,
      netRxBytesPerSec: net.rx,
      netTxBytesPerSec: net.tx,
      disks,
      diskGroups,
      temps,
      cpuTempCelsius: cpuTemp,
      timestamp: Date.now(),
    };
    this.gateway.emitSystemMetrics(payload);
  }

  // ── CPU : rate du non-idle sur node_cpu_seconds_total ──────────────────────

  private getCpu(lines: string[]): number | null {
    let idle = 0;
    let total = 0;
    for (const line of lines) {
      if (!line.startsWith('node_cpu_seconds_total{')) continue;
      const value = parseFloat(line.split(' ').at(-1) ?? '0') || 0;
      total += value;
      if (line.includes('mode="idle"')) idle += value;
    }
    if (!this.prevCpu) {
      this.prevCpu = { idle, total };
      return null;
    }
    const idleDelta = idle - this.prevCpu.idle;
    const totalDelta = total - this.prevCpu.total;
    this.prevCpu = { idle, total };
    if (totalDelta <= 0) return 0;
    return Math.round(100 * (1 - idleDelta / totalDelta));
  }

  private getRam(lines: string[]): { ramPercent: number; ramUsedGB: number; ramTotalGB: number } {
    let total = 0;
    let available = 0;
    for (const line of lines) {
      if (line.startsWith('node_memory_MemTotal_bytes '))     total = parseFloat(line.split(' ').at(-1) ?? '0') || 0;
      if (line.startsWith('node_memory_MemAvailable_bytes ')) available = parseFloat(line.split(' ').at(-1) ?? '0') || 0;
    }
    const used = total - available;
    const GiB = 1024 ** 3;
    return {
      ramTotalGB: parseFloat((total / GiB).toFixed(1)),
      ramUsedGB: parseFloat((used / GiB).toFixed(1)),
      ramPercent: total > 0 ? Math.round((used / total) * 100) : 0,
    };
  }

  // On ne compte QUE le lien physique de sortie du mini-PC (l'uplink réel).
  // Tout le reste est interne/overlay et fausserait le total : vmbr0 (bridge
  // des VMs = trafic pods/Calico, ~185 Go), tailscale0/tun* (VPN, déjà porté par
  // le wifi), veth/cali/vxlan/tap (réseau conteneurs). Le trafic Tailscale passe
  // physiquement par le wifi, donc wlp4s0 seul capte bien tout l'externe.
  private static readonly NET_SKIP = [
    'veth', 'cali', 'vxlan', 'tap', 'vmbr', 'tailscale', 'tun', 'docker', 'br-',
  ];

  private getNet(lines: string[]): { rx: number; tx: number } | null {
    let rx = 0;
    let tx = 0;
    for (const line of lines) {
      const isRx = line.startsWith('node_network_receive_bytes_total{');
      const isTx = line.startsWith('node_network_transmit_bytes_total{');
      if (!isRx && !isTx) continue;
      const dev = line.match(/device="([^"]+)"/)?.[1] ?? '';
      if (dev === 'lo' || MetricsService.NET_SKIP.some(p => dev.startsWith(p))) continue;
      const value = parseFloat(line.split(' ').at(-1) ?? '0') || 0;
      if (isRx) rx += value;
      if (isTx) tx += value;
    }
    if (!this.prevNet) {
      this.prevNet = { rx, tx };
      return null;
    }
    const rxPerSec = Math.max(0, Math.round((rx - this.prevNet.rx) / 3));
    const txPerSec = Math.max(0, Math.round((tx - this.prevNet.tx) / 3));
    this.prevNet = { rx, tx };
    return { rx: rxPerSec, tx: txPerSec };
  }

  // ── Stockage : topologie complète via le textfile collector pve (nexus_*) ──
  // Le script /usr/local/bin/nexus-disk-metrics.py émet, par disque physique,
  // nexus_disk_size_bytes{disk,model} + nexus_mount_{size,used}_bytes{disk,mount,fstype}.

  private parseLabeled(line: string): { labels: Record<string, string>; value: number } | null {
    const m = line.match(/^\w+\{([^}]*)\}\s+([\d.eE+-]+)/);
    if (!m) return null;
    const labels: Record<string, string> = {};
    for (const kv of m[1].matchAll(/(\w+)="([^"]*)"/g)) labels[kv[1]] = kv[2];
    return { labels, value: parseFloat(m[2]) };
  }

  private getDiskGroups(lines: string[]): DiskGroup[] {
    const GiB = 1024 ** 3;
    const diskMeta: Record<string, { model: string; size: number }> = {};
    const mSize: Record<string, number> = {};
    const mUsed: Record<string, number> = {};
    const mMeta: Record<string, { disk: string; mount: string; fstype: string }> = {};

    for (const line of lines) {
      if (line.startsWith('nexus_disk_size_bytes{')) {
        const p = this.parseLabeled(line);
        if (p) diskMeta[p.labels['disk']] = { model: p.labels['model'] ?? '', size: p.value };
      } else if (line.startsWith('nexus_mount_size_bytes{')) {
        const p = this.parseLabeled(line);
        if (!p) continue;
        const k = `${p.labels['disk']}|${p.labels['mount']}`;
        mSize[k] = p.value;
        mMeta[k] = { disk: p.labels['disk'], mount: p.labels['mount'], fstype: p.labels['fstype'] ?? '' };
      } else if (line.startsWith('nexus_mount_used_bytes{')) {
        const p = this.parseLabeled(line);
        if (p) mUsed[`${p.labels['disk']}|${p.labels['mount']}`] = p.value;
      }
    }

    const groups: Record<string, DiskGroup> = {};
    for (const [disk, meta] of Object.entries(diskMeta)) {
      groups[disk] = {
        disk, model: meta.model, label: disk,
        totalGB: parseFloat((meta.size / GiB).toFixed(1)),
        mounts: [],
      };
    }
    for (const [k, meta] of Object.entries(mMeta)) {
      const g = groups[meta.disk];
      const total = mSize[k] ?? 0;
      if (!g || total <= 0) continue;
      const used = mUsed[k] ?? 0;
      g.mounts.push({
        mount: meta.mount, fstype: meta.fstype,
        totalGB: parseFloat((total / GiB).toFixed(1)),
        usedGB: parseFloat((used / GiB).toFixed(1)),
        usedPercent: Math.round((used / total) * 100),
      });
    }

    const MOUNT_ORDER = ['/', 'VMs (pool)', '/var/backups/nextcloud-mirror', '/boot/efi',
                         '/mnt/backup', '/mnt/perso', '/mnt/media'];
    const rank = (m: string) => { const i = MOUNT_ORDER.indexOf(m); return i < 0 ? 99 : i; };
    for (const g of Object.values(groups)) {
      g.mounts.sort((a, b) => rank(a.mount) - rank(b.mount));
      g.label = g.disk.startsWith('nvme') ? 'NVMe interne'
        : g.mounts.some(m => m.mount === '/mnt/media') ? 'USB · Média'
        : 'USB · Sauvegarde';
    }
    // NVMe d'abord, puis les USB
    return Object.values(groups).sort(
      (a, b) => (a.disk.startsWith('nvme') ? 0 : 1) - (b.disk.startsWith('nvme') ? 0 : 1)
      || a.disk.localeCompare(b.disk));
  }

  // ── Températures : mappe chip → nom via node_hwmon_chip_names ───────────────

  private getTemps(lines: string[]): TempInfo[] {
    // 1. chip id → nom lisible (k10temp, nvme, amdgpu…)
    const chipNames: Record<string, string> = {};
    for (const line of lines) {
      if (!line.startsWith('node_hwmon_chip_names{')) continue;
      const chip = line.match(/chip="([^"]+)"/)?.[1];
      const name = line.match(/chip_name="([^"]+)"/)?.[1];
      if (chip && name) chipNames[chip] = name;
    }

    // 2. relève les températures des chips qui nous intéressent
    const WANTED: Record<string, string> = { k10temp: 'CPU', nvme: 'NVMe', amdgpu: 'iGPU' };
    const byLabel: Record<string, number> = {};
    for (const line of lines) {
      if (!line.startsWith('node_hwmon_temp_celsius{')) continue;
      const chip = line.match(/chip="([^"]+)"/)?.[1] ?? '';
      const name = chipNames[chip];
      const label = name && WANTED[name];
      if (!label) continue;
      const value = parseFloat(line.split(' ').at(-1) ?? '0') || 0;
      // on garde la plus haute par catégorie (Tctl pour le CPU, Composite pour NVMe…)
      if (value > (byLabel[label] ?? -Infinity)) byLabel[label] = Math.round(value);
    }

    return ['CPU', 'NVMe', 'iGPU']
      .filter(l => byLabel[l] !== undefined)
      .map(label => ({ label, celsius: byLabel[label] }));
  }
}
