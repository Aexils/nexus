import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { NexusService } from '../../core/services/nexus.service';
import { LogLevel, LogSource } from '@nexus/shared-types';

type FilterLevel  = LogLevel | 'all';
type FilterSource = LogSource | 'all';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Dashboard {
  readonly nexus = inject(NexusService);

  // ── Log filters ───────────────────────────────────────────────────────────

  filterLevel  = signal<FilterLevel>('all');
  filterSource = signal<FilterSource>('all');
  showDebug    = signal(false);

  readonly filteredLogs = computed(() => {
    const level  = this.filterLevel();
    const source = this.filterSource();
    const debug  = this.showDebug();
    return this.nexus.logs().filter(e =>
      (debug  || e.level !== 'debug') &&
      (level  === 'all' || e.level  === level) &&
      (source === 'all' || e.source === source),
    );
  });

  setFilterLevel(level: FilterLevel):  void { this.filterLevel.set(level); }
  setFilterSource(src: FilterSource):  void { this.filterSource.set(src); }
  toggleDebug():                       void { this.showDebug.update(v => !v); }
  clearLogs():                         void { this.nexus.logs.set([]); }

  logLevelClass(level: LogLevel): string {
    return level === 'ok' ? 'ok' : level === 'warn' ? 'warn' : level === 'error' ? 'error' : level === 'debug' ? 'debug' : 'info';
  }
  logLevelLabel(level: LogLevel): string {
    return level === 'ok' ? 'OK' : level === 'debug' ? 'DBG' : level.toUpperCase();
  }

  // ── Formatters ────────────────────────────────────────────────────────────

  formatTime(ts: number): string {
    const d = new Date(ts);
    const day   = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const time  = d.toTimeString().slice(0, 8);
    return `${day}/${month} ${time}`;
  }
}
