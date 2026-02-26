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
  get kodiOk()  { return this.nexus.kodiStatus().connected; }
  get absOk()   { return this.nexus.absStatus().connected; }
  get rx()      { return this.formatNet(this.m?.netRxBytesPerSec ?? 0); }
  get tx()      { return this.formatNet(this.m?.netTxBytesPerSec ?? 0); }

  formatNet(bytes: number): string {
    if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB/s';
    if (bytes >= 1024)        return Math.round(bytes / 1024) + ' KB/s';
    return bytes + ' B/s';
  }

  formatDisk(gb: number): string {
    if (gb >= 1000) return (gb / 1000).toFixed(2) + ' TB';
    return Math.round(gb) + ' GB';
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
