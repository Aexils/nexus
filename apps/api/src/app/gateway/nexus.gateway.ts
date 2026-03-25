import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import {
  KodiStatus, SystemMetrics, AbsStatus, PsnStatus, SideloadlyStatus,
  UrbackupStatus, JellyfinStatus, BookloreStatus,
  WS_EVENTS, LogEntry, LogLevel, LogSource, NexusUser, AppLatestVersions,
} from '@nexus/shared-types';

const LOG_BUFFER_MAX = 500;

@WebSocketGateway({ cors: { origin: '*' } })
export class NexusGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(NexusGateway.name);
  private readonly logBuffer: LogEntry[] = [];

  // ── Last-known-state cache (replayed to new clients on connect) ────────────

  private cachedKodi:       KodiStatus | null = null;
  private cachedAbs         = new Map<NexusUser, AbsStatus>();
  private cachedPsn         = new Map<NexusUser, PsnStatus>();
  private cachedSideloadly: SideloadlyStatus | null = null;
  private cachedUrbackup:   UrbackupStatus   | null = null;
  private cachedJellyfin:   JellyfinStatus   | null = null;
  private cachedBooklore    = new Map<NexusUser, BookloreStatus>();
  private cachedMetrics:    SystemMetrics    | null = null;
  private cachedVersions:   AppLatestVersions | null = null;

  @WebSocketServer()
  server: Server;

  afterInit() {
    this.logger.log('WebSocket gateway initialized');
    this.addLog('info', 'nexus', 'NEXUS démarré — WebSocket gateway prêt');
  }

  handleConnection(client: Socket) {
    this.logger.debug(`Client connected: ${client.id}`);

    // Replay log history
    if (this.logBuffer.length > 0) {
      client.emit('log:history', this.logBuffer);
    }

    // Replay last-known state — client gets current data instantly
    if (this.cachedKodi)       client.emit(WS_EVENTS.KODI_STATUS_UPDATE, this.cachedKodi);
    if (this.cachedSideloadly) client.emit(WS_EVENTS.SIDELOADLY_STATUS_UPDATE, this.cachedSideloadly);
    if (this.cachedUrbackup)   client.emit(WS_EVENTS.URBACKUP_STATUS_UPDATE, this.cachedUrbackup);
    if (this.cachedJellyfin)   client.emit(WS_EVENTS.JELLYFIN_STATUS_UPDATE, this.cachedJellyfin);
    if (this.cachedMetrics)    client.emit(WS_EVENTS.SYSTEM_METRICS, this.cachedMetrics);
    if (this.cachedVersions)   client.emit(WS_EVENTS.APP_VERSIONS, this.cachedVersions);

    this.cachedAbs.forEach((status, userId) =>
      client.emit(WS_EVENTS.ABS_STATUS_UPDATE, { userId, ...status }),
    );
    this.cachedPsn.forEach((status, userId) =>
      client.emit(WS_EVENTS.PSN_STATUS_UPDATE, { userId, ...status }),
    );
    this.cachedBooklore.forEach((status, userId) =>
      client.emit(WS_EVENTS.BOOKLORE_STATUS_UPDATE, { userId, ...status }),
    );
  }

  handleDisconnect(client: Socket) {
    this.logger.debug(`Client disconnected: ${client.id}`);
  }

  // ── Emitters ──────────────────────────────────────────────────────────────

  emitKodiStatus(payload: KodiStatus): void {
    this.cachedKodi = payload;
    if (!this.server) return;
    this.server.emit(WS_EVENTS.KODI_STATUS_UPDATE, payload);
  }

  emitAbsStatus(userId: NexusUser, payload: AbsStatus): void {
    this.cachedAbs.set(userId, payload);
    if (!this.server) return;
    this.server.emit(WS_EVENTS.ABS_STATUS_UPDATE, { userId, ...payload });
  }

  emitSystemMetrics(payload: SystemMetrics): void {
    this.cachedMetrics = payload;
    if (!this.server) return;
    this.server.emit(WS_EVENTS.SYSTEM_METRICS, payload);
  }

  emitPsnStatus(userId: NexusUser, payload: PsnStatus): void {
    this.cachedPsn.set(userId, payload);
    if (!this.server) return;
    this.server.emit(WS_EVENTS.PSN_STATUS_UPDATE, { userId, ...payload });
  }

  emitSideloadlyStatus(payload: SideloadlyStatus): void {
    this.cachedSideloadly = payload;
    if (!this.server) return;
    this.server.emit(WS_EVENTS.SIDELOADLY_STATUS_UPDATE, payload);
  }

  emitUrbackupStatus(payload: UrbackupStatus): void {
    this.cachedUrbackup = payload;
    if (!this.server) return;
    this.server.emit(WS_EVENTS.URBACKUP_STATUS_UPDATE, payload);
  }

  emitJellyfinStatus(payload: JellyfinStatus): void {
    this.cachedJellyfin = payload;
    if (!this.server) return;
    this.server.emit(WS_EVENTS.JELLYFIN_STATUS_UPDATE, payload);
  }

  emitBookloreStatus(userId: NexusUser, payload: BookloreStatus): void {
    this.cachedBooklore.set(userId, payload);
    if (!this.server) return;
    this.server.emit(WS_EVENTS.BOOKLORE_STATUS_UPDATE, { userId, ...payload });
  }

  emitVersions(payload: AppLatestVersions): void {
    this.cachedVersions = payload;
    if (!this.server) return;
    this.server.emit(WS_EVENTS.APP_VERSIONS, payload);
  }

  // ── Logging ───────────────────────────────────────────────────────────────

  addLog(level: LogLevel, source: LogSource, message: string): void {
    const entry: LogEntry = {
      id:        `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
      level,
      source,
      message,
    };
    this.logBuffer.push(entry);
    if (this.logBuffer.length > LOG_BUFFER_MAX) this.logBuffer.shift();
    if (this.server) this.server.emit(WS_EVENTS.LOG_ENTRY, entry);
  }
}
