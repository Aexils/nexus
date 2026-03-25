import { Component, ChangeDetectionStrategy, inject, OnInit, OnDestroy, ChangeDetectorRef, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  LucideAngularModule,
  HardDrive, WifiOff, Server, Monitor, CheckCircle, XCircle, Clock,
  RefreshCw, Database, HardDriveDownload, ArrowDownToLine, Users, Activity,
} from 'lucide-angular';
import { NexusService } from '../../core/services/nexus.service';
import { UrbackupClient, UrbackupActivity } from '@nexus/shared-types';

interface HistoryBar {
  height: number;
  status: 'ok' | 'warn' | 'error' | 'none';
  tip: string;
}

@Component({
  selector: 'app-urbackup-page',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  templateUrl: './urbackup-page.html',
  styleUrl: './urbackup-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UrbackupPage implements OnInit, OnDestroy {
  private readonly cdr   = inject(ChangeDetectorRef);
  private readonly nexus = inject(NexusService);

  readonly urbackup  = this.nexus.urbackupStatus;
  readonly versions  = this.nexus.appLatestVersions;
  readonly now = signal(Date.now());
  private interval?: ReturnType<typeof setInterval>;

  readonly icons = {
    HardDrive, WifiOff, Server, Monitor, CheckCircle, XCircle, Clock,
    RefreshCw, Database, HardDriveDownload, ArrowDownToLine, Users, Activity,
  };

  ngOnInit(): void {
    this.interval = setInterval(() => {
      this.now.set(Date.now());
      this.cdr.markForCheck();
    }, 10_000);
  }

  ngOnDestroy(): void {
    if (this.interval) clearInterval(this.interval);
  }

  // ── Getters ──────────────────────────────────────────────────────────────

  get updateStatus(): 'ok' | 'update' | 'unknown' {
    const current = this.urbackup().serverVersion;
    const latest  = this.versions().urbackup;
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

  get onlineCount():  number { return this.urbackup().clients.filter(c => c.online).length; }
  get totalClients(): number { return this.urbackup().clients.length; }
  get isRunning():    boolean { return this.urbackup().activeProgress.length > 0; }

  get lastBackupTs(): number | null {
    const timestamps = this.urbackup().clients
      .flatMap(c => [c.lastFileBackup, c.lastImageBackup])
      .filter((t): t is number => t !== null);
    return timestamps.length ? Math.max(...timestamps) : null;
  }

  get totalStorageGB(): number {
    return this.urbackup().clients.reduce((sum, c) => sum + c.filesUsedGB + c.imagesUsedGB, 0);
  }

  get healthyCount(): number {
    return this.urbackup().clients.filter(c => this.clientHealth(c) === 'ok').length;
  }

  get overallHealth(): 'ok' | 'warn' | 'error' {
    const clients = this.urbackup().clients;
    if (!clients.length) return 'warn';
    if (clients.some(c => this.clientHealth(c) === 'error')) return 'error';
    if (clients.some(c => this.clientHealth(c) === 'warn')) return 'warn';
    return 'ok';
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  formatTs(unixSec: number): string {
    return new Date(unixSec * 1000).toLocaleString('fr-FR', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  formatTsShort(unixSec: number): string {
    return new Date(unixSec * 1000).toLocaleString('fr-FR', {
      day: '2-digit', month: 'short',
      hour: '2-digit', minute: '2-digit',
    });
  }

  relativeTs(unixSec: number): string {
    const diffMs   = this.now() - unixSec * 1000;
    const diffDays = Math.floor(diffMs / 86_400_000);
    const diffH    = Math.floor(diffMs / 3_600_000);
    const diffMin  = Math.floor(diffMs / 60_000);
    if (diffMin < 1)  return "à l'instant";
    if (diffH < 1)    return `il y a ${diffMin}min`;
    if (diffH < 24)   return `il y a ${diffH}h`;
    if (diffDays < 7) return `il y a ${diffDays}j`;
    return new Date(unixSec * 1000).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  formatDuration(sec: number): string {
    if (!sec) return '—';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (h > 0) return `${h}h ${m}min`;
    return `${m}min`;
  }

  formatSize(gb: number): string {
    if (gb >= 1000) return `${(gb / 1000).toFixed(1)} TB`;
    if (gb >= 1)    return `${gb.toFixed(1)} GB`;
    return `${(gb * 1000).toFixed(0)} MB`;
  }

  activityType(act: UrbackupActivity): string {
    if (act.isImage) return act.isIncremental ? 'Image incr.' : 'Image complète';
    return act.isIncremental ? 'Fichiers incr.' : 'Fichiers complets';
  }

  activityTypeShort(act: UrbackupActivity): string {
    if (act.isImage) return act.isIncremental ? 'img-incr' : 'img-full';
    return act.isIncremental ? 'files-incr' : 'files-full';
  }

  actionLabel(action: number): string {
    switch (action) {
      case 0: return 'Image complète';
      case 1: return 'Fichiers complets';
      case 2: return 'Image incr.';
      case 3: return 'Fichiers incr.';
      default: return 'Backup';
    }
  }

  actionTypeShort(action: number): string {
    switch (action) {
      case 0: return 'img-full';
      case 1: return 'files-full';
      case 2: return 'img-incr';
      case 3: return 'files-incr';
      default: return 'img-full';
    }
  }

  osLabel(osSimple: string): string {
    const s = osSimple?.toLowerCase();
    if (s === 'windows') return 'Windows';
    if (s === 'linux')   return 'Linux';
    if (s === 'macos')   return 'macOS';
    return osSimple || '—';
  }

  clientHealth(client: UrbackupClient): 'ok' | 'warn' | 'error' {
    if (!client.lastFileBackup && !client.lastImageBackup) return 'warn';
    const latestTs = Math.max(client.lastFileBackup ?? 0, client.lastImageBackup ?? 0);
    const ageDays  = (this.now() - latestTs * 1000) / 86_400_000;
    if (ageDays > 7) return 'error';
    if (ageDays > 2) return 'warn';
    return 'ok';
  }

  /**
   * Generates 14 bars representing the last 14 days of backup activity for a client.
   * Uses recent activities to populate bar data.
   */
  clientHistoryBars(client: UrbackupClient): HistoryBar[] {
    const bars: HistoryBar[] = [];
    const nowMs = this.now();
    const activities = this.urbackup().recentActivities.filter(a => a.clientId === client.id);

    for (let i = 13; i >= 0; i--) {
      const dayStart = nowMs - (i + 1) * 86_400_000;
      const dayEnd   = nowMs - i * 86_400_000;
      const dayActs  = activities.filter(a => {
        const ts = a.backupTime * 1000;
        return ts >= dayStart && ts < dayEnd;
      });

      if (dayActs.length > 0) {
        const maxSize = Math.max(...dayActs.map(a => a.sizeGB));
        const height  = Math.max(20, Math.min(100, (maxSize / 70) * 100));
        const date    = new Date(dayEnd).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
        bars.push({ height, status: 'ok', tip: `${date} · ${dayActs.length} backup(s)` });
      } else {
        // Check if client existed and should have had a backup
        const date = new Date(dayEnd).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
        bars.push({ height: 8, status: 'none', tip: `${date} · aucun backup` });
      }
    }
    return bars;
  }

  trackClient(i: number, c: UrbackupClient) { return c.id; }
  trackActivity(i: number, a: UrbackupActivity) { return a.id; }
  trackBar(i: number) { return i; }
}
