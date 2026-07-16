import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { NexusService } from '../../core/services/nexus.service';
import { PageHeaderComponent } from '../../shared/page-header/page-header';
import { LogLevel, LogSource, WorkloadMetric } from '@nexus/shared-types';

type FilterLevel  = LogLevel | 'all';
type FilterSource = LogSource | 'all';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, PageHeaderComponent],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Dashboard {
  readonly nexus = inject(NexusService);

  // ── Nœuds ───────────────────────────────────────────────────────────────
  readonly nodes = this.nexus.nodeMetrics;

  // ── Workloads (apps) — séparés workload / infra ─────────────────────────
  readonly apps  = computed(() => this.nexus.workloads().filter(w => w.kind === 'workload'));
  readonly infra = computed(() => this.nexus.workloads().filter(w => w.kind === 'infra'));

  readonly totalCpu = computed(() => this.nexus.workloads().reduce((s, w) => s + w.cpuMillicores, 0));
  readonly totalRam = computed(() => this.nexus.workloads().reduce((s, w) => s + w.ramBytes, 0));

  // Namespaces dépliés (clic-clic)
  private readonly expanded = signal<Set<string>>(new Set());
  isExpanded(ns: string): boolean { return this.expanded().has(ns); }
  toggle(ns: string): void {
    this.expanded.update(set => {
      const next = new Set(set);
      next.has(ns) ? next.delete(ns) : next.add(ns);
      return next;
    });
  }

  // ── Formatters ──────────────────────────────────────────────────────────
  fmtCpu(m: number): string {
    return m >= 1000 ? (m / 1000).toFixed(2) + ' cœ' : m + ' m';
  }
  fmtRam(bytes: number): string {
    const Mi = bytes / (1024 ** 2);
    return Mi >= 1024 ? (Mi / 1024).toFixed(2) + ' Go' : Math.round(Mi) + ' Mo';
  }
  wlHealthClass(w: WorkloadMetric): string {
    return w.readyCount === w.podCount ? 'ok' : w.readyCount === 0 ? 'crit' : 'warn';
  }
  nodeBarClass(pct: number): string {
    return pct >= 90 ? 'crit' : pct >= 75 ? 'warn' : 'ok';
  }

  // ── Journal ─────────────────────────────────────────────────────────────
  filterLevel  = signal<FilterLevel>('all');
  filterSource = signal<FilterSource>('all');
  showDebug    = signal(false);

  // Chips construites depuis les sources réellement présentes dans le journal
  readonly logSources = computed<FilterSource[]>(() => {
    const present = new Set(this.nexus.logs().map(e => e.source));
    return ['all', ...[...present].sort()];
  });

  readonly filteredLogs = computed(() => {
    const level  = this.filterLevel();
    const source = this.filterSource();
    const debug  = this.showDebug();
    return this.nexus.logs().filter(e =>
      (debug || e.level !== 'debug') &&
      (level === 'all' || e.level === level) &&
      (source === 'all' || e.source === source),
    );
  });

  setFilterLevel(level: FilterLevel): void { this.filterLevel.set(level); }
  setFilterSource(source: FilterSource): void { this.filterSource.set(source); }
  toggleDebug(): void { this.showDebug.update(v => !v); }
  clearLogs(): void {
    this.nexus.logs.set([]);
    this.filterSource.set('all');
  }

  logLevelClass(level: LogLevel): string {
    return level === 'ok' ? 'ok' : level === 'warn' ? 'warn' : level === 'error' ? 'error' : level === 'debug' ? 'debug' : 'info';
  }
  logLevelLabel(level: LogLevel): string {
    return level === 'ok' ? 'OK' : level === 'debug' ? 'DBG' : level.toUpperCase();
  }
  formatTime(ts: number): string {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  }
}
