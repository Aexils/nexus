import { Injectable, Logger, NotFoundException, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { NexusGateway } from '../gateway/nexus.gateway';
import { TraktStatus } from '@nexus/shared-types';
import { traktAlerts } from './trakt-alerts';

// Service ClusterIP `kube-trakt` : port HTTP interne, le certificat public ne couvrant que api.trakt.tv.
const BASE_URL = process.env.KUBE_TRAKT_URL ?? 'http://kube-trakt.kube-trakt.svc.cluster.local';
const POLL_MS = 30_000;
// Pas d'alarme pour un poll raté : le pod se recrée à chaque déploiement.
const FAIL_THRESHOLD = 2;

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
    let res: Response;
    try {
      res = await fetch(`${BASE_URL}/admin/devices/${encodeURIComponent(device)}`, {
        method: 'DELETE',
        headers: this.headers(),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (e) {
      this.logger.warn(`Révocation impossible : ${(e as Error).message}`);
      throw new ServiceUnavailableException('kube-trakt injoignable');
    }
    if (res.status === 404) throw new NotFoundException(`Appareil inconnu : ${device}`);
    if (!res.ok) throw new ServiceUnavailableException(`kube-trakt a répondu ${res.status}`);
    this.gateway.addLog('warn', 'trakt', `Appareil révoqué : ${device}`);
    await this.poll();
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
      now_playing: null,
      devices: [],
      missing_routes: [],
      alerts: [],
    };
  }
}
