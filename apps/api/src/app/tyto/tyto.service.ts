import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { NexusGateway } from '../gateway/nexus.gateway';
import { TytoStoreService } from './tyto-store.service';
import { TytoEvent, TytoStatus, TytoSettings, TytoMixer } from '@nexus/shared-types';

// Tyto tourne sur l'HÔTE pve, hors cluster : les pods joignent 10.10.10.1
// nativement (même chemin que node_exporter sur :9100).
const TYTO_URL = process.env['TYTO_URL'] ?? '';
const MAX_RECENT = 50;

interface RawStatus {
  baseline: number | null;
  last_db: number | null;
  state: string;
  events_today: number;
  /** Réglages RÉELLEMENT appliqués par Tyto — pas ceux qu'on lui a demandés. */
  settings?: Partial<TytoSettings>;
  /** Ce que la carte son applique, relu par Tyto. */
  mixer?: Partial<TytoMixer>;
}
interface RawEvent {
  ts: string; file: string; day: string;
  duration: number; peak: number; baseline: number; notify: boolean;
}

@Injectable()
export class TytoService implements OnModuleInit {
  private readonly logger = new Logger(TytoService.name);

  private failCount = 0;
  private unreachableWarned = false;
  /** ts du dernier événement déjà versé au Journal — évite de rejouer l'historique. */
  private lastSeenTs = 0;
  private recent: TytoEvent[] = [];

  constructor(
    private readonly gateway: NexusGateway,
    private readonly store: TytoStoreService,
  ) {
    if (TYTO_URL) this.logger.log(`Suivi Tyto via ${TYTO_URL}`);
    else this.logger.log('TYTO_URL absent — suivi Tyto désactivé');
  }

  onModuleInit() {
    void this.poll();
  }

  @Interval(20_000)
  async poll(): Promise<void> {
    if (!TYTO_URL) return;
    try {
      const [status, events] = await Promise.all([
        this.fetchJson<RawStatus>('/status'),
        this.fetchJson<{ events: RawEvent[] }>('/events'),
      ]);

      if (this.unreachableWarned) {
        this.gateway.addLog('info', 'tyto', 'Tyto est de nouveau joignable');
        this.unreachableWarned = false;
      }
      this.failCount = 0;

      this.ingestEvents(events.events ?? []);
      this.emit(true, status);
    } catch (e) {
      this.failCount++;
      // 3 échecs = 1 min sans réponse : on ne crie pas sur un hoquet réseau,
      // mais un micro muet un week-end entier doit se savoir.
      if (this.failCount === 3 && !this.unreachableWarned) {
        this.unreachableWarned = true;
        this.gateway.addLog('error', 'tyto',
          `Tyto injoignable depuis 1 min (${(e as Error).message}) — surveillance audio non confirmée`);
      }
      this.emit(false, null);
    }
  }

  /** Verse les NOUVEAUX déclenchements au Journal (dédup par horodatage). */
  private ingestEvents(raw: RawEvent[]): void {
    const parsed: TytoEvent[] = raw.map(e => ({
      ts: Date.parse(e.ts),
      file: e.file,
      day: e.day,
      duration: e.duration,
      peak: e.peak,
      baseline: e.baseline,
      notified: e.notify,
    })).filter(e => Number.isFinite(e.ts));

    parsed.sort((a, b) => b.ts - a.ts);
    this.recent = parsed.slice(0, MAX_RECENT);

    // Premier passage : on adopte l'historique sans le rejouer dans le Journal.
    if (this.lastSeenTs === 0) {
      this.lastSeenTs = parsed.length ? parsed[0].ts : Date.now();
      return;
    }

    const fresh = parsed.filter(e => e.ts > this.lastSeenTs).sort((a, b) => a.ts - b.ts);
    for (const e of fresh) {
      // 'info' et pas 'warn' : le push ntfy est fait par Tyto lui-même, en mode
      // armé seulement. Un 'warn' ici doublerait la notification.
      this.gateway.addLog('info', 'tyto',
        `Bruit détecté — ${e.duration.toFixed(0)}s, pic ${e.peak.toFixed(0)} dBFS (fond ${e.baseline.toFixed(0)})`,
        e.ts);
      this.lastSeenTs = Math.max(this.lastSeenTs, e.ts);
    }
  }

  private emit(reachable: boolean, s: RawStatus | null): void {
    const m = this.store.get();
    // On affiche ce que TYTO applique, pas ce que la base contient : tant que le
    // sondage n'a pas eu lieu, les deux diffèrent, et l'écart doit se voir.
    const applied: TytoSettings = { ...m.settings, ...(s?.settings ?? {}) };
    const payload: TytoStatus = {
      reachable,
      mode: m.mode,
      until: m.until,
      state: reachable ? (s?.state ?? 'inconnu') : 'injoignable',
      baseline: s?.baseline ?? null,
      lastDb: s?.last_db ?? null,
      eventsToday: s?.events_today ?? 0,
      settings: applied,
      mixer: (s?.mixer && Object.keys(s.mixer).length
        ? { gainPct: s.mixer.gainPct ?? null, gainDb: s.mixer.gainDb ?? null,
            agc: s.mixer.agc ?? null }
        : null),
      recent: this.recent,
      checkedAt: Date.now(),
    };
    this.gateway.emitTytoStatus(payload);
  }

  /** Pousse l'état courant tout de suite après un changement de mode côté UI. */
  refreshAfterModeChange(): void {
    void this.poll();
  }

  private async fetchJson<T>(path: string): Promise<T> {
    const r = await fetch(`${TYTO_URL}${path}`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`HTTP ${r.status} sur ${path}`);
    return (await r.json()) as T;
  }
}
