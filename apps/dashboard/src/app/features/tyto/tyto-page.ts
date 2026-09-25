import {
  Component, ChangeDetectionStrategy, inject, computed, signal, ElementRef, viewChild,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import {
  LucideAngularModule, Ear, Radio, Disc, Power, BellOff, BellRing,
  Clock, AlertTriangle, Waves, Headphones, Square, SlidersHorizontal,
  Trash2, RotateCcw,
} from 'lucide-angular';
import { NexusService } from '../../core/services/nexus.service';
import { PageHeaderComponent } from '../../shared/page-header/page-header';
import {
  TytoMode, TytoModeState, TytoSettings, TYTO_SETTINGS_BOUNDS,
} from '@nexus/shared-types';

@Component({
  selector: 'app-tyto-page',
  standalone: true,
  imports: [LucideAngularModule, PageHeaderComponent],
  templateUrl: './tyto-page.html',
  styleUrl: './tyto-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TytoPage {
  private readonly http = inject(HttpClient);
  readonly nexus = inject(NexusService);

  readonly icons = {
    Ear, Radio, Disc, Power, BellOff, BellRing, Clock, AlertTriangle,
    Waves, Headphones, Square, SlidersHorizontal, Trash2, RotateCcw,
  };

  /** Ordre d'affichage : le seuil d'abord, c'est celui qu'on tâtonne. */
  readonly SETTING_KEYS: (keyof TytoSettings)[] =
    ['deltaDb', 'micGain', 'hangoverS', 'maxEventS', 'prerollS'];
  readonly bounds = TYTO_SETTINGS_BOUNDS;

  readonly confirmPurge = signal(false);

  readonly status = this.nexus.tyto;
  readonly busy = signal(false);
  readonly listening = signal(false);
  readonly liveError = signal<string | null>(null);

  private readonly liveEl = viewChild<ElementRef<HTMLAudioElement>>('live');

  /** Durées proposées pour un désarmement temporaire (réarmement automatique). */
  readonly SNOOZE_HOURS = [2, 8, 24];

  readonly mode = computed<TytoMode>(() => this.status()?.mode ?? 'armed');
  readonly on = computed(() => this.mode() !== 'off');
  readonly notifying = computed(() => this.mode() === 'armed');
  readonly reachable = computed(() => this.status()?.reachable ?? false);
  readonly events = computed(() => this.status()?.recent ?? []);
  readonly settings = computed(() => this.status()?.settings ?? null);
  readonly mixer = computed(() => this.status()?.mixer ?? null);

  /**
   * Aide au réglage : l'écart du déclenchement le plus FAIBLE observé. Descendre
   * le seuil sous cette valeur ne peut qu'ajouter du bruit ; le monter au-dessus
   * fait disparaître ce déclenchement-là. C'est la donnée qui manque quand on
   * choisit un seuil à l'aveugle.
   */
  readonly weakestTrigger = computed(() => {
    const e = this.events();
    if (!e.length) return null;
    return Math.min(...e.map(x => x.peak - x.baseline));
  });

  /** Écart au fond : la seule lecture honnête d'un dBFS non calibré. */
  readonly headroom = computed(() => {
    const s = this.status();
    if (!s || s.lastDb === null || s.baseline === null) return null;
    return s.lastDb - s.baseline;
  });

  readonly untilLabel = computed(() => {
    const u = this.status()?.until;
    if (!u) return null;
    const mins = Math.max(0, Math.round((u - Date.now()) / 60000));
    if (mins < 60) return `réarmement dans ${mins} min`;
    const h = Math.floor(mins / 60);
    return `réarmement dans ${h} h ${String(mins % 60).padStart(2, '0')}`;
  });

  readonly stateLabel = computed(() => {
    const s = this.status();
    if (!s) return 'en attente';
    if (!s.reachable) return 'injoignable';
    switch (s.state) {
      case 'éteint':          return 'éteint';
      case 'warmup':          return 'calibration';
      case 'écoute':          return 'en écoute';
      case 'enregistrement':  return 'enregistre';
      default:                return s.state;
    }
  });

  // ── Commandes ────────────────────────────────────────────────────────────

  /** Interrupteur : éteindre relâche vraiment le micro côté hôte. */
  togglePower(): void {
    if (this.on()) {
      this.stopLive();
      this.setMode('off');
    } else {
      this.setMode('armed');
    }
  }

  toggleNotify(): void {
    this.setMode(this.notifying() ? 'silent' : 'armed');
  }

  setMode(mode: TytoMode, hours?: number): void {
    this.busy.set(true);
    this.http.patch<TytoModeState>('/api/tyto/mode', { mode, hours, source: 'dashboard' })
      .subscribe({
        next: () => this.busy.set(false),
        error: () => this.busy.set(false),
      });
  }

  // ── Réglages ─────────────────────────────────────────────────────────────

  setSetting(key: keyof TytoSettings, value: number | string): void {
    const v = Number(value);
    if (!Number.isFinite(v)) return;
    this.busy.set(true);
    this.http.patch<TytoModeState>('/api/tyto/settings', { [key]: v })
      .subscribe({ next: () => this.busy.set(false), error: () => this.busy.set(false) });
  }

  resetSettings(): void {
    this.busy.set(true);
    this.http.patch<TytoModeState>('/api/tyto/settings', { reset: true })
      .subscribe({ next: () => this.busy.set(false), error: () => this.busy.set(false) });
  }

  // ── Suppression ──────────────────────────────────────────────────────────

  deleteOne(day: string, file: string): void {
    this.busy.set(true);
    this.http.delete(`/api/tyto/audio/${day}/${encodeURIComponent(file)}`)
      .subscribe({ next: () => this.busy.set(false), error: () => this.busy.set(false) });
  }

  /** Deux temps : le premier clic arme, le second exécute. Pas de dialogue natif
      (ils bloquent la page et l'extension de capture). */
  purge(): void {
    if (!this.confirmPurge()) {
      this.confirmPurge.set(true);
      setTimeout(() => this.confirmPurge.set(false), 5000);
      return;
    }
    this.confirmPurge.set(false);
    this.busy.set(true);
    this.http.delete('/api/tyto/recordings')
      .subscribe({ next: () => this.busy.set(false), error: () => this.busy.set(false) });
  }

  // ── Écoute en direct ─────────────────────────────────────────────────────

  toggleLive(): void {
    this.listening() ? this.stopLive() : this.startLive();
  }

  private startLive(): void {
    const el = this.liveEl()?.nativeElement;
    if (!el) return;
    this.liveError.set(null);
    // Paramètre anti-cache : sans lui, le navigateur peut rejouer le flux
    // précédent au lieu d'en ouvrir un nouveau.
    el.src = `/api/tyto/live?t=${Date.now()}`;
    el.play().then(
      () => this.listening.set(true),
      () => {
        this.listening.set(false);
        this.liveError.set("Lecture refusée par le navigateur — clique à nouveau.");
      });
  }

  stopLive(): void {
    const el = this.liveEl()?.nativeElement;
    if (el) { el.pause(); el.removeAttribute('src'); el.load(); }
    this.listening.set(false);
  }

  // ── Divers ───────────────────────────────────────────────────────────────

  audioUrl(day: string, file: string): string {
    return `/api/tyto/audio/${day}/${encodeURIComponent(file)}`;
  }

  fmtTime(ts: number): string {
    return new Date(ts).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' });
  }

  fmtDate(ts: number): string {
    return new Date(ts).toLocaleDateString('fr-CA', { day: '2-digit', month: 'short' });
  }
}
