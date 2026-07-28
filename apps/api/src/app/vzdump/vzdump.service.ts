import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import * as https from 'https';
import { NexusGateway } from '../gateway/nexus.gateway';

// API Proxmox VE. Le token porte le format « user@realm!tokenid=uuid » ; on l'injecte
// tel quel dans l'en-tête PVEAPIToken. PVE présente un certificat auto-signé → on
// désactive la vérif TLS pour CE client seulement (appel interne vers 10.10.10.1).
const PVE_API_URL = process.env['PVE_API_URL'] ?? '';       // ex. https://10.10.10.1:8006
const PVE_API_TOKEN = process.env['PVE_API_TOKEN'] ?? '';   // ex. nexus@pve!vzdump=<uuid>
const PVE_NODE = process.env['PVE_NODE'] ?? 'pve';

interface PveTask {
  upid: string;
  status?: string;       // "OK" | message d'erreur | absent si en cours
  starttime?: number;    // epoch secondes
  endtime?: number;      // epoch secondes ; absent tant que la tâche tourne
}

/**
 * Remonte dans le Journal (source `vzdump`) l'issue des sauvegardes Proxmox (vzdump →
 * disque USB). Poll l'API PVE `/nodes/{node}/tasks?typefilter=vzdump`, ne logue que les
 * tâches TERMINÉES (endtime présent), une seule fois par UPID. `status=OK` → `ok`,
 * sinon → `error` (donc relayé en push par le notifier). La contrainte
 * `UNIQUE(ts, source, message)` du log-store couvre les redémarrages de l'API.
 */
@Injectable()
export class VzdumpService implements OnModuleInit {
  private readonly logger = new Logger(VzdumpService.name);
  private readonly enabled = Boolean(PVE_API_URL && PVE_API_TOKEN);
  private readonly seen = new Set<string>();   // UPID déjà logués

  constructor(private readonly gateway: NexusGateway) {}

  onModuleInit(): void {
    if (!this.enabled) {
      this.logger.warn('PVE_API_URL/PVE_API_TOKEN absents — suivi vzdump désactivé');
      return;
    }
    // Poll initial (retour immédiat au boot) — l'@Interval prend ensuite le relais.
    setTimeout(() => this.poll(), 8000);
  }

  @Interval(5 * 60 * 1000)   // vzdump est quotidien : un poll /5 min suffit largement
  async poll(): Promise<void> {
    if (!this.enabled) return;
    try {
      const tasks = await this.fetchTasks();
      // Ordre chronologique d'exécution pour insérer dans le bon sens.
      tasks.sort((a, b) => (a.endtime ?? 0) - (b.endtime ?? 0));

      for (const t of tasks) {
        if (!t.endtime || !t.upid || this.seen.has(t.upid)) continue;   // en cours / déjà vu
        this.seen.add(t.upid);

        const ok = t.status === 'OK';
        const dur = this.duration(t.starttime, t.endtime);
        const detail = ok ? 'OK' : (t.status ?? 'échec');
        const message = `vzdump (sauvegarde VMs) : ${detail}${dur ? ` (${dur})` : ''}`;
        this.gateway.addLog(ok ? 'ok' : 'error', 'vzdump', message, t.endtime * 1000);
      }
      this.prune();
    } catch (e) {
      this.logger.warn(`Lecture des tâches vzdump échouée : ${(e as Error).message}`);
    }
  }

  /** GET des dernières tâches vzdump du nœud (TLS auto-signé PVE toléré ici). */
  private fetchTasks(): Promise<PveTask[]> {
    const url = `${PVE_API_URL}/api2/json/nodes/${PVE_NODE}/tasks?typefilter=vzdump&limit=15`;
    return new Promise((resolve, reject) => {
      const req = https.get(
        url,
        {
          headers: { Authorization: `PVEAPIToken=${PVE_API_TOKEN}` },
          rejectUnauthorized: false,
          timeout: 8000,
        },
        res => {
          let body = '';
          res.on('data', d => (body += d));
          res.on('end', () => {
            if ((res.statusCode ?? 0) >= 400) return reject(new Error(`HTTP ${res.statusCode}`));
            try {
              resolve((JSON.parse(body).data ?? []) as PveTask[]);
            } catch (e) {
              reject(e);
            }
          });
        },
      );
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error('timeout')));
    });
  }

  /** Durée « 8m 24s » / « 42s » depuis starttime → endtime (secondes epoch). */
  private duration(start?: number, end?: number): string {
    if (!start || !end || end < start) return '';
    const s = end - start;
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
  }

  /** Borne la mémoire de dédup (l'API PVE ne renvoie qu'un historique récent). */
  private prune(): void {
    if (this.seen.size <= 200) return;
    const excess = this.seen.size - 200;
    let i = 0;
    for (const key of this.seen) {
      if (i++ >= excess) break;
      this.seen.delete(key);
    }
  }
}
