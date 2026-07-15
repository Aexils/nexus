import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { NexusGateway } from '../gateway/nexus.gateway';
import { SideloopStatus } from '@nexus/shared-types';

// URL de l'API sideloop (Service ClusterIP `sideloop` dans le ns sideloop).
// ⚠ Le Service expose le port 80 (→ targetPort 8000). Surchargeable par env.
const SIDELOOP_URL =
  process.env.SIDELOOP_STATUS_URL ??
  'http://sideloop.sideloop.svc.cluster.local/api/status';

const POLL_MS = 30_000;
// N'alarme qu'après ce nombre d'échecs consécutifs (évite les faux positifs lors
// des redéploiements du pod sideloop : ~1 poll raté = normal).
const FAIL_THRESHOLD = 2;

@Injectable()
export class SideloopService implements OnModuleInit {
  private readonly logger = new Logger(SideloopService.name);
  // Alertes déjà notifiées (dédup : on ne re-log que les NOUVELLES transitions).
  private knownAlerts = new Set<string>();
  private wasReachable = true;
  private failCount = 0;

  constructor(private readonly gateway: NexusGateway) {}

  onModuleInit(): void {
    // léger délai pour laisser les autres services démarrer
    setTimeout(() => this.poll(), 4000);
  }

  @Interval(POLL_MS)
  async poll(): Promise<void> {
    let status: SideloopStatus;
    try {
      const res = await fetch(SIDELOOP_URL, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      status = (await res.json()) as SideloopStatus;
      status.reachable = true;
    } catch (e) {
      // On n'alarme qu'après FAIL_THRESHOLD échecs consécutifs (anti-blip de déploiement).
      this.failCount++;
      if (this.wasReachable && this.failCount >= FAIL_THRESHOLD) {
        this.gateway.addLog('error', 'sideloop',
          `sideloop injoignable (${(e as Error).message}) — dashboard sans données fraîches`);
        this.wasReachable = false;
      }
      this.gateway.emitSideloopStatus(this.degraded());
      return;
    }

    this.failCount = 0;
    if (!this.wasReachable) {
      this.gateway.addLog('ok', 'sideloop', 'sideloop de nouveau joignable');
      this.wasReachable = true;
    }

    this.notifyNewAlerts(status);
    this.gateway.emitSideloopStatus(status);
  }

  /** Log chaque alerte NOUVELLE (apparue depuis le dernier poll), purge les résolues. */
  private notifyNewAlerts(status: SideloopStatus): void {
    const current = new Set(status.alerts);
    for (const alert of status.alerts) {
      if (!this.knownAlerts.has(alert)) {
        // "expire dans" = warn ; "EXPIRÉE" / "échec" / "injoignable" = error
        const level = /expir[ée]|échec|jamais|injoignable/i.test(alert) ? 'error' : 'warn';
        this.gateway.addLog(level, 'sideloop', alert);
      }
    }
    // alertes disparues = résolues → petit log ok (utile dans le journal)
    for (const prev of this.knownAlerts) {
      if (!current.has(prev)) {
        this.gateway.addLog('ok', 'sideloop', `résolu : ${prev}`);
      }
    }
    this.knownAlerts = current;
  }

  /** État minimal émis quand sideloop est injoignable (garde l'UI cohérente). */
  private degraded(): SideloopStatus {
    return {
      generated_at: new Date().toISOString(),
      account: { apple_id: '', team_id: '', app_slots_used: 0, app_slots_limit: 3 },
      agent: { last_seen: null, tunneld_active: false, reachable_udids: [], stale: true },
      devices: [],
      apps: [],
      last_refresh_at: null,
      last_refresh_ok: null,
      recent_runs: [],
      alerts: ['sideloop injoignable'],
      reachable: false,
    };
  }
}
