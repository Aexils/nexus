import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { KodiStatus, SystemMetrics, AbsStatus, PsnStatus, WS_EVENTS, LogEntry, LogLevel, LogSource } from '@nexus/shared-types';

const LOG_BUFFER_MAX = 500;

@WebSocketGateway({ cors: { origin: '*' } })
export class NexusGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(NexusGateway.name);
  private readonly logBuffer: LogEntry[] = [];

  @WebSocketServer()
  server: Server;

  afterInit() {
    this.logger.log('WebSocket gateway initialized');
    this.addLog('info', 'nexus', 'NEXUS démarré — WebSocket gateway prêt');
  }

  handleConnection(client: Socket) {
    this.logger.debug(`Client connected: ${client.id}`);
    this.addLog('debug', 'nexus', `Client connecté — ${client.id}`);
    // Replay log history to the newly connected client
    if (this.logBuffer.length > 0) {
      client.emit('log:history', this.logBuffer);
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.debug(`Client disconnected: ${client.id}`);
    this.addLog('debug', 'nexus', `Client déconnecté — ${client.id}`);
  }

  // ── Emitters ──────────────────────────────────────────────────────────────

  emitKodiStatus(payload: KodiStatus): void {
    if (!this.server) return;
    this.server.emit(WS_EVENTS.KODI_STATUS_UPDATE, payload);
  }

  emitAbsStatus(payload: AbsStatus): void {
    if (!this.server) return;
    this.server.emit(WS_EVENTS.ABS_STATUS_UPDATE, payload);
  }

  emitSystemMetrics(payload: SystemMetrics): void {
    if (!this.server) return;
    this.server.emit(WS_EVENTS.SYSTEM_METRICS, payload);
  }

  emitPsnStatus(payload: PsnStatus): void {
    if (!this.server) return;
    this.server.emit(WS_EVENTS.PSN_STATUS_UPDATE, payload);
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
