import { Component, ChangeDetectionStrategy, inject, effect, signal, untracked, WritableSignal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { LucideAngularModule, Download, Upload, HardDrive, ChevronRight } from 'lucide-angular';
import { NexusService } from '../../core/services/nexus.service';
import { DiskInfo, TempInfo, VersionItem } from '@nexus/shared-types';

const MOUNT_LABELS: Record<string, string> = {
  '/': 'système',
  'VMs (pool)': 'VMs',
  '/var/backups/nextcloud-mirror': 'miroir Nextcloud',
  '/boot/efi': 'boot',
  '/mnt/backup': 'sauvegardes',
  '/mnt/perso': 'perso',
  '/mnt/media': 'média',
};

@Component({
  selector: 'nxs-metrics-panel',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, RouterLink],
  templateUrl: './metrics-panel.html',
  styleUrl: './metrics-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MetricsPanelComponent {
  readonly nexus = inject(NexusService);
  readonly icons = { Download, Upload, HardDrive, ChevronRight };

  // ── Sparklines : historique glissant accumulé depuis le flux live ──
  private readonly HISTORY = 40;                 // ~2 min à 3 s/point
  readonly cpuHistory = signal<number[]>([]);
  readonly ramHistory = signal<number[]>([]);

  constructor() {
    effect(() => {
      const m = this.nexus.metrics();
      if (!m) return;
      this.pushHist(this.cpuHistory, m.cpuPercent);
      this.pushHist(this.ramHistory, m.ramPercent);
    }, { allowSignalWrites: true });
  }

  private pushHist(sig: WritableSignal<number[]>, v: number): void {
    // ⚠ untracked : sans ça, l'effect LIT le signal qu'il ÉCRIT → boucle infinie
    // (re-déclenchement à chaque tick → CPU/mémoire qui explosent → crash onglet).
    const arr = [...untracked(sig), v];
    while (arr.length > this.HISTORY) arr.shift();
    sig.set(arr);
  }

  /** Points d'une polyline SVG (viewBox 100×24) à partir d'un historique 0–100. */
  spark(values: number[]): string {
    if (values.length < 2) return '';
    const w = 100, h = 24, step = w / (this.HISTORY - 1);
    const offset = this.HISTORY - values.length;
    return values
      .map((v, i) => {
        const x = (i + offset) * step;
        const y = h - (Math.min(100, Math.max(0, v)) / 100) * h;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }

  get m()          { return this.nexus.metrics(); }
  get cpu()        { return this.m?.cpuPercent ?? 0; }
  get ramPct()     { return this.m?.ramPercent ?? 0; }
  get ramUsed()    { return (this.m?.ramUsedGB ?? 0).toFixed(1); }
  get ramTotal()   { return (this.m?.ramTotalGB ?? 0).toFixed(1); }
  get disks()      { return this.m?.disks ?? []; }
  get diskGroups() { return this.m?.diskGroups ?? []; }
  get temps()      { return this.m?.temps ?? []; }

  mountLabel(mount: string): string { return MOUNT_LABELS[mount] ?? mount; }

  // ── Versions (widget compact : applications seulement) ──
  get appVersions(): VersionItem[] {
    return (this.nexus.versions()?.items ?? []).filter(i => i.category === 'application');
  }
  versionState(i: VersionItem): 'ok' | 'update' | 'unknown' {
    return i.upToDate === true ? 'ok' : i.upToDate === false ? 'update' : 'unknown';
  }
  get cpuTemp() { return this.m?.cpuTempCelsius ?? null; }
  get rx()      { return this.formatNet(this.m?.netRxBytesPerSec ?? 0); }
  get tx()      { return this.formatNet(this.m?.netTxBytesPerSec ?? 0); }

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

  trackTemp(_: number, t: TempInfo): string { return t.label; }
}
