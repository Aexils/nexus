import { Injectable, signal, inject } from '@angular/core';
import { Socket } from 'ngx-socket-io';
import {
  SystemMetrics, WS_EVENTS, LogEntry, AppLatestVersions,
} from '@nexus/shared-types';

const MAX_LOGS = 500;

@Injectable({ providedIn: 'root' })
export class NexusService {
  private readonly socket = inject(Socket);

  // ── Shared signals ────────────────────────────────────────────────────────

  readonly metrics           = signal<SystemMetrics | null>(null);
  readonly logs              = signal<LogEntry[]>([]);
  readonly appLatestVersions = signal<AppLatestVersions>({});

  // ── Constructor ───────────────────────────────────────────────────────────

  constructor() {
    this.socket.on(WS_EVENTS.SYSTEM_METRICS, (data: SystemMetrics)     => this.metrics.set(data));
    this.socket.on(WS_EVENTS.APP_VERSIONS,   (data: AppLatestVersions) => this.appLatestVersions.set(data));

    this.socket.on(WS_EVENTS.LOG_ENTRY, (entry: LogEntry) => {
      this.logs.update(prev => {
        const next = [entry, ...prev];
        return next.length > MAX_LOGS ? next.slice(0, MAX_LOGS) : next;
      });
    });

    this.socket.on('log:history', (entries: LogEntry[]) => {
      this.logs.set([...entries].reverse());
    });
  }
}
