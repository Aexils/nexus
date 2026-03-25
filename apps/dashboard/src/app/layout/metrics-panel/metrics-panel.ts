import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, Download, Upload } from 'lucide-angular';
import { NexusService } from '../../core/services/nexus.service';
import { DiskInfo, GpuInfo } from '@nexus/shared-types';

@Component({
  selector: 'nxs-metrics-panel',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  templateUrl: './metrics-panel.html',
  styleUrl: './metrics-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MetricsPanelComponent {
  readonly nexus = inject(NexusService);
  readonly icons = { Download, Upload };

  get m()       { return this.nexus.metrics(); }
  get cpu()     { return this.m?.cpuPercent ?? 0; }
  get ramPct()  { return this.m?.ramPercent ?? 0; }
  get ramUsed() { return (this.m?.ramUsedGB ?? 0).toFixed(1); }
  get ramTotal(){ return (this.m?.ramTotalGB ?? 0).toFixed(1); }
  get disks()   { return this.m?.disks ?? []; }
  get gpus()    { return this.m?.gpus ?? []; }
  get cpuTemp() { return this.m?.cpuTempCelsius ?? null; }
  get windowsProductName() { return this.m?.windowsProductName; }
  get windowsBuild()       { return this.m?.windowsBuild; }
  get pendingUpdates()     { return this.m?.pendingUpdates ?? null; }
  get dockerVersion()      { return this.m?.dockerVersion; }

  get bookloreOk()  {
    const map = this.nexus.bookloreStatusMap();
    return map.alexis.connected || map.marion.connected;
  }
  get bookloreVersion() {
    const map = this.nexus.bookloreStatusMap();
    return map.alexis.version ?? map.marion.version;
  }
  get kodiOk()      { return this.nexus.kodiStatus().connected; }
  get absOk()       { return this.nexus.absStatusMap().alexis.connected || this.nexus.absStatusMap().marion.connected; }
  get urbOk()       { return this.nexus.urbackupStatus().connected; }
  get sdlyOk()       { return this.nexus.sideloadlyStatus().connected; }
  get sdlyVersion()  { return this.nexus.sideloadlyStatus().version; }
  get jellyfinOk()  { return this.nexus.jellyfinStatus().connected; }
  get rx()      { return this.formatNet(this.m?.netRxBytesPerSec ?? 0); }
  get tx()      { return this.formatNet(this.m?.netTxBytesPerSec ?? 0); }

  // ── Versions ──────────────────────────────────────────────────────────────

  get kodiVersion()  { return this.nexus.kodiStatus().version; }
  get absVersion()   {
    return this.nexus.absStatusMap().alexis.version ?? this.nexus.absStatusMap().marion.version;
  }
  get urbVersion()       { return this.nexus.urbackupStatus().serverVersion || undefined; }
  get jellyfinVersion()  { return this.nexus.jellyfinStatus().version; }

  get latestVersions() { return this.nexus.appLatestVersions(); }

  versionStatus(current: string | undefined, latest: string | undefined): 'ok' | 'update' | 'unknown' {
    if (!current || !latest) return 'unknown';
    const parse = (s: string) => s.replace(/^v/, '').split('-')[0].split('.').map(n => parseInt(n, 10) || 0);
    const cur = parse(current);
    const lat = parse(latest);
    for (let i = 0; i < Math.max(cur.length, lat.length); i++) {
      const c = cur[i] ?? 0;
      const l = lat[i] ?? 0;
      if (l > c) return 'update';
      if (c > l) return 'ok';
    }
    return 'ok';
  }

  formatNet(bytes: number): string {
    if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB/s';
    if (bytes >= 1024)        return Math.round(bytes / 1024) + ' KB/s';
    return bytes + ' B/s';
  }

  formatDisk(gb: number): string {
    if (gb >= 1024) return (gb / 1024).toFixed(2) + ' To';
    return Math.round(gb) + ' Go';
  }

  diskClass(d: DiskInfo): string {
    if (d.usedPercent >= 90) return 'crit';
    if (d.usedPercent >= 75) return 'warn';
    return 'ok';
  }

  tempClass(t: number): string {
    if (t >= 85) return 'crit';
    if (t >= 70) return 'warn';
    return 'ok';
  }

  gpuLabel(g: GpuInfo): string {
    return this.gpus.length > 1 ? `GPU ${g.index}` : 'GPU';
  }
}
