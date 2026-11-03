import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { NexusGateway } from '../gateway/nexus.gateway';
import {
  TraktList,
  TraktMediaKind,
  TraktNewList,
  TraktPreview,
  TraktRowItem,
  TraktStatus,
  TraktTitle,
} from '@nexus/shared-types';
import { traktAlerts } from './trakt-alerts';

// Service ClusterIP `kube-trakt` : port HTTP interne, le certificat public ne couvrant que api.trakt.tv.
const BASE_URL = process.env.KUBE_TRAKT_URL ?? 'http://kube-trakt.kube-trakt.svc.cluster.local';
const POLL_MS = 30_000;
// Pas d'alarme pour un poll raté : le pod se recrée à chaque déploiement.
const FAIL_THRESHOLD = 2;

interface TraktItem {
  type: string;
  movie?: TraktMedia;
  show?: TraktMedia;
}

interface TraktMedia {
  title: string;
  year: number | null;
  ids: { tmdb?: number; slug: string };
}

/** Écarte ce qui n'est ni film ni série, ou n'a pas d'identifiant TMDb. */
export function toTitle(item: TraktItem): TraktTitle | null {
  if (item.type !== 'movie' && item.type !== 'show') return null;
  const media = item[item.type];
  if (!media?.ids.tmdb) return null;
  return { kind: item.type, title: media.title, year: media.year ?? null, tmdb: media.ids.tmdb, slug: media.ids.slug };
}

function idsBody(kind: TraktMediaKind, tmdb: number): Record<string, unknown> {
  return { [kind === 'movie' ? 'movies' : 'shows']: [{ ids: { tmdb } }] };
}

@Injectable()
export class TraktService implements OnModuleInit {
  private readonly logger = new Logger(TraktService.name);
  private knownAlerts = new Set<string>();
  private wasReachable = true;
  private failCount = 0;

  constructor(private readonly gateway: NexusGateway) {}

  onModuleInit(): void {
    setTimeout(() => this.poll(), 4000);
  }

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${process.env.KUBE_TRAKT_TOKEN ?? ''}` };
  }

  @Interval(POLL_MS)
  async poll(): Promise<void> {
    try {
      const res = await fetch(`${BASE_URL}/admin/status`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as Omit<TraktStatus, 'reachable' | 'generated_at' | 'alerts'>;
      const base = { ...body, reachable: true, generated_at: new Date().toISOString() };
      const status: TraktStatus = { ...base, alerts: traktAlerts(base) };
      this.failCount = 0;
      this.wasReachable = true;
      this.notifyNewAlerts(status.alerts);
      this.gateway.emitTraktStatus(status);
    } catch (e) {
      this.failCount++;
      if (this.wasReachable && this.failCount >= FAIL_THRESHOLD) {
        this.gateway.addLog('error', 'trakt', `kube-trakt injoignable (${(e as Error).message})`);
        this.wasReachable = false;
      }
      this.gateway.emitTraktStatus(this.degraded());
    }
  }

  async revokeDevice(device: string): Promise<void> {
    await this.request('DELETE', `/admin/devices/${encodeURIComponent(device)}`);
    this.gateway.addLog('warn', 'trakt', `Appareil révoqué : ${device}`);
    await this.poll();
  }

  // --- Listes ---

  lists(): Promise<TraktList[]> {
    return this.json<TraktList[]>('GET', '/admin/lists');
  }

  async createList(list: TraktNewList): Promise<TraktList> {
    const created = await this.json<TraktList>('POST', '/admin/lists', list);
    this.gateway.addLog('info', 'trakt', `Liste créée : ${list.name}`);
    return created;
  }

  async deleteList(id: number): Promise<void> {
    await this.request('DELETE', `/users/me/lists/${id}`);
    this.gateway.addLog('warn', 'trakt', `Liste supprimée : ${id}`);
  }

  async listItems(id: number): Promise<TraktTitle[]> {
    const items = await this.json<TraktItem[]>('GET', `/users/me/lists/${id}/items?limit=500`);
    return items.map(toTitle).filter((t): t is TraktTitle => t !== null);
  }

  async addListItem(id: number, kind: TraktMediaKind, tmdb: number): Promise<void> {
    await this.request('POST', `/users/me/lists/${id}/items`, idsBody(kind, tmdb));
  }

  async removeListItem(id: number, kind: TraktMediaKind, tmdb: number): Promise<void> {
    await this.request('POST', `/users/me/lists/${id}/items/remove`, idsBody(kind, tmdb));
  }

  screenLists(screen: string): Promise<{ lists: number[]; slots: number }> {
    return this.json('GET', `/admin/home?screen=${encodeURIComponent(screen)}`);
  }

  setScreenLists(screen: string, lists: number[]): Promise<{ lists: number[]; slots: number }> {
    return this.json('PUT', `/admin/home?screen=${encodeURIComponent(screen)}`, { lists });
  }

  async row(name: string): Promise<TraktRowItem[]> {
    if (!/^[a-z0-9_]+$/.test(name)) throw new NotFoundException(`Rangée inconnue : ${name}`);
    const row = await this.json<{ items: TraktRowItem[] }>('GET', `/rows/${name}`);
    return row.items;
  }

  previewSource(provider: number, theme: string, kinds: string): Promise<TraktPreview[]> {
    const query = new URLSearchParams({ provider: String(provider), theme, kinds });
    return this.json('GET', `/admin/sources/preview?${query}`);
  }

  searchTitles(query: string): Promise<TraktPreview[]> {
    return this.json('GET', `/admin/search?q=${encodeURIComponent(query)}`);
  }

  async addTitle(id: number, title: { kind: TraktMediaKind; tmdb: number; title: string; year: number | null }): Promise<void> {
    const entry = { title: title.title, year: title.year, ids: { tmdb: title.tmdb } };
    await this.request('POST', `/users/me/lists/${id}/items`, {
      [title.kind === 'movie' ? 'movies' : 'shows']: [entry],
    });
  }

  // --- Séries ---

  async search(query: string): Promise<TraktTitle[]> {
    const items = await this.json<TraktItem[]>(
      'GET',
      `/search/movie,show?query=${encodeURIComponent(query)}&limit=20`,
    );
    return items.map(toTitle).filter((t): t is TraktTitle => t !== null);
  }

  async setLoop(slug: string, loop: boolean): Promise<void> {
    await this.request('PUT', `/admin/shows/${encodeURIComponent(slug)}/mode`, { mode: loop ? 'loop' : null });
    await this.poll();
  }

  async hiddenShows(): Promise<TraktTitle[]> {
    const items = await this.json<TraktItem[]>('GET', '/users/hidden/progress_watched?type=show&limit=500');
    return items.map(toTitle).filter((t): t is TraktTitle => t !== null);
  }

  async setHidden(tmdb: number, hidden: boolean): Promise<void> {
    const path = `/users/hidden/progress_watched${hidden ? '' : '/remove'}`;
    await this.request('POST', path, idsBody('show', tmdb));
  }

  private async json<T>(method: string, path: string, body?: unknown): Promise<T> {
    return (await (await this.request(method, path, body)).json()) as T;
  }

  private async request(method: string, path: string, body?: unknown): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${BASE_URL}${path}`, {
        method,
        headers: { ...this.headers(), 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      this.logger.warn(`${method} ${path} : ${(e as Error).message}`);
      throw new ServiceUnavailableException('kube-trakt injoignable');
    }
    if (res.status === 404) throw new NotFoundException(`Introuvable : ${path}`);
    if (res.status === 400) throw new BadRequestException(`Refusé par kube-trakt : ${path}`);
    if (!res.ok) throw new ServiceUnavailableException(`kube-trakt a répondu ${res.status}`);
    return res;
  }

  private notifyNewAlerts(alerts: string[]): void {
    for (const alert of alerts) {
      if (!this.knownAlerts.has(alert)) this.gateway.addLog('warn', 'trakt', alert);
    }
    this.knownAlerts = new Set(alerts);
  }

  private degraded(): TraktStatus {
    return {
      reachable: false,
      generated_at: new Date().toISOString(),
      counts: null,
      last_watched_at: null,
      last_backup: null,
      catalog: null,
      jellyfin: null,
      loop_shows: [],
      now_playing: null,
      devices: [],
      missing_routes: [],
      alerts: [],
    };
  }
}
