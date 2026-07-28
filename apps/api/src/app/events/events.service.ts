import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { KubeConfig, CoreV1Api } from '@kubernetes/client-node';
import { NexusGateway } from '../gateway/nexus.gateway';

/**
 * Remonte les Events Kubernetes de type `Warning` dans le Journal (source `events`).
 * On ignore volontairement les Events `Normal` (Pulled/Created/Started…) : ils
 * noieraient le Journal. Les `Warning` = le signal de troubleshooting (FailedScheduling,
 * BackOff, OOMKilling, Unhealthy, FailedMount…), l'équivalent de `kubectl get events`.
 *
 * Dédup : un Event peut se répéter (son `count` s'incrémente). On mémorise le dernier
 * `count` vu par UID et on ne re-logue que si l'event est nouveau ou que son count a
 * augmenté. La contrainte `UNIQUE(ts, source, message)` du log-store couvre en plus les
 * redémarrages de l'API (Kubernetes ne garde les Events que ~1 h, donc pas d'inondation).
 */
@Injectable()
export class EventsService implements OnModuleInit {
  private readonly logger = new Logger(EventsService.name);
  private core!: CoreV1Api;
  private available = false;
  private readonly seen = new Map<string, number>();   // uid → dernier count logué

  constructor(private readonly gateway: NexusGateway) {}

  onModuleInit(): void {
    try {
      const kc = new KubeConfig();
      kc.loadFromCluster();
      this.core = kc.makeApiClient(CoreV1Api);
      this.available = true;
    } catch (e) {
      this.logger.warn(`Pas de config in-cluster (dev ?) : ${(e as Error).message}`);
    }
  }

  @Interval(20_000)
  async poll(): Promise<void> {
    if (!this.available) return;
    try {
      const res = await this.core.listEventForAllNamespaces({ fieldSelector: 'type=Warning' });
      // Tri chronologique pour insérer dans l'ordre où les choses se sont produites.
      const items = [...(res.items ?? [])].sort(
        (a, b) => this.eventTime(a) - this.eventTime(b),
      );

      for (const ev of items) {
        const uid = ev.metadata?.uid;
        if (!uid) continue;
        const count = ev.count ?? 1;
        if (this.seen.get(uid) === count) continue;   // déjà logué à ce compteur
        this.seen.set(uid, count);

        const obj = ev.involvedObject;
        const where = `${obj?.namespace ?? '-'}/${obj?.name ?? '?'}`;
        const suffix = count > 1 ? ` (×${count})` : '';
        const message = `[${where}] ${ev.reason ?? 'Warning'}: ${ev.message ?? ''}${suffix}`;
        this.gateway.addLog('warn', 'events', message, this.eventTime(ev));
      }

      this.prune();
    } catch (e) {
      this.logger.warn(`Lecture des Events k8s échouée : ${(e as Error).message}`);
    }
  }

  /** Horodatage le plus récent d'un Event, en ms (lastTimestamp > eventTime > now). */
  private eventTime(ev: { lastTimestamp?: Date | string; eventTime?: Date | string }): number {
    const raw = ev.lastTimestamp ?? ev.eventTime;
    const ts = raw ? new Date(raw).getTime() : NaN;
    return Number.isNaN(ts) ? Date.now() : ts;
  }

  /** Borne la map de dédup : les Events k8s expirent (~1 h), on garde les 500 derniers UID. */
  private prune(): void {
    if (this.seen.size <= 500) return;
    const excess = this.seen.size - 500;
    let i = 0;
    for (const key of this.seen.keys()) {
      if (i++ >= excess) break;
      this.seen.delete(key);
    }
  }
}
