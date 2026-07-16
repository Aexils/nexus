import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { NexusGateway } from '../gateway/nexus.gateway';
import { NextcloudStatus } from '@nexus/shared-types';

// API serverinfo de Nextcloud, authentifiée par token dédié (header NC-Token,
// occ config:app:set serverinfo token). On passe par la gateway Envoy : le
// default-deny du namespace nextcloud n'autorise que le proxy en ingress.
const NEXTCLOUD_URL = process.env['NEXTCLOUD_URL'] ?? '';
const NEXTCLOUD_TOKEN = process.env['NEXTCLOUD_TOKEN'] ?? '';

// Disjoncteur backup du homelab : médiathèque > 180 Go → le miroir NVMe (200 Go)
// ne suit plus. Partition de 310 Go → on alerte sous 130 Go libres.
const FREE_WARN_BYTES = Number(process.env['NEXTCLOUD_FREE_WARN_GB'] ?? 130) * 1e9;

interface ServerInfoResponse {
  ocs: {
    data: {
      nextcloud: {
        system: { version: string; freespace: number };
        storage: { num_users: number; num_files: number };
      };
      server: { database: { size: number | string } };
      activeUsers: { last5minutes: number; last24hours: number };
    };
  };
}

@Injectable()
export class NextcloudService implements OnModuleInit {
  private readonly logger = new Logger(NextcloudService.name);

  private failCount = 0;
  private warnEmitted = false;      // injoignable
  private spaceWarnEmitted = false; // espace bas

  constructor(private readonly gateway: NexusGateway) {
    if (NEXTCLOUD_URL && NEXTCLOUD_TOKEN) {
      this.logger.log(`Suivi Nextcloud via ${NEXTCLOUD_URL}`);
    } else {
      this.logger.log('NEXTCLOUD_URL/TOKEN absents — suivi Nextcloud désactivé');
    }
  }

  onModuleInit() {
    void this.poll();   // premier état sans attendre le premier tick
  }

  @Interval(60_000)
  async poll(): Promise<void> {
    if (!NEXTCLOUD_URL || !NEXTCLOUD_TOKEN) return;

    let data: ServerInfoResponse['ocs']['data'];
    try {
      const res = await fetch(
        `${NEXTCLOUD_URL}/ocs/v2.php/apps/serverinfo/api/v1/info?format=json&skipApps=true&skipUpdate=true`,
        { headers: { 'NC-Token': NEXTCLOUD_TOKEN }, signal: AbortSignal.timeout(10_000) },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = ((await res.json()) as ServerInfoResponse).ocs.data;
    } catch {
      this.failCount++;
      if (!this.warnEmitted && this.failCount >= 3) {
        this.warnEmitted = true;
        this.gateway.addLog('warn', 'nextcloud', 'Nextcloud injoignable (serverinfo)');
      }
      this.gateway.emitNextcloudStatus({ reachable: false, checkedAt: Date.now() });
      return;
    }

    this.failCount = 0;
    if (this.warnEmitted) {
      this.warnEmitted = false;
      this.gateway.addLog('ok', 'nextcloud', 'Nextcloud de nouveau joignable');
    }

    const status: NextcloudStatus = {
      reachable:   true,
      checkedAt:   Date.now(),
      version:     data.nextcloud.system.version,
      freeBytes:   data.nextcloud.system.freespace,
      numFiles:    data.nextcloud.storage.num_files,
      numUsers:    data.nextcloud.storage.num_users,
      active5m:    data.activeUsers.last5minutes,
      active24h:   data.activeUsers.last24hours,
      dbSizeBytes: Number(data.server.database.size) || undefined,
    };
    this.gateway.emitNextcloudStatus(status);

    if (status.freeBytes !== undefined && status.freeBytes < FREE_WARN_BYTES) {
      if (!this.spaceWarnEmitted) {
        this.spaceWarnEmitted = true;
        this.gateway.addLog('warn', 'nextcloud',
          `Espace bas : ${(status.freeBytes / 1e9).toFixed(0)} Go libres — disjoncteur 180 Go (miroir NVMe), penser au NAS`);
      }
    } else {
      this.spaceWarnEmitted = false;
    }
  }
}
