import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { io as socketIoClient, Socket as IoSocket } from 'socket.io-client';
import { NexusGateway } from '../gateway/nexus.gateway';
import { AbsStatus, AbsSession, AbsLibraryItem, AbsLastSession, NexusUser } from '@nexus/shared-types';

const ABS_URL      = process.env['ABS_URL']      ?? 'http://localhost:13378';
const ABS_LOG_PATH = process.env['ABS_LOG_PATH'] ?? '';
const ABS_STATE_PATH = process.env['ABS_STATE_PATH'] ?? path.join(process.cwd(), 'nexus-abs-state.json');

// Per-user token config
const USER_CONFIGS: { userId: NexusUser; token: string }[] = [
  { userId: 'alexis', token: process.env['ABS_TOKEN_ALEXIS'] ?? process.env['ABS_TOKEN'] ?? '' },
  { userId: 'marion', token: process.env['ABS_TOKEN_MARION'] ?? '' },
];

function stripHtml(html: string | undefined): string | undefined {
  if (!html) return undefined;
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').trim() || undefined;
}

const ABS_LOG_LEVELS = ['info', 'info', 'warn', 'error'] as const;

interface UserAbsState {
  prevSessions:  Map<string, AbsSession>;
  prevConnected: boolean;
  lastSession:   AbsLastSession | null;
  warnEmitted:   boolean;
}

@Injectable()
export class AbsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AbsService.name);

  private readonly userStates = new Map<NexusUser, UserAbsState>();

  // Server version (shared — same for all users)
  private absServerVersion: string | undefined;
  private absVersionFetched = false;

  // Socket (shared — uses first available token for log streaming)
  private absSocket: IoSocket | null = null;
  private warnSocketErrEmitted = false;

  // Log file tailing
  private logFileOffset = 0;

  constructor(private readonly gateway: NexusGateway) {
    this.logger.log(`Audiobookshelf endpoint: ${ABS_URL}`);
    for (const cfg of USER_CONFIGS) {
      this.userStates.set(cfg.userId, {
        prevSessions:  new Map(),
        prevConnected: false,
        lastSession:   null,
        warnEmitted:   false,
      });
      if (!cfg.token) {
        this.logger.warn(`ABS_TOKEN_${cfg.userId.toUpperCase()} not set — ${cfg.userId} sessions disabled`);
        this.gateway.addLog('warn', 'abs', `${cfg.userId}: token non défini — sessions désactivées`);
      }
    }
  }

  onModuleInit() {
    this.loadState();
    const socketToken = USER_CONFIGS.find(c => c.token)?.token;
    if (socketToken) this.connectToAbsSocket(socketToken);
    if (ABS_LOG_PATH) {
      this.initLogOffset();
    } else {
      this.gateway.addLog('warn', 'abs', 'ABS_LOG_PATH non défini — tailing désactivé');
    }
  }

  onModuleDestroy() {
    this.absSocket?.disconnect();
  }

  // ── ABS socket.io (log streaming, shared) ────────────────────────────────

  private connectToAbsSocket(token: string): void {
    this.absSocket = socketIoClient(ABS_URL, {
      auth:          { token },
      query:         { token },
      reconnection:  true,
      reconnectionDelay: 5000,
      timeout:       10000,
    });

    this.absSocket.on('connect', () => {
      this.gateway.addLog('ok', 'abs', 'Socket ABS connecté');
      this.warnSocketErrEmitted = false;
    });

    // ABS emits 'init' right after connect with serverVersion
    this.absSocket.on('init', (data: { serverVersion?: string }) => {
      if (data?.serverVersion && !this.absVersionFetched) {
        this.absServerVersion = data.serverVersion;
        this.absVersionFetched = true;
      }
    });

    this.absSocket.on('disconnect', (reason: string) => {
      this.gateway.addLog('warn', 'abs', `Socket ABS déconnecté — ${reason}`);
    });

    this.absSocket.on('connect_error', (err: Error) => {
      if (!this.warnSocketErrEmitted) {
        this.warnSocketErrEmitted = true;
        this.gateway.addLog('debug', 'abs', `Erreur socket ABS: ${err.message}`);
      }
    });

    this.absSocket.on('log', (data: { level?: number; message?: string }) => {
      const lvlIdx = data.level ?? 1;
      const level  = ABS_LOG_LEVELS[Math.min(lvlIdx, 3)];
      if (lvlIdx === 0) return;
      const msg = data.message ?? '';
      if (msg) this.gateway.addLog(level, 'abs', msg);
    });
  }

  // ── Polling ───────────────────────────────────────────────────────────────

  @Interval(5000)
  async poll() {
    for (const cfg of USER_CONFIGS) {
      const status = await this.fetchStatus(cfg.token);
      const state  = this.userStates.get(cfg.userId)!;
      this.detectStateChange(cfg.userId, state, status);
      state.prevConnected = status.connected;
      this.gateway.emitAbsStatus(cfg.userId, { ...status, lastSession: state.lastSession });
    }
  }

  private async fetchStatus(token: string): Promise<AbsStatus> {
    // Connectivity check
    try {
      const res  = await fetch(`${ABS_URL}/ping`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json() as { success?: boolean };
      if (!body.success) throw new Error('Ping false');
    } catch {
      return { connected: false, activeSessions: [] };
    }

    if (!token) return { connected: true, activeSessions: [] };

    // Fetch server version (retry until obtained, via /api/me or /status)
    if (!this.absVersionFetched) {
      try {
        // Try /api/me first (includes serverVersion in ABS v2.x)
        const vRes = await fetch(`${ABS_URL}/api/me`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(3000),
        });
        if (vRes.ok) {
          const vData = await vRes.json() as { serverVersion?: string; version?: string };
          const ver = vData.serverVersion ?? vData.version;
          if (ver) {
            this.absServerVersion = ver;
            this.absVersionFetched = true;
          }
        }
      } catch { /* version stays undefined, will retry next poll */ }

      // Fallback: /status endpoint (public, no auth required)
      if (!this.absVersionFetched) {
        try {
          const sRes = await fetch(`${ABS_URL}/status`, { signal: AbortSignal.timeout(3000) });
          if (sRes.ok) {
            const sData = await sRes.json() as { version?: string; serverVersion?: string };
            const ver = sData.version ?? sData.serverVersion;
            if (ver) {
              this.absServerVersion = ver;
              this.absVersionFetched = true;
            }
          }
        } catch { /* no-op */ }
      }
    }

    try {
      const res = await fetch(`${ABS_URL}/api/sessions?page=0&itemsPerPage=100`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return { connected: true, activeSessions: [] };

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
      return { connected: true, version: this.absServerVersion, activeSessions: sessions };
    } catch {
      return { connected: true, version: this.absServerVersion, activeSessions: [] };
    }
  }

  // ── State change detection ────────────────────────────────────────────────

  private detectStateChange(userId: NexusUser, state: UserAbsState, next: AbsStatus): void {
    const label = userId.charAt(0).toUpperCase() + userId.slice(1);

    if (!state.prevConnected && next.connected) {
      this.gateway.addLog('ok', 'abs', `Audiobookshelf connecté (${label})`);
    } else if (state.prevConnected && !next.connected) {
      this.gateway.addLog('warn', 'abs', `Audiobookshelf déconnecté (${label})`);
    }

    const nextIds = new Set(next.activeSessions.map(s => s.id));
    for (const s of next.activeSessions) {
      if (!state.prevSessions.has(s.id)) {
        const type   = s.mediaType === 'podcast' ? 'Podcast' : 'Audiobook';
        const author = s.author ? ` — ${s.author}` : '';
        this.gateway.addLog('info', 'abs', `${label} — Écoute démarrée : ${s.title}${author}`);
      }
    }
    for (const [prevId, prevSession] of state.prevSessions) {
      if (!nextIds.has(prevId)) {
        state.lastSession = {
          title:         prevSession.title,
          author:        prevSession.author,
          libraryItemId: prevSession.libraryItemId,
          mediaType:     prevSession.mediaType,
          currentTime:   prevSession.currentTime,
          duration:      prevSession.duration,
          stoppedAt:     new Date().toISOString(),
        };
        this.saveState();
        this.gateway.addLog('info', 'abs', `${label} — Écoute terminée : ${prevSession.title}`);
      }
    }
    state.prevSessions = new Map(next.activeSessions.map(s => [s.id, s]));
  }

  // ── Log file tailing ─────────────────────────────────────────────────────

  private initLogOffset(): void {
    try { this.logFileOffset = fs.statSync(ABS_LOG_PATH).size; } catch { this.logFileOffset = 0; }
  }

  @Interval(3000)
  async tailAbsLog() {
    if (!ABS_LOG_PATH) return;
    try {
      const stat = fs.statSync(ABS_LOG_PATH);
      if (stat.size < this.logFileOffset) this.logFileOffset = 0;
      if (stat.size === this.logFileOffset) return;
      const stream = fs.createReadStream(ABS_LOG_PATH, { start: this.logFileOffset, encoding: 'utf8' });
      this.logFileOffset = stat.size;
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
      rl.on('line', line => this.parseAbsLogLine(line));
      await new Promise<void>(resolve => rl.on('close', resolve));
    } catch { /* silently skip */ }
  }

  private parseAbsLogLine(line: string): void {
    const m = line.match(/\[?(FATAL|ERROR|WARN|WARNING|INFO|DEBUG)\]?\s+(.+)/i);
    if (!m) return;
    const [, rawLevel, message] = m;
    const rl = rawLevel.toUpperCase();
    if (rl === 'DEBUG') return;
    const level = rl === 'WARN' || rl === 'WARNING' ? 'warn'
      : rl === 'ERROR' || rl === 'FATAL' ? 'error' : 'info';
    this.gateway.addLog(level, 'abs', message.trim());
  }

  // ── State persistence ─────────────────────────────────────────────────────

  private loadState(): void {
    try {
      const raw = JSON.parse(fs.readFileSync(ABS_STATE_PATH, 'utf8'));
      for (const userId of ['alexis', 'marion'] as NexusUser[]) {
        const state = this.userStates.get(userId)!;
        if (raw?.[userId]?.lastSession) state.lastSession = raw[userId].lastSession;
      }
    } catch { /* no saved state yet */ }
  }

  private saveState(): void {
    try {
      const data: Record<string, any> = {};
      for (const [userId, state] of this.userStates) {
        data[userId] = { lastSession: state.lastSession };
      }
      fs.writeFileSync(ABS_STATE_PATH, JSON.stringify(data));
    } catch { /* ignore write errors */ }
  }

  // ── REST: library ─────────────────────────────────────────────────────────

  async getLibrary(userId: NexusUser = 'alexis'): Promise<AbsLibraryItem[]> {
    const token = USER_CONFIGS.find(c => c.userId === userId)?.token ?? '';
    if (!token) return [];
    try {
      const libsRes = await fetch(`${ABS_URL}/api/libraries`, {
        headers: { Authorization: `Bearer ${token}` },
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
            { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) },
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
        }
      }
      return allItems;
    } catch {
      this.logger.warn('Cannot fetch ABS library');
      return [];
    }
  }

  // ── REST: cover proxy ─────────────────────────────────────────────────────

  async getCover(itemId: string, userId: NexusUser = 'alexis'): Promise<{ buffer: Buffer; contentType: string } | null> {
    const token = USER_CONFIGS.find(c => c.userId === userId)?.token ?? '';
    if (!token) return null;
    try {
      const res = await fetch(`${ABS_URL}/api/items/${itemId}/cover?raw=1`, {
        headers: { Authorization: `Bearer ${token}` },
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
