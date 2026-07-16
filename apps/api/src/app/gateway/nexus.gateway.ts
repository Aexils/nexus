import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { NotifierService } from '../notifier/notifier.service';
import { LogStoreService } from './log-store.service';
import {
  HostMetrics, NodeMetrics, WorkloadMetric, WS_EVENTS, LogEntry, LogLevel, LogSource, VersionsReport,
  SideloopStatus,
} from '@nexus/shared-types';

const LOG_BUFFER_MAX = 500;

@WebSocketGateway({ cors: { origin: '*' } })
export class NexusGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(NexusGateway.name);
  private readonly logBuffer: LogEntry[] = [];

  // ── Last-known-state cache (rejoué aux nouveaux clients à la connexion) ─────

  private cachedMetrics:     HostMetrics       | null = null;
  private cachedNodeMetrics: NodeMetrics[]     | null = null;
  private cachedWorkloads:   WorkloadMetric[]  | null = null;
  private cachedVersions:    VersionsReport | null = null;
  private cachedSideloop:    SideloopStatus    | null = null;

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly notifier: NotifierService,
    private readonly store: LogStoreService,
  ) {}

  afterInit() {
    this.logger.log('WebSocket gateway initialized');
    // Re-remplit le buffer depuis SQLite : le Journal survit aux restarts du pod
    this.logBuffer.push(...this.store.loadRecent(LOG_BUFFER_MAX));
    this.addLog('info', 'nexus', 'NEXUS démarré — WebSocket gateway prêt');
  }

  handleConnection(client: Socket) {
    this.logger.debug(`Client connected: ${client.id}`);
    if (this.logBuffer.length > 0)   client.emit('log:history', this.logBuffer);
    if (this.cachedMetrics)          client.emit(WS_EVENTS.SYSTEM_METRICS, this.cachedMetrics);
    if (this.cachedNodeMetrics)      client.emit(WS_EVENTS.NODE_METRICS, this.cachedNodeMetrics);
    if (this.cachedWorkloads)        client.emit(WS_EVENTS.WORKLOAD_METRICS, this.cachedWorkloads);
    if (this.cachedVersions)         client.emit(WS_EVENTS.APP_VERSIONS, this.cachedVersions);
    if (this.cachedSideloop)         client.emit(WS_EVENTS.SIDELOOP_STATUS, this.cachedSideloop);
  }

  handleDisconnect(client: Socket) {
    this.logger.debug(`Client disconnected: ${client.id}`);
  }

  // ── Emitters ──────────────────────────────────────────────────────────────

  emitSystemMetrics(payload: HostMetrics): void {
    this.cachedMetrics = payload;
    this.server?.emit(WS_EVENTS.SYSTEM_METRICS, payload);
  }

  emitNodeMetrics(payload: NodeMetrics[]): void {
    this.cachedNodeMetrics = payload;
    this.server?.emit(WS_EVENTS.NODE_METRICS, payload);
  }

  emitWorkloadMetrics(payload: WorkloadMetric[]): void {
    this.cachedWorkloads = payload;
    this.server?.emit(WS_EVENTS.WORKLOAD_METRICS, payload);
  }

  emitVersions(payload: VersionsReport): void {
    this.cachedVersions = payload;
    this.server?.emit(WS_EVENTS.APP_VERSIONS, payload);
  }

  emitSideloopStatus(payload: SideloopStatus): void {
    this.cachedSideloop = payload;
    this.server?.emit(WS_EVENTS.SIDELOOP_STATUS, payload);
  }

  // ── Logging ───────────────────────────────────────────────────────────────

  // timestamp optionnel : les logs relayés (kodi.log…) gardent leur heure d'origine
  addLog(level: LogLevel, source: LogSource, message: string, timestamp = Date.now()): void {
    const entry: LogEntry = {
      id:        `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp,
      level,
      source,
      message,
    };
    if (!this.store.insert(entry)) return;   // déjà connu (rejeu de backfill après restart)
    this.logBuffer.push(entry);
    if (this.logBuffer.length > LOG_BUFFER_MAX) this.logBuffer.shift();
    this.server?.emit(WS_EVENTS.LOG_ENTRY, entry);
    this.notifier.notify(level, source, message);   // push ntfy (dédupliqué, best-effort)
  }
}
