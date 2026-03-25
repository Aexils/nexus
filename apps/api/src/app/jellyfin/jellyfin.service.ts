import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { NexusGateway } from '../gateway/nexus.gateway';
import { JellyfinStatus, JellyfinSession, JellyfinNowPlaying, JellyfinLibraryItem } from '@nexus/shared-types';

const JELLYFIN_URL  = process.env['JELLYFIN_URL']  ?? 'http://localhost:8096';
const JELLYFIN_USER = process.env['JELLYFIN_USER'] ?? 'a';
const JELLYFIN_PASS = process.env['JELLYFIN_PASS'] ?? 'a';

const CLIENT_HEADER = 'MediaBrowser Client="Nexus", Device="Dashboard", DeviceId="nexus-dashboard-1", Version="1.0.0"';

@Injectable()
export class JellyfinService implements OnModuleInit {
  private readonly logger = new Logger(JellyfinService.name);

  private token:  string | null = null;
  private userId: string | null = null;
  private currentStatus: JellyfinStatus = { connected: false, activeSessions: [] };

  constructor(private readonly gateway: NexusGateway) {}

  async onModuleInit(): Promise<void> {
    this.logger.log(`Jellyfin endpoint: ${JELLYFIN_URL}`);
    await this.authenticate();
    const status = await this.fetchStatus();
    this.detectChanges(status);
    this.currentStatus = status;
    this.gateway.emitJellyfinStatus(status);
  }

  authHeader(): string {
    return this.token
      ? `${CLIENT_HEADER}, Token="${this.token}"`
      : CLIENT_HEADER;
  }

  get jellyfinUrl(): string { return JELLYFIN_URL; }

  // ── Auth ──────────────────────────────────────────────────────────────────

  private async authenticate(): Promise<boolean> {
    try {
      const res = await fetch(`${JELLYFIN_URL}/Users/AuthenticateByName`, {
        method: 'POST',
        headers: {
          'Content-Type':        'application/json',
          'X-Emby-Authorization': CLIENT_HEADER,
        },
        body: JSON.stringify({ Username: JELLYFIN_USER, Pw: JELLYFIN_PASS }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        this.logger.warn(`Jellyfin auth failed: HTTP ${res.status}`);
        return false;
      }
      const data = await res.json() as { AccessToken: string; User?: { Id?: string } };
      this.token  = data.AccessToken;
      this.userId = data.User?.Id ?? null;
      return true;
    } catch (e: any) {
      this.logger.warn(`Jellyfin auth error: ${e?.message}`);
      return false;
    }
  }

  // ── Polling ───────────────────────────────────────────────────────────────

  @Interval(5000)
  async poll(): Promise<void> {
    const next = await this.fetchStatus();
    this.detectChanges(next);
    this.currentStatus = next;
    this.gateway.emitJellyfinStatus(next);
  }

  private async fetchStatus(): Promise<JellyfinStatus> {
    // Ping (public endpoint — no auth needed)
    try {
      const res = await fetch(`${JELLYFIN_URL}/System/Ping`, {
        method: 'POST',
        headers: { 'X-Emby-Authorization': this.authHeader() },
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      return { connected: false, activeSessions: [] };
    }

    // Public system info (version, server name)
    let version: string | undefined;
    let serverName: string | undefined;
    try {
      const res = await fetch(`${JELLYFIN_URL}/System/Info/Public`, {
        headers: { 'X-Emby-Authorization': this.authHeader() },
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const info = await res.json() as { Version?: string; ServerName?: string };
        version    = info.Version;
        serverName = info.ServerName;
      }
    } catch { /* non-blocking */ }

    // Authenticate if needed
    if (!this.token) {
      const ok = await this.authenticate();
      if (!ok) return { connected: true, version, serverName, activeSessions: [] };
    }

    // Active sessions
    const sessions = await this.fetchSessions();
    return { connected: true, version, serverName, activeSessions: sessions };
  }

  private async fetchSessions(): Promise<JellyfinSession[]> {
    const doFetch = async () => {
      const res = await fetch(`${JELLYFIN_URL}/Sessions?activeWithinSeconds=30`, {
        headers: { 'X-Emby-Authorization': this.authHeader() },
        signal: AbortSignal.timeout(3000),
      });
      if (res.status === 401) return null; // need re-auth
      if (!res.ok) return [];
      return (await res.json()) as any[];
    };

    try {
      let raw = await doFetch();
      if (raw === null) {
        // Re-auth and retry
        this.token = null;
        const ok = await this.authenticate();
        if (!ok) return [];
        raw = await doFetch() ?? [];
      }
      return this.mapSessions(raw);
    } catch {
      return [];
    }
  }

  private mapSessions(raw: any[]): JellyfinSession[] {
    return raw
      .filter(s => s.NowPlayingItem) // only sessions with active playback
      .map(s => {
        const item: JellyfinNowPlaying | undefined = s.NowPlayingItem
          ? {
              name:            s.NowPlayingItem.Name ?? 'Unknown',
              type:            s.NowPlayingItem.Type ?? 'Unknown',
              seriesName:      s.NowPlayingItem.SeriesName,
              episodeTitle:    s.NowPlayingItem.EpisodeTitle ?? s.NowPlayingItem.Name,
              runTimeTicks:    s.NowPlayingItem.RunTimeTicks,
              productionYear:  s.NowPlayingItem.ProductionYear,
              itemId:          s.NowPlayingItem.Id ?? '',
            }
          : undefined;

        return {
          id:            s.Id ?? '',
          userId:        s.UserId ?? '',
          userName:      s.UserName ?? 'Unknown',
          deviceName:    s.DeviceName ?? '',
          client:        s.Client ?? '',
          nowPlaying:    item,
          positionTicks: s.PlayState?.PositionTicks,
          isPaused:      s.PlayState?.IsPaused ?? false,
        } satisfies JellyfinSession;
      });
  }

  // ── Library ───────────────────────────────────────────────────────────────

  async getLibrary(): Promise<JellyfinLibraryItem[]> {
    if (!this.token) {
      const ok = await this.authenticate();
      if (!ok) return [];
    }
    if (!this.userId) return [];

    try {
      const url = new URL(`${JELLYFIN_URL}/Users/${this.userId}/Items`);
      url.searchParams.set('IncludeItemTypes', 'Movie,Series');
      url.searchParams.set('Recursive', 'true');
      url.searchParams.set('Fields', 'Overview,Genres,OfficialRating,CommunityRating,ChildCount,PrimaryImageAspectRatio');
      url.searchParams.set('SortBy', 'SortName');
      url.searchParams.set('SortOrder', 'Ascending');
      url.searchParams.set('Limit', '1000');

      const doFetch = async () => {
        const res = await fetch(url.toString(), {
          headers: { 'X-Emby-Authorization': this.authHeader() },
          signal: AbortSignal.timeout(15_000),
        });
        if (res.status === 401) return null;
        if (!res.ok) return [];
        return (await res.json() as { Items?: any[] }).Items ?? [];
      };

      let raw = await doFetch();
      if (raw === null) {
        this.token = null;
        const ok = await this.authenticate();
        if (!ok) return [];
        raw = await doFetch() ?? [];
      }

      return raw.map((item: any) => ({
        id:               item.Id ?? '',
        name:             item.Name ?? 'Unknown',
        type:             item.Type ?? 'Movie',
        year:             item.ProductionYear ?? undefined,
        genres:           Array.isArray(item.Genres) ? item.Genres : [],
        overview:         item.Overview ?? undefined,
        officialRating:   item.OfficialRating ?? undefined,
        communityRating:  typeof item.CommunityRating === 'number' ? Math.round(item.CommunityRating * 10) / 10 : undefined,
        hasPoster:        !!item.ImageTags?.Primary,
        childCount:       item.Type === 'Series' ? (item.ChildCount ?? undefined) : undefined,
      } satisfies JellyfinLibraryItem));
    } catch (e: any) {
      this.logger.warn(`Jellyfin getLibrary error: ${e?.message}`);
      return [];
    }
  }

  // ── Change detection ──────────────────────────────────────────────────────

  private detectChanges(next: JellyfinStatus): void {
    const prev = this.currentStatus;

    if (!prev.connected && next.connected) {
      this.gateway.addLog('ok', 'jellyfin',
        `Jellyfin connecté${next.version ? ` — v${next.version}` : ''}${next.serverName ? ` (${next.serverName})` : ''}`);
    } else if (prev.connected && !next.connected) {
      this.gateway.addLog('warn', 'jellyfin', 'Jellyfin déconnecté');
    }

    const prevIds = new Set(prev.activeSessions.map(s => s.id));
    for (const s of next.activeSessions) {
      if (!prevIds.has(s.id)) {
        const np = s.nowPlaying;
        const label = np
          ? (np.seriesName ? `${np.seriesName} — ${np.episodeTitle ?? np.name}` : np.name)
          : '?';
        this.gateway.addLog('info', 'jellyfin', `${s.userName} — Lecture : ${label}`);
      }
    }

    const nextIds = new Set(next.activeSessions.map(s => s.id));
    for (const s of prev.activeSessions) {
      if (!nextIds.has(s.id)) {
        const label = s.nowPlaying?.name ?? '?';
        this.gateway.addLog('info', 'jellyfin', `${s.userName} — Lecture terminée : ${label}`);
      }
    }
  }
}
