import { Component, ChangeDetectionStrategy, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NexusService } from '../../core/services/nexus.service';
import {
  SideloopAppStatus, SideloopDeviceStatus, SideloopAppState, PROFILE_TTL_SEC,
} from '@nexus/shared-types';

@Component({
  selector: 'app-sideloop-page',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './sideloop-page.html',
  styleUrl: './sideloop-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SideloopPage {
  readonly nexus = inject(NexusService);
  readonly status = this.nexus.sideloop;

  readonly reachable = computed(() => this.status()?.reachable ?? false);
  readonly apps      = computed(() => this.status()?.apps ?? []);
  readonly devices   = computed(() => this.status()?.devices ?? []);
  readonly alerts    = computed(() => this.status()?.alerts ?? []);
  readonly runs      = computed(() => [...(this.status()?.recent_runs ?? [])].reverse());

  // ── Formatters ────────────────────────────────────────────────────────────

  /** "5 j 3 h" / "22 h" / "18 min" / "expiré". */
  countdown(sec: number | null): string {
    if (sec === null) return '—';
    if (sec <= 0) return 'expiré';
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (d > 0) return `${d} j ${h} h`;
    if (h > 0) return `${h} h`;
    return `${m} min`;
  }

  /** % de fenêtre de 7 j RESTANTE (pour la barre). */
  lifePct(sec: number | null): number {
    if (sec === null) return 0;
    return Math.max(0, Math.min(100, (sec / PROFILE_TTL_SEC) * 100));
  }

  stateClass(s: SideloopAppState): string {
    return s === 'ok' ? 'ok' : s === 'expiring' ? 'warn' : 'crit'; // expired/never = crit
  }
  stateLabel(s: SideloopAppState): string {
    return s === 'ok' ? 'OK' : s === 'expiring' ? 'EXPIRE BIENTÔT'
         : s === 'expired' ? 'EXPIRÉE' : 'JAMAIS SIGNÉE';
  }
  barClass(sec: number | null): string {
    if (sec === null || sec <= 0) return 'crit';
    return sec <= 48 * 3600 ? 'warn' : 'ok';
  }

  /** Pastille d'install par device : ok / échec / jamais. */
  installClass(d: SideloopDeviceStatus): string {
    return d.last_ok === true ? 'ok' : d.last_ok === false ? 'crit' : 'idle';
  }
  shortUdid(udid: string): string {
    return udid.length > 14 ? udid.slice(0, 8) + '…' + udid.slice(-4) : udid;
  }
  /** Nom lisible de l'appareil (DeviceName iOS), sinon UDID court. */
  deviceLabel(d: SideloopDeviceStatus): string {
    return d.name || this.shortUdid(d.udid);
  }

  /** État d'install d'un device DONNÉ pour une app (null si jamais tenté). */
  installOf(app: SideloopAppStatus, udid: string): SideloopDeviceStatus | null {
    return app.installs.find(i => i.udid === udid) ?? null;
  }
  /** Pastille : installée (ok) / échec (crit) / pas installée (idle). */
  appDeviceClass(inst: SideloopDeviceStatus | null): string {
    return inst?.last_ok === true ? 'ok' : inst?.last_ok === false ? 'crit' : 'idle';
  }
  /** Libellé d'état par device dans une app. */
  appDeviceState(inst: SideloopDeviceStatus | null): string {
    if (!inst || inst.last_ok === null) return 'pas installée';
    if (inst.last_ok === false) return 'échec install';
    return `installée ${this.fmtTime(inst.last_install_at)}`;
  }

  fmtTime(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    const now = Date.now();
    const diff = Math.floor((now - d.getTime()) / 1000);
    if (diff < 60) return 'à l’instant';
    if (diff < 3600) return `il y a ${Math.floor(diff / 60)} min`;
    if (diff < 86400) return `il y a ${Math.floor(diff / 3600)} h`;
    return `il y a ${Math.floor(diff / 86400)} j`;
  }

  runOk(ok: boolean): string { return ok ? 'ok' : 'crit'; }
  appById(app: SideloopAppStatus): string { return app.bundle_id; }
}
