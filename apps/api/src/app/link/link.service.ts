import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import * as net from 'net';
import { NexusGateway } from '../gateway/nexus.gateway';
import { LinkStoreService } from './link-store.service';
import { LinkOutage, LinkStatus } from '@nexus/shared-types';

// Sonde de connectivité depuis le pod api. Tout l'egress du cluster sort par le
// WiFi de pve → le Home Hub : quand le Hub reboote, le pod perd la passerelle ET
// le WAN. La passerelle injoignable (gatewayUp=false) est donc la signature d'un
// reboot du boîtier, distincte d'une panne de ligne (passerelle ok, WAN down).
const GATEWAY   = process.env['LINK_GATEWAY'] ?? '192.168.2.1';
const WAN       = process.env['LINK_WAN'] ?? '1.1.1.1';
const PORT      = Number(process.env['LINK_CHECK_PORT'] ?? 443);
const INTERVAL_MS = Number(process.env['LINK_INTERVAL_MS'] ?? 10_000);
const TIMEOUT_MS  = Number(process.env['LINK_TIMEOUT_MS'] ?? 3_000);
// Anti-rebond : il faut N échecs consécutifs pour déclarer une coupure (évite de
// compter un blip transitoire d'une seule sonde). Le début est antidaté au 1er échec.
const CONFIRM_FAILS = Number(process.env['LINK_CONFIRM_FAILS'] ?? 2);

const DAY_MS = 24 * 60 * 60 * 1000;
const RECENT_LIMIT = 20;

@Injectable()
export class LinkService implements OnModuleInit {
  private readonly logger = new Logger(LinkService.name);

  private online = true;              // supposé en ligne au démarrage
  private stateSince = Date.now();
  private consecutiveFails = 0;
  private firstFailAt: number | null = null;
  private ongoing: LinkOutage | null = null;

  constructor(
    private readonly gateway: NexusGateway,
    private readonly store: LinkStoreService,
  ) {
    this.logger.log(`Sonde connexion : passerelle ${GATEWAY}, WAN ${WAN}:${PORT} toutes les ${INTERVAL_MS / 1000}s`);
  }

  onModuleInit() {
    void this.tick();   // premier état sans attendre le tick
  }

  @Interval(INTERVAL_MS)
  async tick(): Promise<void> {
    const [gatewayUp, wanUp] = await Promise.all([this.check(GATEWAY), this.check(WAN)]);
    const now = Date.now();
    const reachable = wanUp;

    if (reachable) {
      if (!this.online && this.ongoing) {
        this.ongoing.end = now;
        this.ongoing.durationSec = Math.round((now - this.ongoing.start) / 1000);
        this.store.insert(this.ongoing);
        this.gateway.addLog('ok', 'link',
          `Connexion rétablie après ${fmtDur(this.ongoing.durationSec)}` +
          (this.ongoing.hubDown ? ' — Home Hub était tombé (reboot)' : ''));
        this.ongoing = null;
      }
      if (!this.online) { this.online = true; this.stateSince = now; }
      this.consecutiveFails = 0;
      this.firstFailAt = null;
    } else {
      if (this.firstFailAt === null) this.firstFailAt = now;
      this.consecutiveFails++;

      if (this.online && this.consecutiveFails >= CONFIRM_FAILS) {
        this.online = false;
        this.stateSince = this.firstFailAt;
        this.ongoing = { start: this.firstFailAt, end: null, durationSec: 0, hubDown: !gatewayUp };
        this.gateway.addLog('warn', 'link',
          'Connexion Internet perdue' +
          (!gatewayUp ? ' — Home Hub injoignable (reboot ?)' : ' — passerelle ok, ligne en cause ?'));
      }
      if (this.ongoing) {
        if (!gatewayUp) this.ongoing.hubDown = true;   // la passerelle est tombée à un moment = Hub down
        this.ongoing.durationSec = Math.round((now - this.ongoing.start) / 1000);
      }
    }

    this.gateway.emitLinkStatus(this.buildStatus(now, gatewayUp, wanUp));
  }

  private buildStatus(now: number, gatewayUp: boolean, wanUp: boolean): LinkStatus {
    const dayAgo = now - DAY_MS;
    const stored = this.store.since(dayAgo);

    let downMs = stored.reduce((sum, o) => sum + (o.end ?? now) - o.start, 0);
    if (this.ongoing) downMs += now - Math.max(this.ongoing.start, dayAgo);
    const uptime24hPct = Math.max(0, Math.min(100, 100 * (1 - downMs / DAY_MS)));

    const recent = [
      ...(this.ongoing ? [{ ...this.ongoing }] : []),
      ...this.store.recent(RECENT_LIMIT),
    ].slice(0, RECENT_LIMIT);

    return {
      online:        wanUp,
      gatewayUp,
      wanUp,
      checkedAt:     now,
      stateSinceMs:  now - this.stateSince,
      uptime24hPct:  Math.round(uptime24hPct * 100) / 100,
      outages24h:    stored.length + (this.ongoing ? 1 : 0),
      lastOutage:    recent[0] ?? null,
      recentOutages: recent,
    };
  }

  /** Test de joignabilité : connexion TCP à host:PORT, true si le socket s'ouvre. */
  private check(host: string): Promise<boolean> {
    return new Promise(resolve => {
      const sock = net.connect({ host, port: PORT });
      let done = false;
      const finish = (ok: boolean) => { if (done) return; done = true; sock.destroy(); resolve(ok); };
      sock.setTimeout(TIMEOUT_MS);
      sock.once('connect', () => finish(true));
      sock.once('timeout', () => finish(false));
      sock.once('error',   () => finish(false));
    });
  }
}

function fmtDur(sec: number): string {
  const m = Math.floor(sec / 60), s = sec % 60;
  return m > 0 ? `${m} min ${s.toString().padStart(2, '0')} s` : `${s} s`;
}
