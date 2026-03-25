import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import axios, { AxiosInstance } from 'axios';
import {
  UrbackupStatus,
  UrbackupClient,
  UrbackupActivity,
  UrbackupProgress,
} from '@nexus/shared-types';
import { NexusGateway } from '../gateway/nexus.gateway';

const URBACKUP_URL  = process.env['URBACKUP_URL']  ?? 'http://localhost:55414';
const URBACKUP_USER = process.env['URBACKUP_USER'] ?? 'admin';
const URBACKUP_PASS = process.env['URBACKUP_PASS'] ?? 'admin';

@Injectable()
export class UrbackupService implements OnModuleInit {
  private readonly logger = new Logger(UrbackupService.name);
  private readonly http: AxiosInstance;

  private session = '';
  private loginPromise: Promise<boolean> | null = null;
  private currentStatus: UrbackupStatus = {
    connected: false,
    serverVersion: '',
    clients: [],
    recentActivities: [],
    activeProgress: [],
  };

  constructor(private readonly gateway: NexusGateway) {
    this.http = axios.create({
      baseURL: URBACKUP_URL,
      timeout: 8000,
    });
  }

  async onModuleInit(): Promise<void> {
    const status = await this.fetchStatus();
    this.currentStatus = status;
    this.gateway.emitUrbackupStatus(status);

    if (status.connected) {
      this.logger.log(`UrBackup: ${status.clients.length} client(s) — v${status.serverVersion}`);
      this.gateway.addLog('ok', 'urbackup',
        `UrBackup connecté — ${status.clients.length} client(s), v${status.serverVersion}`,
      );
    } else {
      this.logger.warn(`UrBackup inaccessible (${URBACKUP_URL})`);
      this.gateway.addLog('warn', 'urbackup', `UrBackup inaccessible — ${URBACKUP_URL}`);
    }
  }

  @Interval(30_000)
  async poll(): Promise<void> {
    const next = await this.fetchStatus();
    this.detectChanges(next);
    this.currentStatus = next;
    this.gateway.emitUrbackupStatus(next);
  }

  // ── Change detection ──────────────────────────────────────────────────────

  private detectChanges(next: UrbackupStatus): void {
    const prev = this.currentStatus;

    if (!prev.connected && next.connected) {
      this.gateway.addLog('ok', 'urbackup', 'UrBackup reconnecté');
    }
    if (prev.connected && !next.connected) {
      this.gateway.addLog('warn', 'urbackup', 'UrBackup inaccessible');
    }
    if (!next.connected) return;

    // ── Backup start / end ────────────────────────────────────────────────

    // Backup started (new entry in activeProgress)
    const prevProgressIds = new Set(prev.activeProgress.map(p => p.clientId));
    for (const p of next.activeProgress) {
      if (!prevProgressIds.has(p.clientId)) {
        const action = p.action === 0 || p.action === 2
          ? (p.action === 0 ? 'image complète' : 'image incrémentale')
          : (p.action === 1 ? 'fichiers complets' : 'fichiers incrémentaux');
        this.gateway.addLog('info', 'urbackup',
          `Backup démarré — ${p.clientName} (${action})${p.details ? ` · ${p.details}` : ''}`,
        );
      }
    }

    // Backup completed — new entries in recentActivities
    const prevActIds = new Set(prev.recentActivities.map(a => a.id));
    for (const act of next.recentActivities) {
      if (!prevActIds.has(act.id)) {
        const type = act.isImage
          ? (act.isIncremental ? 'image incrémentale' : 'image complète')
          : (act.isIncremental ? 'fichiers incrémentaux' : 'fichiers complets');
        this.gateway.addLog('ok', 'urbackup',
          `Backup OK — ${act.clientName} · ${type} · ${act.sizeGB.toFixed(1)} GB · ${this.formatDuration(act.duration)}`,
        );
      }
    }

    // ── Client health changes (file_ok / image_ok) ────────────────────────
    for (const client of next.clients) {
      const prevClient = prev.clients.find(c => c.id === client.id);
      if (!prevClient) continue;

      // Client came online / went offline
      if (!prevClient.online && client.online) {
        this.gateway.addLog('info', 'urbackup', `Client en ligne : ${client.name}`);
      }
      if (prevClient.online && !client.online) {
        this.gateway.addLog('warn', 'urbackup', `Client hors ligne : ${client.name}`);
      }

      // Image backup went from ok → failed
      if (prevClient.imageOk && !client.imageOk && client.lastImageBackup) {
        this.gateway.addLog('error', 'urbackup',
          `Backup image échoué — ${client.name} (dernier succès : ${this.formatTs(client.lastImageBackup)})`,
        );
      }
      // Image backup recovered
      if (!prevClient.imageOk && client.imageOk) {
        this.gateway.addLog('ok', 'urbackup', `Backup image rétabli — ${client.name}`);
      }

      // File backup went from ok → failed
      if (prevClient.fileOk && !client.fileOk && client.lastFileBackup) {
        this.gateway.addLog('error', 'urbackup',
          `Backup fichiers échoué — ${client.name} (dernier succès : ${this.formatTs(client.lastFileBackup)})`,
        );
      }
      // File backup recovered
      if (!prevClient.fileOk && client.fileOk) {
        this.gateway.addLog('ok', 'urbackup', `Backup fichiers rétabli — ${client.name}`);
      }

      // First backup ever (no previous backup, now has one)
      if (!prevClient.lastImageBackup && client.lastImageBackup) {
        this.gateway.addLog('ok', 'urbackup', `Premier backup image — ${client.name}`);
      }
      if (!prevClient.lastFileBackup && client.lastFileBackup) {
        this.gateway.addLog('ok', 'urbackup', `Premier backup fichiers — ${client.name}`);
      }
    }

    // New client discovered
    const prevClientIds = new Set(prev.clients.map(c => c.id));
    for (const client of next.clients) {
      if (!prevClientIds.has(client.id)) {
        this.gateway.addLog('info', 'urbackup', `Nouveau client enregistré : ${client.name}`);
      }
    }
  }

  // ── Auth ─────────────────────────────────────────────────────────────────

  /** Serialise les tentatives de login pour éviter la race condition. */
  private ensureSession(): Promise<boolean> {
    if (this.session) return Promise.resolve(true);
    if (!this.loginPromise) {
      this.loginPromise = this.doLogin().finally(() => { this.loginPromise = null; });
    }
    return this.loginPromise;
  }

  private async doLogin(): Promise<boolean> {
    try {
      const params = new URLSearchParams({
        username: URBACKUP_USER,
        password: URBACKUP_PASS,
        plainpw:  '1',
      });
      const res = await this.http.post('/x?a=login', params.toString(), {
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      if (res.data?.success === true && res.data?.session) {
        this.session = res.data.session;
        this.logger.debug(`UrBackup session: ${this.session.slice(0, 8)}…`);
        return true;
      }
      this.logger.warn(`UrBackup login échoué: ${JSON.stringify(res.data)}`);
      return false;
    } catch (err: any) {
      this.logger.warn(`UrBackup login erreur: ${err?.message ?? err}`);
      return false;
    }
  }

  // ── API helpers ───────────────────────────────────────────────────────────

  private async apiPost<T>(action: string): Promise<T | null> {
    if (!(await this.ensureSession())) return null;

    try {
      const res = await this.http.post<T>(`/x?a=${action}`, `ses=${this.session}`, {
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      });
      // UrBackup returns 200 even on session expiry — detect by missing expected fields
      if ((res.data as any)?.error === 1) {
        // Session expired — invalidate and retry once
        this.session = '';
        if (!(await this.ensureSession())) return null;
        const res2 = await this.http.post<T>(`/x?a=${action}`, `ses=${this.session}`, {
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
        });
        return res2.data;
      }
      return res.data;
    } catch (err: any) {
      this.logger.warn(`UrBackup ?a=${action} erreur: ${err?.message ?? err}`);
      return null;
    }
  }

  // ── Data fetching ─────────────────────────────────────────────────────────

  private async fetchStatus(): Promise<UrbackupStatus> {
    const EMPTY: UrbackupStatus = {
      connected: false,
      serverVersion: '',
      clients: [],
      recentActivities: [],
      activeProgress: [],
    };

    // S'assurer d'avoir une session avant les appels parallèles
    if (!(await this.ensureSession())) return EMPTY;

    const [statusData, progressData, usageData] = await Promise.all([
      this.apiPost<any>('status'),
      this.apiPost<any>('progress'),
      this.apiPost<any>('usage'),
    ]);

    if (!statusData?.status) return EMPTY;

    const usageMap = new Map<string, { files: number; images: number }>();
    for (const u of usageData?.usage ?? []) {
      usageMap.set(u.name, { files: u.files ?? 0, images: u.images ?? 0 });
    }

    const clients: UrbackupClient[] = statusData.status.map((s: any) => {
      const usage = usageMap.get(s.name) ?? { files: 0, images: 0 };
      return {
        id:              s.id,
        name:            s.name,
        online:          s.online === true,
        osSimple:        s.os_simple ?? '',
        clientVersion:   s.client_version_string ?? '',
        lastFileBackup:  s.lastbackup  && s.lastbackup  > 0 ? s.lastbackup  : null,
        lastImageBackup: s.lastbackup_image && s.lastbackup_image > 0 ? s.lastbackup_image : null,
        fileOk:          s.file_ok  === true,
        imageOk:         s.image_ok === true,
        filesUsedGB:     usage.files   / 1e9,
        imagesUsedGB:    usage.images  / 1e9,
      };
    });

    const recentActivities: UrbackupActivity[] = (progressData?.lastacts ?? []).map((a: any) => ({
      id:            a.id,
      clientId:      a.clientid,
      clientName:    a.name,
      backupTime:    a.backuptime,
      duration:      a.duration,
      sizeGB:        (a.size_bytes ?? 0) / 1e9,
      details:       a.details ?? '',
      isImage:       a.image === 1,
      isIncremental: a.incremental === 1,
    }));

    const activeProgress: UrbackupProgress[] = (progressData?.progress ?? []).map((p: any) => ({
      clientId:    p.clientid,
      clientName:  p.name ?? '',
      percentDone: p.percent_done ?? 0,
      eta:         p.eta_ms ? Math.floor(p.eta_ms / 1000) : 0,
      details:     p.details ?? '',
      action:      p.action ?? 0,
    }));

    return {
      connected: true,
      serverVersion: statusData.curr_version_str ?? statusData.version ?? statusData.server_version ?? '',
      clients,
      recentActivities,
      activeProgress,
    };
  }

  private formatTs(unixSec: number): string {
    return new Date(unixSec * 1000).toLocaleString('fr-FR', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  }

  private formatDuration(sec: number): string {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return h > 0 ? `${h}h ${m}min` : `${m}min`;
  }

  getStatus(): UrbackupStatus {
    return this.currentStatus;
  }
}
