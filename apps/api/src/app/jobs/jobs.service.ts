import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { KubeConfig, BatchV1Api, V1Job } from '@kubernetes/client-node';
import { NexusGateway } from '../gateway/nexus.gateway';

/**
 * Remonte dans le Journal (source `jobs`) l'issue TERMINALE des Jobs pilotés par un
 * CronJob : les tâches planifiées du homelab (backup etcd nocturne, sideloop-refresh…).
 * C'est le signal ops « ma sauvegarde a-t-elle tourné cette nuit ? ».
 *
 *  - succès  → niveau `ok`
 *  - échec   → niveau `error` (donc relayé en notification push par le notifier)
 *
 * On ne logue que les Jobs possédés par un CronJob (les Jobs one-shot manuels sont
 * ignorés) et une seule fois par Job (dédup par UID). La contrainte
 * `UNIQUE(ts, source, message)` du log-store couvre les redémarrages de l'API — Kubernetes
 * ne garde qu'un petit historique de Jobs par CronJob (successfulJobsHistoryLimit).
 */
@Injectable()
export class JobsService implements OnModuleInit {
  private readonly logger = new Logger(JobsService.name);
  private batch!: BatchV1Api;
  private available = false;
  private readonly seen = new Set<string>();   // UID des Jobs déjà logués (état terminal)

  constructor(private readonly gateway: NexusGateway) {}

  onModuleInit(): void {
    try {
      const kc = new KubeConfig();
      kc.loadFromCluster();
      this.batch = kc.makeApiClient(BatchV1Api);
      this.available = true;
    } catch (e) {
      this.logger.warn(`Pas de config in-cluster (dev ?) : ${(e as Error).message}`);
    }
  }

  @Interval(30_000)
  async poll(): Promise<void> {
    if (!this.available) return;
    try {
      const res = await this.batch.listJobForAllNamespaces();
      for (const job of res.items ?? []) {
        const uid = job.metadata?.uid;
        if (!uid || this.seen.has(uid)) continue;

        const owner = job.metadata?.ownerReferences?.find(o => o.kind === 'CronJob');
        if (!owner) continue;                       // uniquement les tâches planifiées

        const cond = job.status?.conditions?.find(
          c => (c.type === 'Complete' || c.type === 'Failed') && c.status === 'True',
        );
        if (!cond) continue;                        // pas encore terminé

        this.seen.add(uid);
        const ok = cond.type === 'Complete';
        const ns = job.metadata?.namespace ?? '-';
        const dur = this.duration(job);
        const ts = cond.lastTransitionTime ? new Date(cond.lastTransitionTime).getTime() : Date.now();
        const message = `[${ns}] ${owner.name} : ${ok ? 'succès' : 'échec'}${dur ? ` (${dur})` : ''}`;
        this.gateway.addLog(ok ? 'ok' : 'error', 'jobs', message, ts);
      }
      this.prune();
    } catch (e) {
      this.logger.warn(`Lecture des Jobs k8s échouée : ${(e as Error).message}`);
    }
  }

  /** Durée d'exécution « 34s » / « 2m 3s », depuis startTime → completionTime. */
  private duration(job: V1Job): string {
    const start = job.status?.startTime ? new Date(job.status.startTime).getTime() : NaN;
    const end = job.status?.completionTime ? new Date(job.status.completionTime).getTime() : NaN;
    if (Number.isNaN(start) || Number.isNaN(end) || end < start) return '';
    const s = Math.round((end - start) / 1000);
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
  }

  /** Borne la mémoire de dédup (l'historique de Jobs k8s est petit et tournant). */
  private prune(): void {
    if (this.seen.size <= 300) return;
    const excess = this.seen.size - 300;
    let i = 0;
    for (const key of this.seen) {
      if (i++ >= excess) break;
      this.seen.delete(key);
    }
  }
}
