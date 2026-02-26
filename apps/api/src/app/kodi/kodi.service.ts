import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import axios, { AxiosInstance } from 'axios';
import { NexusGateway } from '../gateway/nexus.gateway';
import { KodiStatus, KodiNowPlaying } from '@nexus/shared-types';

const KODI_URL        = process.env['KODI_URL']        ?? 'http://localhost:8080/jsonrpc';
const KODI_USER       = process.env['KODI_USER']       ?? '';
const KODI_PASS       = process.env['KODI_PASS']       ?? '';
const KODI_LOG_PATH   = process.env['KODI_LOG_PATH']   ?? '';
const KODI_STATE_PATH = process.env['KODI_STATE_PATH'] ?? path.join(process.cwd(), 'nexus-kodi-state.json');

// Map Kodi log level strings to our levels
const KODI_LEVEL_MAP: Record<string, 'info' | 'warn' | 'error'> = {
  INFO:    'info',
  WARNING: 'warn',
  ERROR:   'error',
  FATAL:   'error',
};

@Injectable()
export class KodiService implements OnModuleInit {
  private readonly logger = new Logger(KodiService.name);
  private readonly http: AxiosInstance;

  private currentStatus: KodiStatus = { connected: false, nowPlaying: null };
  private lastPlayed: KodiStatus['lastPlayed'] = null;

  // ── State tracking for synthetic log events ──────────────────────────────
  private prevConnected     = false;
  private prevTitle:  string | null = null;
  private prevPaused: boolean | null = null;

  // ── Log file tailing ─────────────────────────────────────────────────────
  private logFileOffset = 0;

  constructor(private readonly gateway: NexusGateway) {
    this.http = axios.create({
      timeout: 1500,
      auth: KODI_USER ? { username: KODI_USER, password: KODI_PASS } : undefined,
    });
  }

  onModuleInit() {
    this.loadState();
    this.logger.log(`Kodi endpoint: ${KODI_URL}`);
    this.gateway.addLog('debug', 'kodi', `Endpoint: ${KODI_URL}`);
    if (KODI_LOG_PATH) {
      this.logger.log(`Kodi log file: ${KODI_LOG_PATH}`);
      this.gateway.addLog('debug', 'kodi', `Fichier log: ${KODI_LOG_PATH}`);
      this.initLogOffset();
    } else {
      this.logger.warn('KODI_LOG_PATH not set — log file tailing disabled');
      this.gateway.addLog('warn', 'kodi', 'KODI_LOG_PATH non défini — tailing désactivé');
    }
  }

  // ── JSON-RPC helper ──────────────────────────────────────────────────────

  private async rpc<T = unknown>(method: string, params?: unknown): Promise<T> {
    const body = { jsonrpc: '2.0', method, params, id: 1 };
    const res = await this.http.post<{ result: T }>(KODI_URL, body);
    return res.data.result;
  }

  private async rpcBatch(
    requests: { method: string; params?: unknown; id: number }[],
  ): Promise<{ id: number; result?: unknown; error?: unknown }[]> {
    const body = requests.map(r => ({
      jsonrpc: '2.0', method: r.method, params: r.params, id: r.id,
    }));
    const res = await this.http.post<{ id: number; result?: unknown; error?: unknown }[]>(KODI_URL, body);
    return res.data;
  }

  // ── Polling ──────────────────────────────────────────────────────────────

  @Interval(2000)
  async pollKodi() {
    try {
      const players = await this.rpc<{ playerid: number; type: string }[]>('Player.GetActivePlayers');

      if (!players || players.length === 0) {
        const appProps = await this.rpc<{ version: { major: number; minor: number } }>(
          'Application.GetProperties', { properties: ['version'] },
        );
        const version = appProps?.version
          ? `${appProps.version.major}.${appProps.version.minor}`
          : undefined;

        const next: KodiStatus = { connected: true, version, nowPlaying: null };
        this.detectStateChange(next);
        this.currentStatus = { ...next, lastPlayed: this.lastPlayed };
        this.gateway.emitKodiStatus(this.currentStatus);
        return;
      }

      const playerId = players[0].playerid;
      const batch = await this.rpcBatch([
        {
          id: 1, method: 'Player.GetItem',
          params: {
            playerid: playerId,
            properties: [
              'title', 'year', 'thumbnail', 'art',
              'showtitle', 'season', 'episode',
              'plot', 'plotoutline', 'tagline',
              'rating', 'genre', 'director', 'cast', 'studio',
              'artist', 'album', 'duration',
            ],
          },
        },
        { id: 2, method: 'Player.GetProperties', params: { playerid: playerId, properties: ['percentage', 'time', 'totaltime', 'speed'] } },
        { id: 3, method: 'Application.GetProperties', params: { properties: ['volume', 'version'] } },
      ]);

      const byId = Object.fromEntries(batch.map(r => [r.id, r.result]));
      const item  = byId[1] as { item: {
        title: string; year?: number; thumbnail?: string;
        art?: { poster?: string; fanart?: string; thumb?: string };
        showtitle?: string; season?: number; episode?: number; type: string;
        plot?: string; plotoutline?: string; tagline?: string;
        rating?: number; genre?: string[]; director?: string[];
        cast?: { name: string; role?: string }[];
        studio?: string[];
        artist?: string[]; album?: string;
      }};
      const props = byId[2] as { percentage: number; time: { hours: number; minutes: number; seconds: number }; totaltime: { hours: number; minutes: number; seconds: number }; speed: number };
      const app   = byId[3] as { volume: number; version: { major: number; minor: number } };

      const toSec = (t: { hours: number; minutes: number; seconds: number }) =>
        t.hours * 3600 + t.minutes * 60 + t.seconds;

      const mediaType = item?.item?.type ?? 'movie';
      const it = item?.item;
      const nowPlaying: KodiNowPlaying = {
        type: (mediaType === 'episode' ? 'episode' : mediaType === 'song' ? 'music' : 'movie') as KodiNowPlaying['type'],
        title: it?.showtitle
          ? `${it.showtitle} S${it.season}E${it.episode} — ${it.title}`
          : it?.title ?? 'Unknown',
        year:        it?.year || undefined,
        thumbnail:   it?.thumbnail || undefined,
        art:         it?.art ? {
          poster:  it.art.poster  || undefined,
          fanart:  it.art.fanart  || undefined,
          thumb:   it.art.thumb   || undefined,
        } : undefined,
        plot:        it?.plot      || it?.plotoutline || undefined,
        tagline:     it?.tagline   || undefined,
        rating:      it?.rating    || undefined,
        genres:      it?.genre?.length     ? it.genre     : undefined,
        directors:   it?.director?.length  ? it.director  : undefined,
        cast:        it?.cast?.length
          ? it.cast.slice(0, 5).map(c => c.role ? `${c.name} (${c.role})` : c.name)
          : undefined,
        studio:      it?.studio?.length    ? it.studio    : undefined,
        artist:      it?.artist?.[0]       || undefined,
        album:       it?.album             || undefined,
        durationSec: props?.totaltime ? toSec(props.totaltime) : 0,
        positionSec: props?.time      ? toSec(props.time)      : 0,
        paused:      props?.speed === 0,
        volume:      app?.volume ?? 100,
      };

      const next: KodiStatus = {
        connected: true,
        version: app?.version ? `${app.version.major}.${app.version.minor}` : undefined,
        nowPlaying,
      };
      this.detectStateChange(next);
      this.currentStatus = { ...next, lastPlayed: this.lastPlayed };
      this.gateway.emitKodiStatus(this.currentStatus);
    } catch {
      if (this.currentStatus.connected) {
        this.logger.debug('Kodi unreachable — marking as disconnected');
        this.gateway.addLog('debug', 'kodi', 'Kodi injoignable — marqué hors ligne');
      }
      const next: KodiStatus = { connected: false, nowPlaying: null };
      this.detectStateChange(next);
      this.currentStatus = { ...next, lastPlayed: this.lastPlayed };
      this.gateway.emitKodiStatus(this.currentStatus);
    }
  }

  // ── Synthetic state-change events ────────────────────────────────────────

  private detectStateChange(next: KodiStatus): void {
    const prev = this.currentStatus;

    if (!prev.connected && next.connected) {
      this.gateway.addLog('ok', 'kodi', `Kodi connecté${next.version ? ` — v${next.version}` : ''}`);
    } else if (prev.connected && !next.connected) {
      this.gateway.addLog('warn', 'kodi', 'Kodi déconnecté — hors ligne');
    }

    const prevNp = prev.nowPlaying;
    const nextNp = next.nowPlaying;

    if (!prevNp && nextNp) {
      const type = nextNp.type === 'episode' ? 'Série' : nextNp.type === 'music' ? 'Musique' : 'Film';
      this.gateway.addLog('info', 'kodi', `Lecture démarrée — ${type} : ${nextNp.title}`);
    } else if (prevNp && !nextNp) {
      this.lastPlayed = { item: prevNp, stoppedAt: new Date().toISOString() };
      this.saveState();
      this.gateway.addLog('info', 'kodi', `Lecture arrêtée — ${prevNp.title}`);
    } else if (prevNp && nextNp) {
      if (prevNp.title !== nextNp.title) {
        const type = nextNp.type === 'episode' ? 'Série' : nextNp.type === 'music' ? 'Musique' : 'Film';
        this.gateway.addLog('info', 'kodi', `Nouveau média — ${type} : ${nextNp.title}`);
      } else if (!prevNp.paused && nextNp.paused) {
        this.gateway.addLog('info', 'kodi', `Pause — ${nextNp.title}`);
      } else if (prevNp.paused && !nextNp.paused) {
        this.gateway.addLog('info', 'kodi', `Reprise — ${nextNp.title}`);
      }
    }
  }

  // ── Log file tailing ─────────────────────────────────────────────────────

  private initLogOffset(): void {
    try {
      const stat = fs.statSync(KODI_LOG_PATH);
      // Start from the end so we only tail new entries
      this.logFileOffset = stat.size;
    } catch {
      this.logFileOffset = 0;
    }
  }

  @Interval(3000)
  async tailKodiLog() {
    if (!KODI_LOG_PATH) return;
    try {
      const stat = fs.statSync(KODI_LOG_PATH);
      if (stat.size < this.logFileOffset) this.logFileOffset = 0; // log rotated
      if (stat.size === this.logFileOffset) return;                // no new data

      const stream = fs.createReadStream(KODI_LOG_PATH, {
        start: this.logFileOffset,
        encoding: 'utf8',
      });
      this.logFileOffset = stat.size;

      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
      rl.on('line', line => this.parseKodiLogLine(line));
      await new Promise<void>(resolve => rl.on('close', resolve));
    } catch {
      // File not yet created or unreadable — silently skip
    }
  }

  private parseKodiLogLine(line: string): void {
    // Format: 2024-01-15 14:30:45.123 T:1234  WARNING <module>: message
    const m = line.match(
      /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} T:\S+\s+(DEBUG|INFO|WARNING|ERROR|FATAL)\s+(?:<([^>]+)>:\s*)?(.+)/,
    );
    if (!m) return;
    const [, rawLevel, module, message] = m;
    if (rawLevel === 'DEBUG') return; // too noisy
    const level = KODI_LEVEL_MAP[rawLevel] ?? 'info';
    const prefix = module ? `[${module}] ` : '';
    this.gateway.addLog(level, 'kodi', `${prefix}${message.trim()}`);
  }

  // ── Artwork proxy ─────────────────────────────────────────────────────────

  async getArt(thumbnailUrl: string): Promise<{ buffer: Buffer; contentType: string } | null> {
    if (!thumbnailUrl) return null;
    try {
      let fetchUrl: string;

      if (thumbnailUrl.startsWith('image://')) {
        // Decode inner URL: image://http%3a%2f%2f... → http://...
        const inner = decodeURIComponent(thumbnailUrl.slice(8).replace(/\/$/, ''));
        if (inner.startsWith('http://') || inner.startsWith('https://')) {
          fetchUrl = inner; // Direct internet URL (TMDB, TVDB, …)
        } else {
          // Local/SMB/NFS art — proxy through Kodi's HTTP image server
          const kodiBase = KODI_URL.replace(/\/jsonrpc.*$/, '');
          fetchUrl = `${kodiBase}/image/${encodeURIComponent(thumbnailUrl)}`;
        }
      } else if (thumbnailUrl.startsWith('http')) {
        fetchUrl = thumbnailUrl;
      } else {
        // Raw file path — let Kodi serve it
        const kodiBase = KODI_URL.replace(/\/jsonrpc.*$/, '');
        fetchUrl = `${kodiBase}/image/${encodeURIComponent(thumbnailUrl)}`;
      }

      const headers: Record<string, string> = {};
      if (KODI_USER) {
        headers['Authorization'] =
          `Basic ${Buffer.from(`${KODI_USER}:${KODI_PASS}`).toString('base64')}`;
      }

      const res = await fetch(fetchUrl, { headers, signal: AbortSignal.timeout(5000) });
      if (!res.ok) return null;
      const contentType = res.headers.get('content-type') ?? 'image/jpeg';
      const buffer = Buffer.from(await res.arrayBuffer());
      return { buffer, contentType };
    } catch {
      return null;
    }
  }

  // ── State persistence ─────────────────────────────────────────────────────

  private loadState(): void {
    try {
      const raw = JSON.parse(fs.readFileSync(KODI_STATE_PATH, 'utf8'));
      if (raw?.lastPlayed) this.lastPlayed = raw.lastPlayed;
    } catch { /* no saved state yet */ }
  }

  private saveState(): void {
    try {
      fs.writeFileSync(KODI_STATE_PATH, JSON.stringify({ lastPlayed: this.lastPlayed }));
    } catch { /* ignore write errors */ }
  }

  // ── Playback commands ─────────────────────────────────────────────────────

  getStatus(): KodiStatus { return this.currentStatus; }

  async getActivePlayerId(): Promise<number | null> {
    try {
      const players = await this.rpc<{ playerid: number }[]>('Player.GetActivePlayers');
      return players?.[0]?.playerid ?? null;
    } catch { return null; }
  }

  async togglePlayPause(): Promise<void> {
    const pid = await this.getActivePlayerId();
    if (pid == null) return;
    await this.rpc('Player.PlayPause', { playerid: pid });
    this.gateway.addLog('info', 'kodi', 'Commande : Play/Pause');
  }

  async stop(): Promise<void> {
    const pid = await this.getActivePlayerId();
    if (pid == null) return;
    await this.rpc('Player.Stop', { playerid: pid });
    this.gateway.addLog('info', 'kodi', 'Commande : Stop');
  }

  async seek(positionSec: number): Promise<void> {
    const pid = await this.getActivePlayerId();
    if (pid == null) return;
    await this.rpc('Player.Seek', { playerid: pid, value: { seconds: Math.round(positionSec) } });
    const h = Math.floor(positionSec / 3600);
    const m = Math.floor((positionSec % 3600) / 60).toString().padStart(2, '0');
    const s = Math.floor(positionSec % 60).toString().padStart(2, '0');
    this.gateway.addLog('info', 'kodi', `Commande : Seek → ${h > 0 ? `${h}:` : ''}${m}:${s}`);
  }

  async setVolume(level: number): Promise<void> {
    await this.rpc('Application.SetVolume', { volume: Math.max(0, Math.min(100, Math.round(level))) });
    this.gateway.addLog('info', 'kodi', `Commande : Volume → ${level}%`);
  }
}
