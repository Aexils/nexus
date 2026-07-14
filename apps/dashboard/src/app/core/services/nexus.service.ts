import { Injectable, signal, inject } from '@angular/core';
import { Socket } from 'ngx-socket-io';
import {
  HostMetrics, NodeMetrics, WorkloadMetric, WS_EVENTS, LogEntry, AppLatestVersions,
  SideloopStatus,
} from '@nexus/shared-types';

const MAX_LOGS = 500;

@Injectable({ providedIn: 'root' })
export class NexusService {
  private readonly socket = inject(Socket);

  // ── Shared signals ────────────────────────────────────────────────────────

  readonly metrics           = signal<HostMetrics | null>(null);
  readonly nodeMetrics       = signal<NodeMetrics[]>([]);
  readonly workloads         = signal<WorkloadMetric[]>([]);
  readonly logs              = signal<LogEntry[]>([]);
  readonly appLatestVersions = signal<AppLatestVersions>({});
  readonly sideloop          = signal<SideloopStatus | null>(null);

  // ── Constructor ───────────────────────────────────────────────────────────

  constructor() {
    this.socket.on(WS_EVENTS.SYSTEM_METRICS, (data: HostMetrics)       => this.metrics.set(data));
    this.socket.on(WS_EVENTS.NODE_METRICS,     (data: NodeMetrics[])     => this.nodeMetrics.set(data));
    this.socket.on(WS_EVENTS.WORKLOAD_METRICS, (data: WorkloadMetric[])  => this.workloads.set(data));
    this.socket.on(WS_EVENTS.APP_VERSIONS,   (data: AppLatestVersions) => this.appLatestVersions.set(data));
    this.socket.on(WS_EVENTS.SIDELOOP_STATUS,  (data: SideloopStatus)    => this.sideloop.set(data));

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
