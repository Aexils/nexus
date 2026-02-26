import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import * as os from 'os';
import * as fs from 'fs';
import { NexusGateway } from '../gateway/nexus.gateway';
import { DiskInfo, GpuInfo, SystemMetrics } from '@nexus/shared-types';

interface CpuSnapshot { idle: number; total: number; }
interface NetSnapshot { rx: number; tx: number; }

// When HOST_METRICS_URL is set (Docker), query windows_exporter for real Windows
// host stats. Otherwise fall back to local /proc (dev on Linux/WSL).
const HOST_METRICS_URL = process.env['HOST_METRICS_URL'];
const PROC_PATH = process.env['HOST_PROC'] ?? '/proc';

@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);

  // Local /proc state
  private prevCpu: CpuSnapshot[] | null = null;
  private prevNet: NetSnapshot | null = null;
  private localInitialized = false;

  // windows_exporter state
  private prevWinCpu: CpuSnapshot | null = null;
  private prevWinNet: NetSnapshot | null = null;
  private winInitialized = false;

  // One-shot warn guards
  private warnWinExporterEmitted = false;
  private warnProcNetEmitted = false;

  constructor(private readonly gateway: NexusGateway) {
    if (HOST_METRICS_URL) {
      this.logger.log(`Windows host metrics via: ${HOST_METRICS_URL}`);
      this.gateway.addLog('debug', 'system', `Métriques Windows via: ${HOST_METRICS_URL}`);
    } else {
      this.logger.log(`Local metrics via: ${PROC_PATH}`);
      this.gateway.addLog('debug', 'system', `Métriques locales via: ${PROC_PATH}`);
    }
  }

  @Interval(3000)
  async collect() {
    if (HOST_METRICS_URL) {
      await this.collectWindows();
    } else {
      this.collectLocal();
    }
  }

  // ── Windows Exporter (Docker mode) ──────────────────────────────────────────

  private async collectWindows() {
    let raw: string;
    try {
      const res = await fetch(HOST_METRICS_URL!);
      raw = await res.text();
    } catch {
      this.logger.warn('Cannot reach windows_exporter at ' + HOST_METRICS_URL);
      if (!this.warnWinExporterEmitted) {
        this.warnWinExporterEmitted = true;
        this.gateway.addLog('warn', 'system', `windows_exporter inaccessible — ${HOST_METRICS_URL}`);
      }
      return;
    }

    this.warnWinExporterEmitted = false;
    const cpuPercent = this.getWinCpu(raw);
    const ram = this.getWinRam(raw);
    const net = this.getWinNet(raw);
    const disks = this.getWinDisks(raw);
    const gpus = this.getWinGpus(raw);
    const cpuTempCelsius = this.getWinCpuTemp(raw);

    if (!this.winInitialized) {
      this.winInitialized = true;
      return; // first tick seeds baselines
    }

    this.gateway.emitSystemMetrics({
      cpuPercent,
      ...ram,
      netRxBytesPerSec: net.rx,
      netTxBytesPerSec: net.tx,
      disks,
      gpus,
      cpuTempCelsius,
      timestamp: Date.now(),
    });
  }

  private getWinCpu(raw: string): number {
    let idle = 0;
    let total = 0;

    for (const line of raw.split('\n')) {
      if (!line.startsWith('windows_cpu_time_total{')) continue;
      const value = parseFloat(line.split(' ').at(-1) ?? '0') || 0;
      total += value;
      if (line.includes('mode="idle"')) idle += value;
    }

    if (!this.prevWinCpu) {
      this.prevWinCpu = { idle, total };
      return 0;
    }

    const idleDelta = idle - this.prevWinCpu.idle;
    const totalDelta = total - this.prevWinCpu.total;
    this.prevWinCpu = { idle, total };

    if (totalDelta <= 0) return 0;
    return Math.round(100 * (1 - idleDelta / totalDelta));
  }

  private getWinRam(raw: string): { ramPercent: number; ramUsedGB: number; ramTotalGB: number } {
    let total = 0;
    let free = 0;

    for (const line of raw.split('\n')) {
      if (line.startsWith('windows_memory_physical_total_bytes ')) {
        total = parseFloat(line.split(' ').at(-1) ?? '0') || 0;
      }
      if (line.startsWith('windows_memory_physical_free_bytes ')) {
        free = parseFloat(line.split(' ').at(-1) ?? '0') || 0;
      }
    }

    // If windows_exporter didn't return memory metrics, fall back to os module
    if (total === 0) {
      total = os.totalmem();
      free = os.freemem();
    }

    const used = total - free;
    const GiB = 1024 * 1024 * 1024;
    return {
      ramTotalGB: parseFloat((total / GiB).toFixed(1)),
      ramUsedGB: parseFloat((used / GiB).toFixed(1)),
      ramPercent: Math.round((used / total) * 100),
    };
  }

  private getWinNet(raw: string): { rx: number; tx: number } {
    // Skip virtual/tunnel/loopback adapters
    const SKIP = /loopback|isatap|teredo|6to4|virtual|vmware|vethernet/i;
    let rx = 0;
    let tx = 0;

    for (const line of raw.split('\n')) {
      const isRx = line.startsWith('windows_net_bytes_received_total{');
      const isTx = line.startsWith('windows_net_bytes_sent_total{');
      if (!isRx && !isTx) continue;

      const nicMatch = line.match(/nic="([^"]+)"/);
      if (!nicMatch || SKIP.test(nicMatch[1])) continue;

      const value = parseFloat(line.split(' ').at(-1) ?? '0') || 0;
      if (isRx) rx += value;
      if (isTx) tx += value;
    }

    const rxPerSec = this.prevWinNet ? Math.max(0, Math.round((rx - this.prevWinNet.rx) / 3)) : 0;
    const txPerSec = this.prevWinNet ? Math.max(0, Math.round((tx - this.prevWinNet.tx) / 3)) : 0;
    this.prevWinNet = { rx, tx };
    return { rx: rxPerSec, tx: txPerSec };
  }

  private getWinDisks(raw: string): DiskInfo[] {
    // Skip the aggregate and system-reserved micro-volumes
    const SKIP = /^(_Total$|HarddiskVolume)/;
    const sizes: Record<string, number> = {};
    const frees: Record<string, number> = {};

    for (const line of raw.split('\n')) {
      const isSize = line.startsWith('windows_logical_disk_size_bytes{');
      const isFree = line.startsWith('windows_logical_disk_free_bytes{');
      if (!isSize && !isFree) continue;

      const volMatch = line.match(/volume="([^"]+)"/);
      if (!volMatch || SKIP.test(volMatch[1])) continue;

      const value = parseFloat(line.split(' ').at(-1) ?? '0') || 0;
      const vol = volMatch[1];
      if (isSize) sizes[vol] = value;
      if (isFree) frees[vol] = value;
    }

    return Object.keys(sizes)
      .filter(vol => sizes[vol] > 1e9) // ignore recovery/EFI partitions < 1 GB
      .sort()
      .map(vol => {
        const total = sizes[vol];
        const free = frees[vol] ?? 0;
        const used = total - free;
        return {
          mount: vol,
          totalGB: parseFloat((total / 1e9).toFixed(1)),
          usedGB: parseFloat((used / 1e9).toFixed(1)),
          usedPercent: Math.round((used / total) * 100),
        };
      });
  }

  private getWinGpus(raw: string): GpuInfo[] {
    // Group metrics by phys_adapter_idx
    const map = new Map<number, Partial<GpuInfo>>();
    const ensure = (idx: number) => {
      if (!map.has(idx)) map.set(idx, { index: idx, usedPercent: 0, vramUsedGB: 0, vramTotalGB: 0, tempCelsius: null });
      return map.get(idx)!;
    };

    for (const line of raw.split('\n')) {
      const is3D    = line.startsWith('windows_gpu_engine_running_time_percent{') && line.includes('engine_type="3D"');
      const isVramU = line.startsWith('windows_gpu_adapter_memory_used_bytes{');
      const isVramT = line.startsWith('windows_gpu_adapter_memory_size_bytes{');
      const isTemp  = line.startsWith('windows_gpu_temperature_celsius{');
      if (!is3D && !isVramU && !isVramT && !isTemp) continue;

      const idxMatch = line.match(/phys_adapter_idx="(\d+)"/);
      if (!idxMatch) continue;

      const idx   = parseInt(idxMatch[1], 10);
      const value = parseFloat(line.split(' ').at(-1) ?? '0') || 0;
      const g     = ensure(idx);

      if (is3D)    g.usedPercent = Math.round(value);
      if (isVramU) g.vramUsedGB  = parseFloat((value / 1e9).toFixed(1));
      if (isVramT) g.vramTotalGB = parseFloat((value / 1e9).toFixed(1));
      if (isTemp)  g.tempCelsius = Math.round(value);
    }

    return [...map.values()]
      .filter(g => g.vramTotalGB! > 0) // only real GPUs (not display-only adapters)
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .map(g => ({
        index:        g.index        ?? 0,
        usedPercent:  g.usedPercent  ?? 0,
        vramUsedGB:   g.vramUsedGB   ?? 0,
        vramTotalGB:  g.vramTotalGB  ?? 0,
        tempCelsius:  g.tempCelsius  ?? null,
      }));
  }

  private getWinCpuTemp(raw: string): number | null {
    // Requires thermalzone collector: --collectors.enabled ...,thermalzone
    const temps: number[] = [];
    for (const line of raw.split('\n')) {
      if (!line.startsWith('windows_thermalzone_temperature_celsius{')) continue;
      const value = parseFloat(line.split(' ').at(-1) ?? '0');
      if (value > 0) temps.push(value);
    }
    return temps.length > 0 ? Math.round(Math.max(...temps)) : null;
  }

  // ── Local /proc (dev mode) ──────────────────────────────────────────────────

  private collectLocal() {
    const cpuPercent = this.getCpuPercent();
    const ram = this.getRam();
    const net = this.getNet();
    const disks = this.getLocalDisks();
    const cpuTempCelsius = this.getLocalCpuTemp();

    if (!this.localInitialized) {
      this.localInitialized = true;
      return;
    }

    this.gateway.emitSystemMetrics({
      cpuPercent,
      ...ram,
      netRxBytesPerSec: net.rx,
      netTxBytesPerSec: net.tx,
      disks,
      gpus: [],
      cpuTempCelsius,
      timestamp: Date.now(),
    });
  }

  private getCpuPercent(): number {
    const cpus = os.cpus();
    const current: CpuSnapshot[] = cpus.map(cpu => {
      const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
      return { idle: cpu.times.idle, total };
    });

    if (!this.prevCpu) {
      this.prevCpu = current;
      return 0;
    }

    const percents = current.map((snap, i) => {
      const prev = this.prevCpu![i];
      const idleDelta = snap.idle - prev.idle;
      const totalDelta = snap.total - prev.total;
      if (totalDelta === 0) return 0;
      return 100 * (1 - idleDelta / totalDelta);
    });

    this.prevCpu = current;
    return Math.round(percents.reduce((a, b) => a + b, 0) / percents.length);
  }

  private getRam(): { ramPercent: number; ramUsedGB: number; ramTotalGB: number } {
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;
    const GiB = 1024 * 1024 * 1024;
    return {
      ramTotalGB: parseFloat((total / GiB).toFixed(1)),
      ramUsedGB: parseFloat((used / GiB).toFixed(1)),
      ramPercent: Math.round((used / total) * 100),
    };
  }

  private getNet(): { rx: number; tx: number } {
    let rxBytes = 0;
    let txBytes = 0;

    try {
      const raw = fs.readFileSync(`${PROC_PATH}/net/dev`, 'utf8');
      for (const line of raw.split('\n').slice(2)) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 10) continue;
        const iface = parts[0].replace(':', '');
        if (iface === 'lo') continue;
        rxBytes += parseInt(parts[1], 10) || 0;
        txBytes += parseInt(parts[9], 10) || 0;
      }
    } catch {
      this.logger.warn('Cannot read /proc/net/dev');
      if (!this.warnProcNetEmitted) {
        this.warnProcNetEmitted = true;
        this.gateway.addLog('warn', 'system', 'Impossible de lire /proc/net/dev');
      }
    }

    const rxPerSec = this.prevNet ? Math.max(0, Math.round((rxBytes - this.prevNet.rx) / 3)) : 0;
    const txPerSec = this.prevNet ? Math.max(0, Math.round((txBytes - this.prevNet.tx) / 3)) : 0;
    this.prevNet = { rx: rxBytes, tx: txBytes };
    return { rx: rxPerSec, tx: txPerSec };
  }

  private getLocalDisks(): DiskInfo[] {
    const disks: DiskInfo[] = [];
    const seen = new Set<string>();

    // Enumerate real block-backed filesystems from /proc/mounts
    const REAL_FS = new Set(['ext4', 'ext3', 'btrfs', 'xfs', 'f2fs', '9p', 'fuseblk']);
    let mountPoints: string[] = [];

    try {
      const mounts = fs.readFileSync('/proc/mounts', 'utf8');
      for (const line of mounts.split('\n')) {
        const [, mp, fstype] = line.split(' ');
        if (mp && fstype && REAL_FS.has(fstype) && !seen.has(mp)) {
          seen.add(mp);
          mountPoints.push(mp);
        }
      }
    } catch {
      mountPoints = ['/'];
    }

    for (const mp of mountPoints) {
      try {
        const stat = (fs as any).statfsSync(mp) as {
          bsize: number; blocks: number; bfree: number; bavail: number;
        };
        const total = stat.blocks * stat.bsize;
        if (total < 1e9) continue; // skip tiny mounts
        const free = stat.bavail * stat.bsize;
        const used = total - free;
        disks.push({
          mount: mp,
          totalGB: parseFloat((total / 1e9).toFixed(1)),
          usedGB: parseFloat((used / 1e9).toFixed(1)),
          usedPercent: Math.round((used / total) * 100),
        });
      } catch {
        // skip inaccessible mountpoints
      }
    }

    return disks;
  }

  private getLocalCpuTemp(): number | null {
    // Reads from /sys/class/thermal (Linux) — typically x86_pkg_temp on Intel
    const temps: number[] = [];
    try {
      const zones = fs.readdirSync('/sys/class/thermal');
      for (const zone of zones) {
        if (!zone.startsWith('thermal_zone')) continue;
        try {
          const type = fs.readFileSync(`/sys/class/thermal/${zone}/type`, 'utf8').trim();
          if (!/(cpu|x86_pkg_temp|pkg-temp)/i.test(type)) continue;
          const raw = parseInt(fs.readFileSync(`/sys/class/thermal/${zone}/temp`, 'utf8'), 10);
          if (raw > 0) temps.push(raw / 1000); // millidegrees → degrees
        } catch { continue; }
      }
    } catch { /* /sys not available */ }
    return temps.length > 0 ? Math.round(Math.max(...temps)) : null;
  }
}
