import { Injectable, Logger } from '@nestjs/common';
import { LogLevel, LogSource } from '@nexus/shared-types';

/**
 * Envoie une notification push (ntfy) sur les événements qui comptent, pour que
 * les pannes se sachent SANS regarder le dashboard. Best-effort : jamais bloquant.
 *
 * Config par env :
 *   NTFY_URL   = http://ntfy.ntfy.svc.cluster.local/nexus-homelab  (topic inclus)
 *   NTFY_TOKEN = jeton d'accès (optionnel)
 * Sans NTFY_URL → no-op (dev / pas encore déployé).
 */
@Injectable()
export class NotifierService {
  private readonly logger = new Logger(NotifierService.name);
  private readonly url = process.env['NTFY_URL'] ?? '';
  private readonly token = process.env['NTFY_TOKEN'] ?? '';
  // Dédup : ne pas renvoyer le même message avant DEDUP_MS.
  private readonly lastSent = new Map<string, number>();
  private readonly DEDUP_MS = 30 * 60 * 1000;

  /** Décide si un log mérite un push, puis l'envoie (dédupliqué). */
  notify(level: LogLevel, source: LogSource, message: string): void {
    if (!this.url) return;
    // error = toujours ; warn = seulement les sources actionnables.
    // kodi = journal d'observation relayé du RPi (bruyant, non actionnable) → jamais de push.
    const worthy = (level === 'error' && source !== 'kodi')
      || (level === 'warn' && (source === 'sideloop' || source === 'system'));
    if (!worthy) return;

    const key = `${source}:${message}`;
    const now = Date.now();
    const prev = this.lastSent.get(key);
    if (prev && now - prev < this.DEDUP_MS) return;
    this.lastSent.set(key, now);
    this.prune(now);

    void this.send(level, source, message);
  }

  private async send(level: LogLevel, source: LogSource, message: string): Promise<void> {
    const headers: Record<string, string> = {
      Title: `Nexus · ${source}`,
      Priority: level === 'error' ? 'high' : 'default',
      Tags: level === 'error' ? 'rotating_light' : 'warning',
    };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    try {
      await fetch(this.url, {
        method: 'POST',
        headers,
        body: message,
        signal: AbortSignal.timeout(5000),
      });
    } catch (e) {
      this.logger.debug(`Push ntfy échoué : ${(e as Error).message}`);
    }
  }

  private prune(now: number): void {
    for (const [k, t] of this.lastSent) {
      if (now - t > this.DEDUP_MS) this.lastSent.delete(k);
    }
  }
}
