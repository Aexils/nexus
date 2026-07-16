import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { NexusGateway } from '../gateway/nexus.gateway';

interface ExporterEntry { ts: number; level: 'warn' | 'error'; message: string; }
interface ExporterResponse { inode: number; pos: number; entries: ExporterEntry[]; }

// Exporteur de logs Kodi sur le RPi5 LibreELEC (voir rpi5/backup/nexus-log-exporter).
// Il sert les WARNING/ERROR de kodi.log ; on garde le curseur (inode+offset) ici,
// l'exporteur est sans état. Vide → intégration désactivée.
const KODI_LOG_URL = process.env['KODI_LOG_URL'] ?? '';

@Injectable()
export class KodiLogService {
  private readonly logger = new Logger(KodiLogService.name);

  private cursor: { inode: number; pos: number } | null = null;
  private warnEmitted = false;
  private failCount = 0;   // échecs consécutifs (anti-blip : Pi qui reboote, WiFi…)

  constructor(private readonly gateway: NexusGateway) {
    if (KODI_LOG_URL) {
      this.logger.log(`Logs Kodi via ${KODI_LOG_URL}`);
      this.gateway.addLog('debug', 'kodi', `Suivi des logs Kodi via ${KODI_LOG_URL}`);
    } else {
      this.logger.log('KODI_LOG_URL absent — suivi des logs Kodi désactivé');
    }
  }

  @Interval(15_000)
  async poll(): Promise<void> {
    if (!KODI_LOG_URL) return;

    const qs = this.cursor ? `?inode=${this.cursor.inode}&pos=${this.cursor.pos}` : '';
    let data: ExporterResponse;
    try {
      const res = await fetch(`${KODI_LOG_URL}/logs${qs}`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = (await res.json()) as ExporterResponse;
    } catch {
      this.failCount++;
      // N'alarme qu'après 3 échecs consécutifs (~45 s) — un blip réseau = normal.
      if (!this.warnEmitted && this.failCount >= 3) {
        this.warnEmitted = true;
        this.logger.warn(`Exporteur de logs Kodi injoignable: ${KODI_LOG_URL}`);
        this.gateway.addLog('warn', 'kodi', 'Exporteur de logs Kodi injoignable (Pi éteint ?)');
      }
      return;
    }

    this.failCount = 0;
    if (this.warnEmitted) {
      this.warnEmitted = false;
      this.gateway.addLog('ok', 'kodi', 'Exporteur de logs Kodi de nouveau joignable');
    }

    this.cursor = { inode: data.inode, pos: data.pos };
    for (const e of data.entries) {
      this.gateway.addLog(e.level, 'kodi', e.message, e.ts);
    }
  }
}
