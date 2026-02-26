import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import * as fs from 'fs';
import { execSync } from 'child_process';
import axios from 'axios';
import Database from 'better-sqlite3';

import { NexusGateway } from '../gateway/nexus.gateway';
import {
  SideloadlyStatus,
  SideloadlyDaemon,
  SideloadlyAccount,
  SideloadlyDevice,
  SideloadlyApp,
} from '@nexus/shared-types';

const DB_PATH          = process.env['SIDELOADLY_DB_PATH']     ?? '/sideloadly-local/installations.db';
const APPIDS_PATH      = process.env['SIDELOADLY_APPIDS_PATH'] ?? '/sideloadly-local/account-appids.json';
const LOG_PATH         = process.env['SIDELOADLY_LOG_PATH']    ?? '/sideloadly-local/sideloadlydaemon.log';
const HOST_METRICS_URL = process.env['HOST_METRICS_URL']       ?? '';

// Daemon is considered alive if log was modified within this window
const ALIVE_THRESHOLD_MS = 3 * 60 * 1000;
// How many bytes to read from the tail of the log for startup detection
const LOG_TAIL_BYTES = 512 * 1024;

// Apps expiring within this window are flagged as 'expiring'
const EXPIRING_THRESHOLD_MS = 24 * 3600 * 1000;
// Apps expired for longer than this are hidden (considered permanently removed)
const EXPIRED_HIDE_THRESHOLD_MS = 30 * 24 * 3600 * 1000;

@Injectable()
export class SideloadlyService implements OnModuleInit {
  private readonly logger = new Logger(SideloadlyService.name);

  private readonly EMPTY_DAEMON: SideloadlyDaemon = { alive: false, startedAt: null, uptimeSec: null, ramMB: null };
  private currentStatus: SideloadlyStatus = { connected: false, daemon: this.EMPTY_DAEMON, accounts: [], devices: [], apps: [] };
  private warnEmitted = false;

  constructor(private readonly gateway: NexusGateway) {}

  async onModuleInit() {
    const status = await this.readStatus();
    this.currentStatus = status;
    this.gateway.emitSideloadlyStatus(status);

    if (status.connected) {
      this.logger.log(`Sideloadly: ${status.apps.length} apps, ${status.devices.length} appareils`);
      this.gateway.addLog('ok', 'sideloadly',
        `Sideloadly connecté — ${status.apps.length} apps sur ${status.devices.length} appareils`,
      );
    } else {
      this.logger.warn(`Sideloadly data inaccessible (DB: ${DB_PATH})`);
      this.gateway.addLog('warn', 'sideloadly', 'Données Sideloadly inaccessibles — vérifier le volume Docker');
    }
  }

  @Interval(30_000)
  async poll(): Promise<void> {
    const next = await this.readStatus();
    this.detectChanges(next);
    this.currentStatus = next;
    this.gateway.emitSideloadlyStatus(next);
  }

  // ── Change detection ──────────────────────────────────────────────────────

  private detectChanges(next: SideloadlyStatus): void {
    if (!this.currentStatus.connected && next.connected) {
      this.gateway.addLog('ok', 'sideloadly', 'Sideloadly accessible');
    }
    if (this.currentStatus.connected && !next.connected) {
      this.gateway.addLog('warn', 'sideloadly', 'Sideloadly inaccessible');
    }
    if (!next.connected) return;

    for (const app of next.apps) {
      const prev = this.currentStatus.apps.find(a => a.id === app.id);

      // Renewed app detected (lastRenewedAt changed)
      if (prev && prev.lastRenewedAt !== app.lastRenewedAt) {
        if (app.failuresCount === 0) {
          this.gateway.addLog('ok', 'sideloadly',
            `Renouvelé : ${app.name} → ${app.deviceName} (${app.appleId})`,
          );
        }
      }

      // New failure detected
      if (prev && app.failuresCount > prev.failuresCount && app.lastError) {
        this.gateway.addLog('error', 'sideloadly',
          `Échec renewal ${app.name} → ${app.deviceName}: ${app.lastError}`,
        );
      }

      // App newly expiring (crossed the threshold between polls)
      if (prev && prev.status === 'ok' && app.status === 'expiring') {
        this.gateway.addLog('warn', 'sideloadly',
          `Expire bientôt : ${app.name} → ${app.deviceName}`,
        );
      }

      // App expired
      if (prev && prev.status !== 'expired' && app.status === 'expired') {
        this.gateway.addLog('error', 'sideloadly',
          `Expiré : ${app.name} → ${app.deviceName}`,
        );
      }
    }
  }

  // ── Data reading ──────────────────────────────────────────────────────────

  private async readStatus(): Promise<SideloadlyStatus> {
    const daemon = await this.readDaemon();
    try {
      const accounts = this.readAccounts();
      const { devices, apps } = this.readDb();
      this.warnEmitted = false;
      return { connected: true, daemon, accounts, devices, apps };
    } catch (err: any) {
      if (!this.warnEmitted) {
        this.warnEmitted = true;
        this.logger.warn(`Cannot read Sideloadly data: ${err?.message ?? err}`);
      }
      return { connected: false, daemon, accounts: [], devices: [], apps: [] };
    }
  }

  // ── Daemon process monitoring ─────────────────────────────────────────────

  private async readDaemon(): Promise<SideloadlyDaemon> {
    // Primary source: windows_exporter process metrics
    const fromExporter = await this.readDaemonFromExporter();
    if (fromExporter) return fromExporter;

    // Second option: tasklist (works when API runs directly on Windows)
    const fromTasklist = this.readDaemonFromTasklist();
    if (fromTasklist) return fromTasklist;

    // Fallback: log file inspection
    return this.readDaemonFromLog();
  }

  private readDaemonFromTasklist(): SideloadlyDaemon | null {
    if (process.platform !== 'win32') return null;
    try {
      const output = execSync(
        'tasklist /FI "IMAGENAME eq sideloadlydaemon.exe" /FO CSV /NH',
        { timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] },
      ).toString();
      if (!output.toLowerCase().includes('sideloadlydaemon.exe')) return null;

      // CSV format: "sideloadlydaemon.exe","1234","Console","1","12,345 K"
      const match = output.match(/"sideloadlydaemon\.exe","(\d+)",[^,]+,\d+,"([\d,]+) K"/i);
      const ramMB = match ? Math.round(parseInt(match[2].replace(/,/g, ''), 10) / 1024) : null;

      return { alive: true, startedAt: null, uptimeSec: null, ramMB };
    } catch {
      return null;
    }
  }

  private async readDaemonFromExporter(): Promise<SideloadlyDaemon | null> {
    if (!HOST_METRICS_URL) return null;
    try {
      const { data } = await axios.get<string>(HOST_METRICS_URL, { timeout: 3000 });

      // Match process metrics — windows_exporter uses the exe name without extension
      // e.g. windows_process_private_bytes{process="sideloadlydaemon",process_id="1234"} 1.23e+08
      const ramMatch = data.match(
        /windows_process_(?:working_set_private_bytes|private_bytes)\{[^}]*process="sideloadlydaemon"[^}]*\}\s+([\d.e+]+)/,
      );
      const startMatch = data.match(
        /windows_process_start_time\{[^}]*process="sideloadlydaemon"[^}]*\}\s+([\d.e+]+)/,
      );

      if (!ramMatch && !startMatch) return null;

      const ramMB     = ramMatch    ? Math.round(parseFloat(ramMatch[1])  / (1024 * 1024)) : null;
      const startedAt = startMatch  ? new Date(parseFloat(startMatch[1]) * 1000).toISOString() : null;
      const uptimeSec = startedAt   ? Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000) : null;
      const alive     = ramMB !== null && ramMB > 0;

      return { alive, startedAt, uptimeSec, ramMB };
    } catch {
      return null;
    }
  }

  private readDaemonFromLog(): SideloadlyDaemon {
    try {
      const stat  = fs.statSync(LOG_PATH);
      const alive = (Date.now() - stat.mtimeMs) < ALIVE_THRESHOLD_MS;

      const startedAt = this.parseStartupFromLog();
      const uptimeSec = startedAt
        ? Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
        : null;

      return { alive, startedAt, uptimeSec, ramMB: null };
    } catch {
      return this.EMPTY_DAEMON;
    }
  }

  private parseStartupFromLog(): string | null {
    try {
      const stat = fs.statSync(LOG_PATH);
      const size = stat.size;
      if (size === 0) return null;

      const readSize = Math.min(LOG_TAIL_BYTES, size);
      const buf      = Buffer.allocUnsafe(readSize);
      const fd       = fs.openSync(LOG_PATH, 'r');
      fs.readSync(fd, buf, 0, readSize, size - readSize);
      fs.closeSync(fd);

      const text  = buf.toString('utf8');
      const lines = text.split('\n');

      // Find the last "Loading X.XX" line — emitted at daemon startup
      for (let i = lines.length - 1; i >= 0; i--) {
        const m = lines[i].match(/^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}:\d{2}:\d{2}) Loading /);
        if (m) {
          return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}`).toISOString();
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  private readAccounts(): SideloadlyAccount[] {
    const raw = fs.readFileSync(APPIDS_PATH, 'utf8');
    const data = JSON.parse(raw);
    return Object.entries(data)
      .filter(([key]) => key.includes('@'))
      .map(([appleId, d]: [string, any]) => ({
        appleId,
        remaining:     d.Remaining  ?? 0,
        nearestTtl:    d.NearestTtl ?? '',
        nextRenewalMs: d.NearestTtl ? new Date(d.NearestTtl).getTime() - Date.now() : 0,
      }));
  }

  private readDb(): { devices: SideloadlyDevice[]; apps: SideloadlyApp[] } {
    const db = new Database(DB_PATH, { readonly: true });

    try {
      const devRows = db.prepare(`
        SELECT udid, name,
               last_seen        AS lastSeen,
               last_error       AS lastError,
               failures_count   AS failuresCount
        FROM   devices
      `).all() as any[];

      const devices: SideloadlyDevice[] = devRows.map(r => ({
        udid:          r.udid,
        name:          r.name || r.udid,
        lastSeen:      r.lastSeen  || null,
        lastError:     r.lastError || '',
        failuresCount: r.failuresCount || 0,
      }));

      const appRows = db.prepare(`
        SELECT i.id,
               i.name,
               i.final_bundle_id  AS bundleId,
               i.version,
               i.device_udid      AS deviceUdid,
               d.name             AS deviceName,
               i.apple_id         AS appleId,
               i.created_at       AS installedAt,
               i.last_updated     AS lastRenewedAt,
               i.known_ttl        AS knownTtl,
               i.last_error       AS lastError,
               i.failures_count   AS failuresCount,
               i.last_failure_at  AS lastFailureAt
        FROM   installations i
        LEFT JOIN devices d ON d.udid = i.device_udid
        WHERE  i.deleted_at IS NULL
          AND  i.one_off    = 0
        ORDER  BY i.last_updated DESC
      `).all() as any[];

      const now = Date.now();

      const apps: SideloadlyApp[] = appRows.map(r => {
        const lastRenewed  = new Date(r.lastRenewedAt);
        const ttlMs        = ((r.knownTtl as number) || 7) * 24 * 3600 * 1000;
        const nextRenewal  = new Date(lastRenewed.getTime() + ttlMs);
        const expiresInMs  = nextRenewal.getTime() - now;
        const status: SideloadlyApp['status'] =
          expiresInMs < 0                    ? 'expired'  :
          expiresInMs < EXPIRING_THRESHOLD_MS ? 'expiring' : 'ok';

        return {
          id:            r.id,
          name:          r.name        || 'Unknown',
          bundleId:      r.bundleId    || '',
          version:       r.version     || '',
          deviceUdid:    r.deviceUdid  || '',
          deviceName:    r.deviceName  || 'Unknown',
          appleId:       r.appleId     || '',
          installedAt:   r.installedAt    || '',
          lastRenewedAt: r.lastRenewedAt  || '',
          nextRenewalAt: nextRenewal.toISOString(),
          expiresInMs,
          status,
          lastError:     r.lastError     || null,
          failuresCount: r.failuresCount || 0,
          lastFailureAt: r.lastFailureAt || null,
        };
      });

      const visibleApps = apps.filter(a => a.expiresInMs > -EXPIRED_HIDE_THRESHOLD_MS);
      return { devices, apps: visibleApps };
    } finally {
      db.close();
    }
  }

  getStatus(): SideloadlyStatus {
    return this.currentStatus;
  }
}
