import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { NexusGateway } from '../gateway/nexus.gateway';
import { DiskInfo, HostMetrics, TempInfo } from '@nexus/shared-types';

interface CpuSnapshot { idle: number; total: number; }
interface NetSnapshot { rx: number; tx: number; }

// node_exporter sur l'hôte Proxmox (pve) — métriques globales du mini-PC.
const NODE_EXPORTER_URL = process.env['NODE_EXPORTER_URL'] ?? 'http://10.10.10.1:9100/metrics';

// Mountpoints réels à afficher (on ignore /boot/efi, /etc/pve, tmpfs, lxcfs…).
const REAL_MOUNTS = ['/', '/mnt/backup', '/mnt/perso', '/mnt/media', '/var/backups/nextcloud-mirror'];

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
    const disks = this.getDisks(lines);
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

  private getNet(lines: string[]): { rx: number; tx: number } | null {
    let rx = 0;
    let tx = 0;
    for (const line of lines) {
      const isRx = line.startsWith('node_network_receive_bytes_total{');
      const isTx = line.startsWith('node_network_transmit_bytes_total{');
      if (!isRx && !isTx) continue;
      const dev = line.match(/device="([^"]+)"/)?.[1] ?? '';
      if (dev === 'lo' || dev.startsWith('veth') || dev.startsWith('cali') || dev.startsWith('vxlan') || dev.startsWith('tap')) continue;
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

  private getDisks(lines: string[]): DiskInfo[] {
    const sizes: Record<string, number> = {};
    const avails: Record<string, number> = {};
    for (const line of lines) {
      const isSize = line.startsWith('node_filesystem_size_bytes{');
      const isAvail = line.startsWith('node_filesystem_avail_bytes{');
      if (!isSize && !isAvail) continue;
      const mount = line.match(/mountpoint="([^"]+)"/)?.[1] ?? '';
      if (!REAL_MOUNTS.includes(mount)) continue;
      const value = parseFloat(line.split(' ').at(-1) ?? '0') || 0;
      if (isSize) sizes[mount] = value;
      if (isAvail) avails[mount] = value;
    }
    const GiB = 1024 ** 3;
    return REAL_MOUNTS
      .filter(m => sizes[m] > 0)
      .map(mount => {
        const total = sizes[mount];
        const avail = avails[mount] ?? 0;
        const used = total - avail;
        return {
          mount,
          totalGB: parseFloat((total / GiB).toFixed(1)),
          usedGB: parseFloat((used / GiB).toFixed(1)),
          usedPercent: Math.round((used / total) * 100),
        };
      });
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
