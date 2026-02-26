import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import * as fs from 'fs';
import * as readline from 'readline';
import { io as socketIoClient, Socket as IoSocket } from 'socket.io-client';
import { NexusGateway } from '../gateway/nexus.gateway';
import { AbsStatus, AbsSession, AbsLibraryItem } from '@nexus/shared-types';

const ABS_URL      = process.env['ABS_URL']      ?? 'http://localhost:13378';
const ABS_TOKEN    = process.env['ABS_TOKEN']     ?? '';
const ABS_LOG_PATH = process.env['ABS_LOG_PATH']  ?? '';

function stripHtml(html: string | undefined): string | undefined {
  if (!html) return undefined;
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').trim() || undefined;
}

// ABS socket log levels: 0=debug, 1=info, 2=warn, 3=error
const ABS_LOG_LEVELS = ['info', 'info', 'warn', 'error'] as const;

@Injectable()
export class AbsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AbsService.name);

  // ── Session state tracking ───────────────────────────────────────────────
  private prevSessionIds = new Set<string>();
  private prevConnected  = false;

  // ── One-shot warn guards (avoid flooding journal on repeated poll errors) ──
  private warnSessionsEmitted = false;
  private warnSocketErrEmitted = false;

  // ── ABS socket client ────────────────────────────────────────────────────
  private absSocket: IoSocket | null = null;

  // ── Log file tailing ─────────────────────────────────────────────────────
  private logFileOffset = 0;

  constructor(private readonly gateway: NexusGateway) {
    this.logger.log(`Audiobookshelf endpoint: ${ABS_URL}`);
    this.gateway.addLog('debug', 'abs', `Endpoint: ${ABS_URL}`);
    if (!ABS_TOKEN) {
      this.logger.warn('ABS_TOKEN not set — sessions and library will not be fetched');
      this.gateway.addLog('warn', 'abs', 'ABS_TOKEN non défini — sessions et bibliothèque désactivées');
    }
  }

  onModuleInit() {
    if (ABS_TOKEN) this.connectToAbsSocket();
    if (ABS_LOG_PATH) {
      this.logger.log(`ABS log file: ${ABS_LOG_PATH}`);
      this.gateway.addLog('debug', 'abs', `Fichier log: ${ABS_LOG_PATH}`);
      this.initLogOffset();
    } else {
      this.logger.warn('ABS_LOG_PATH not set — log file tailing disabled');
      this.gateway.addLog('warn', 'abs', 'ABS_LOG_PATH non défini — tailing désactivé');
    }
  }

  onModuleDestroy() {
    this.absSocket?.disconnect();
  }

  // ── ABS socket.io client ─────────────────────────────────────────────────

  private connectToAbsSocket(): void {
    this.absSocket = socketIoClient(ABS_URL, {
      auth:          { token: ABS_TOKEN },
      query:         { token: ABS_TOKEN },
      reconnection:  true,
      reconnectionDelay: 5000,
      timeout:       10000,
    });

    this.absSocket.on('connect', () => {
      this.logger.log('Connected to ABS socket.io');
      this.gateway.addLog('ok', 'abs', 'Socket ABS connecté');
      this.warnSocketErrEmitted = false;
    });

    this.absSocket.on('disconnect', (reason: string) => {
      this.logger.warn(`ABS socket disconnected: ${reason}`);
      this.gateway.addLog('warn', 'abs', `Socket ABS déconnecté — ${reason}`);
    });

    this.absSocket.on('connect_error', (err: Error) => {
      this.logger.debug(`ABS socket error: ${err.message}`);
      if (!this.warnSocketErrEmitted) {
        this.warnSocketErrEmitted = true;
        this.gateway.addLog('debug', 'abs', `Erreur socket ABS: ${err.message}`);
      }
    });

    // ABS server log stream (emitted by LogManager to admin clients)
    this.absSocket.on('log', (data: { level?: number; message?: string; timestamp?: string }) => {
      const lvlIdx = data.level ?? 1;
      const level  = ABS_LOG_LEVELS[Math.min(lvlIdx, 3)];
      if (level === 'info' && lvlIdx === 0) return; // skip debug
      const msg = data.message ?? '';
      if (msg) this.gateway.addLog(level, 'abs', msg);
    });

    // Real-time session progress
    this.absSocket.on('user_stream_progress', (data: { displayTitle?: string; progress?: number }) => {
      if (data.displayTitle && data.progress != null) {
        const pct = (data.progress * 100).toFixed(1);
        this.gateway.addLog('info', 'abs', `Progression — ${data.displayTitle} : ${pct}%`);
      }
    });
  }

  // ── WebSocket polling ────────────────────────────────────────────────────

  @Interval(5000)
  async poll() {
    const status = await this.fetchStatus();
    this.detectStateChange(status);
    this.gateway.emitAbsStatus(status);
  }

  private async fetchStatus(): Promise<AbsStatus> {
    try {
      const res  = await fetch(`${ABS_URL}/ping`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json() as { success?: boolean };
      if (!body.success) throw new Error('Ping false');
    } catch {
      return { connected: false, activeSessions: [] };
    }

    if (!ABS_TOKEN) return { connected: true, activeSessions: [] };

    try {
      const res = await fetch(`${ABS_URL}/api/sessions?page=0&itemsPerPage=100`, {
        headers: { Authorization: `Bearer ${ABS_TOKEN}` },
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) {
        this.logger.warn(`ABS sessions HTTP ${res.status}`);
        if (!this.warnSessionsEmitted) {
          this.warnSessionsEmitted = true;
          this.gateway.addLog('warn', 'abs', `Sessions HTTP ${res.status}`);
        }
        return { connected: true, activeSessions: [] };
      }
      const data = await res.json() as { sessions?: any[] };
      const allSessions: any[] = data.sessions ?? [];

      let activeCandidates = allSessions.filter((s: any) => s.isActiveSession === true);
      if (activeCandidates.length === 0) {
        const tenMinAgo = Date.now() - 10 * 60 * 1000;
        activeCandidates = allSessions.filter((s: any) => {
          const updated = s.updatedAt ?? s.lastUpdate ?? 0;
          return updated > tenMinAgo;
        });
      }

      const sessions: AbsSession[] = activeCandidates.map((s: any) => ({
        id:            s.id,
        userId:        s.userId,
        libraryItemId: s.libraryItemId,
        mediaType:     s.mediaType === 'podcast' ? 'podcast' : 'book',
        title:         s.displayTitle  ?? s.mediaMetadata?.title     ?? 'Unknown',
        author:        s.displayAuthor ?? s.mediaMetadata?.authorName,
        currentTime:   s.currentTime   ?? 0,
        duration:      s.duration      ?? 0,
      }));
      this.warnSessionsEmitted = false;
      return { connected: true, activeSessions: sessions };
    } catch {
      this.logger.warn('Cannot fetch ABS sessions');
      if (!this.warnSessionsEmitted) {
        this.warnSessionsEmitted = true;
        this.gateway.addLog('warn', 'abs', 'Impossible de récupérer les sessions ABS');
      }
      return { connected: true, activeSessions: [] };
    }
  }

  // ── Synthetic state-change events ────────────────────────────────────────

  private detectStateChange(next: AbsStatus): void {
    if (!this.prevConnected && next.connected) {
      this.gateway.addLog('ok', 'abs', 'Audiobookshelf connecté');
    } else if (this.prevConnected && !next.connected) {
      this.gateway.addLog('warn', 'abs', 'Audiobookshelf déconnecté — hors ligne');
    }
    this.prevConnected = next.connected;

    const nextIds = new Set(next.activeSessions.map(s => s.id));

    for (const s of next.activeSessions) {
      if (!this.prevSessionIds.has(s.id)) {
        const type = s.mediaType === 'podcast' ? 'Podcast' : 'Audiobook';
        const author = s.author ? ` — ${s.author}` : '';
        this.gateway.addLog('info', 'abs', `Écoute démarrée — ${type} : ${s.title}${author}`);
      }
    }
    for (const prevId of this.prevSessionIds) {
      if (!nextIds.has(prevId)) {
        this.gateway.addLog('info', 'abs', `Session terminée — ID ${prevId}`);
      }
    }
    this.prevSessionIds = nextIds;
  }

  // ── Log file tailing ─────────────────────────────────────────────────────

  private initLogOffset(): void {
    try {
      this.logFileOffset = fs.statSync(ABS_LOG_PATH).size;
    } catch {
      this.logFileOffset = 0;
    }
  }

  @Interval(3000)
  async tailAbsLog() {
    if (!ABS_LOG_PATH) return;
    try {
      const stat = fs.statSync(ABS_LOG_PATH);
      if (stat.size < this.logFileOffset) this.logFileOffset = 0;
      if (stat.size === this.logFileOffset) return;

      const stream = fs.createReadStream(ABS_LOG_PATH, {
        start: this.logFileOffset,
        encoding: 'utf8',
      });
      this.logFileOffset = stat.size;

      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
      rl.on('line', line => this.parseAbsLogLine(line));
      await new Promise<void>(resolve => rl.on('close', resolve));
    } catch {
      // File not yet created or unreadable — silently skip
    }
  }

  private parseAbsLogLine(line: string): void {
    // ABS log format: [YYYY-MM-DDTHH:mm:ss.mssZ] [LEVEL] message
    // or:             YYYY-MM-DD HH:mm:ss.mmm [LEVEL] message
    const m = line.match(/\[?(FATAL|ERROR|WARN|WARNING|INFO|DEBUG)\]?\s+(.+)/i);
    if (!m) return;
    const [, rawLevel, message] = m;
    const rl = rawLevel.toUpperCase();
    if (rl === 'DEBUG') return;
    const level = rl === 'WARN' || rl === 'WARNING' ? 'warn'
      : rl === 'ERROR' || rl === 'FATAL' ? 'error'
      : 'info';
    this.gateway.addLog(level, 'abs', message.trim());
  }

  // ── REST: library ─────────────────────────────────────────────────────────

  async getLibrary(): Promise<AbsLibraryItem[]> {
    if (!ABS_TOKEN) return [];
    try {
      const libsRes = await fetch(`${ABS_URL}/api/libraries`, {
        headers: { Authorization: `Bearer ${ABS_TOKEN}` },
        signal: AbortSignal.timeout(5000),
      });
      if (!libsRes.ok) return [];

      const libsData = await libsRes.json() as { libraries?: any[] };
      const bookLibs = (libsData.libraries ?? []).filter((l: any) => l.mediaType === 'book');
      const allItems: AbsLibraryItem[] = [];

      for (const lib of bookLibs) {
        try {
          const itemsRes = await fetch(
            `${ABS_URL}/api/libraries/${lib.id}/items?limit=500&page=0&include=progress`,
            { headers: { Authorization: `Bearer ${ABS_TOKEN}` }, signal: AbortSignal.timeout(10000) },
          );
          if (!itemsRes.ok) continue;
          const itemsData = await itemsRes.json() as { results?: any[] };

          for (const item of (itemsData.results ?? [])) {
            const meta = item.media?.metadata ?? {};
            const seriesArr   = Array.isArray(meta.series) ? meta.series : [];
            const firstSeries = seriesArr[0];
            let seriesName: string | undefined;
            let seriesSeq:  string | undefined;

            if (firstSeries) {
              seriesName = firstSeries.name;
              seriesSeq  = firstSeries.sequence ?? undefined;
            } else if (meta.seriesName) {
              const m2 = String(meta.seriesName).match(/^(.+?)\s*[#\-]\s*(\d+(?:\.\d+)?)$/);
              seriesName = m2 ? m2[1].trim() : String(meta.seriesName);
              seriesSeq  = m2 ? m2[2] : undefined;
            }

            const prog = item.userMediaProgress;
            allItems.push({
              id:             item.id,
              libraryId:      lib.id,
              title:          meta.title        ?? 'Unknown',
              subtitle:       meta.subtitle     || undefined,
              author:         meta.authorName   || undefined,
              narrator:       meta.narratorName || undefined,
              series:         seriesName,
              seriesSequence: seriesSeq,
              description:    stripHtml(meta.description || undefined),
              publishedYear:  meta.publishedYear || undefined,
              genres:         Array.isArray(meta.genres) ? meta.genres : [],
              duration:       item.media?.duration ?? meta.duration ?? 0,
              mediaType:      'book',
              hasCover:       !!item.media?.coverPath,
              progress: prog ? {
                currentTime: prog.currentTime ?? 0,
                progress:    prog.progress    ?? 0,
                isFinished:  prog.isFinished  ?? false,
                lastUpdate:  prog.lastUpdate,
              } : undefined,
            });
          }
        } catch {
          this.logger.warn(`Cannot fetch items for library ${lib.id}`);
          this.gateway.addLog('warn', 'abs', `Impossible de récupérer la bibliothèque ${lib.id}`);
        }
      }
      return allItems;
    } catch {
      this.logger.warn('Cannot fetch ABS library');
      this.gateway.addLog('warn', 'abs', 'Impossible de récupérer les bibliothèques ABS');
      return [];
    }
  }

  // ── REST: cover proxy ─────────────────────────────────────────────────────

  async getCover(itemId: string): Promise<{ buffer: Buffer; contentType: string } | null> {
    if (!ABS_TOKEN) return null;
    try {
      const res = await fetch(`${ABS_URL}/api/items/${itemId}/cover?raw=1`, {
        headers: { Authorization: `Bearer ${ABS_TOKEN}` },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return null;
      const contentType = res.headers.get('content-type') ?? 'image/jpeg';
      const buffer = Buffer.from(await res.arrayBuffer());
      return { buffer, contentType };
    } catch {
      return null;
    }
  }
}
