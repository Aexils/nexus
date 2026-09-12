import {
  ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { forkJoin } from 'rxjs';
import {
  LucideAngularModule, AlertTriangle, ArrowRight, CheckCircle2, Flame, Fuel, Pause,
  Play, RefreshCw, Timer, TrendingDown,
} from 'lucide-angular';
import {
  VolkorneEnclosState, VolkorneTrend, VolkorneYieldReport,
} from '@nexus/shared-types';
import { VolkorneService } from './volkorne.service';

/** Plafond de remplissage du Gigantesque Extrait : la jauge ne va pas au-delà. */
const FILL_CAP = 40000;
/** Points de jauge par extrait. Affiché à l'écran : « ajouter » doit être un geste dont
 *  on voit l'effet, pas un bouton dont on devine le résultat. */
const POINTS_PER_EXTRACT = 5000;
/** Seuil d'alerte du backend : sous 2 h de jauge, il faut agir. */
const SOON_MS = 2 * 3600_000;
const PRICE_KEY = 'volkorne.gaPaPrice';

interface TrendView { label: string; tone: 'good' | 'bad' | 'neutral'; detail: string; }

/** L'instruction affichée en tête de carte : QUOI FAIRE, maintenant. */
interface NextAction { verb: string; detail: string; tone: 'bad' | 'warn' | 'good' | 'idle'; }

interface Curve { w: number; h: number; line: string; area: string; ref: number; }

@Component({
  selector: 'app-volkorne-page',
  standalone: true,
  imports: [LucideAngularModule, DecimalPipe],
  templateUrl: './volkorne-page.html',
  styleUrl: './volkorne-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VolkornePage implements OnInit, OnDestroy {
  private readonly api = inject(VolkorneService);

  readonly RefreshCw = RefreshCw;
  readonly Fuel = Fuel;
  readonly Flame = Flame;
  readonly AlertTriangle = AlertTriangle;
  readonly CheckCircle2 = CheckCircle2;
  readonly TrendingDown = TrendingDown;
  readonly Pause = Pause;
  readonly Play = Play;
  readonly Timer = Timer;
  readonly ArrowRight = ArrowRight;

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly busy = signal<number | null>(null);
  readonly states = signal<VolkorneEnclosState[]>([]);
  readonly report = signal<VolkorneYieldReport | null>(null);

  readonly POINTS_PER_EXTRACT = POINTS_PER_EXTRACT;

  /** Prix de vente d'une Ga PA, saisi par l'utilisateur et conservé localement.
   *  Sans lui, aucun bénéfice n'est affiché — on n'invente pas un prix de marché. */
  readonly gaPaPrice = signal<number | null>(
    Number(localStorage.getItem(PRICE_KEY)) || null);

  /**
   * Horloge locale, rafraîchie chaque seconde. Les échéances viennent du backend sous
   * forme d'INSTANTS absolus, jamais de durées : une durée calculée côté serveur serait
   * déjà fausse à l'affichage. On les convertit ici, en continu, pour que les comptes à
   * rebours défilent vraiment au lieu de figer une valeur périmée.
   */
  private readonly tick = signal(Date.now());
  private timer?: ReturnType<typeof setInterval>;

  /** Rechargement complet : les prédictions dérivent si on laisse la page ouverte. */
  private refresh?: ReturnType<typeof setInterval>;

  ngOnInit(): void {
    this.load();
    this.timer = setInterval(() => this.tick.set(Date.now()), 1000);
    this.refresh = setInterval(() => this.load(true), 60_000);
  }

  ngOnDestroy(): void {
    clearInterval(this.timer);
    clearInterval(this.refresh);
  }

  load(silent = false): void {
    if (!silent) this.loading.set(true);
    this.api.enclos().subscribe({
      next: list => {
        if (!list.length) {
          this.states.set([]);
          this.loading.set(false);
          this.loadReport();
          return;
        }
        forkJoin(list.map(e => this.api.state(e.id))).subscribe({
          next: states => {
            this.states.set(states);
            this.error.set(null);
            this.loading.set(false);
            this.loadReport();
          },
          error: () => this.fail(),
        });
      },
      error: () => this.fail(),
    });
  }

  private loadReport(): void {
    this.api.yieldReport(this.gaPaPrice() ?? undefined)
      .subscribe({ next: r => this.report.set(r), error: () => void 0 });
  }

  setPrice(raw: string): void {
    const v = Number(raw);
    if (!v || v <= 0) {
      localStorage.removeItem(PRICE_KEY);
      this.gaPaPrice.set(null);
    } else {
      localStorage.setItem(PRICE_KEY, String(v));
      this.gaPaPrice.set(v);
    }
    this.loadReport();
  }

  private fail(): void {
    this.error.set('Volkorne est injoignable.');
    this.loading.set(false);
  }

  // ── Actions (les mêmes que les boutons des notifications ntfy) ──────────────

  refillToMax(s: VolkorneEnclosState): void {
    this.busy.set(s.id);
    this.api.refillToMax(s.id).subscribe({
      next: () => { this.busy.set(null); this.load(true); },
      error: () => { this.busy.set(null); this.error.set('Le remplissage a échoué.'); },
    });
  }

  refill(s: VolkorneEnclosState, extracts: number): void {
    this.busy.set(s.id);
    this.api.refill(s.id, extracts).subscribe({
      next: () => { this.busy.set(null); this.load(true); },
      error: () => { this.busy.set(null); this.error.set('Le remplissage a échoué.'); },
    });
  }

  togglePause(s: VolkorneEnclosState): void {
    this.busy.set(s.id);
    this.api.pause(s.id, s.gauge_active).subscribe({
      next: () => { this.busy.set(null); this.load(true); },
      error: () => { this.busy.set(null); this.error.set('La mise en pause a échoué.'); },
    });
  }

  // ── Quoi faire maintenant ──────────────────────────────────────────────────

  /**
   * L'information principale de la page. Un tableau de bord qui affiche des chiffres
   * laisse l'utilisateur faire la synthèse lui-même ; ici on la fait pour lui, parce
   * que la page est consultée en jouant, d'une main, entre deux combats.
   *
   * L'ordre des cas est une priorité, pas une suite de tests indépendants : une jauge
   * vide passe avant un enclos incomplet, parce qu'on ne peut pas tout faire à la fois.
   */
  nextAction(s: VolkorneEnclosState): NextAction {
    if (!s.gauge_active) {
      return { verb: 'En pause', detail: 'La production est arrêtée, rien ne se consomme.', tone: 'idle' };
    }
    if (s.all_ready) {
      return {
        verb: 'Sors tes montures',
        detail: `${s.mounts.length} au niveau 100 — au-delà, la mangeoire continue jusqu'à 200 et le carburant est perdu.`,
        tone: 'good',
      };
    }
    if (!s.mount_count) {
      return { verb: 'Ajoute des montures', detail: "L'enclos est vide.", tone: 'idle' };
    }
    if (s.consumes && s.gauge_value <= 0) {
      return {
        verb: `Ajoute ${s.extracts_to_finish || 8} extrait(s)`,
        detail: 'Jauge à sec : la production est à l\'arrêt, chaque minute est perdue.',
        tone: 'bad',
      };
    }
    if (s.is_underfilled) {
      return {
        verb: `Complète l'enclos (${s.capacity - s.mount_count} place(s))`,
        detail: 'Le carburant coûte pareil pour 1 monture que pour 10.',
        tone: 'warn',
      };
    }
    if (s.consumes && s.empty_at && new Date(s.empty_at).getTime() - this.tick() < SOON_MS) {
      return {
        verb: 'Prépare des extraits',
        detail: `La jauge tombe à sec dans ${this.until(s.empty_at)}.`,
        tone: 'warn',
      };
    }
    if (!s.consumes) {
      return { verb: 'Rien à faire', detail: 'Aucune monture n\'a besoin de l\'effet.', tone: 'idle' };
    }
    return {
      verb: 'Rien à faire',
      detail: s.finishes_at
        ? `Fournée terminée dans ${this.until(s.finishes_at)}.`
        : 'La production tourne.',
      tone: 'idle',
    };
  }

  /** Extraits nécessaires pour remplir jusqu'au plafond du carburant. */
  toFill(s: VolkorneEnclosState): number {
    return Math.max(0, Math.ceil((FILL_CAP - s.gauge_value) / POINTS_PER_EXTRACT));
  }

  // ── Affichage ──────────────────────────────────────────────────────────────

  /** Pourcentage de la jauge RAPPORTÉ AU PLAFOND DU CARBURANT, pas au max de la jauge.
   *  La jauge monte à 100 000 mais l'extrait plafonne à 40 000 : afficher 40 % pour une
   *  jauge pleine ferait croire à un manque permanent. */
  fillPct(s: VolkorneEnclosState): number {
    return Math.max(0, Math.min(100, (s.gauge_value / FILL_CAP) * 100));
  }

  /** Durée restante jusqu'à un instant ISO, recalculée à chaque tick. */
  until(iso: string | null): string {
    if (!iso) return '—';
    const ms = new Date(iso).getTime() - this.tick();
    if (ms <= 0) return 'maintenant';
    const total = Math.floor(ms / 1000);
    const d = Math.floor(total / 86400);
    const h = Math.floor((total % 86400) / 3600);
    const m = Math.floor((total % 3600) / 60);
    const sec = total % 60;
    if (d > 0) return `${d} j ${h} h`;
    if (h > 0) return `${h} h ${String(m).padStart(2, '0')}`;
    if (m > 0) return `${m} min ${String(sec).padStart(2, '0')}`;
    return `${sec} s`;
  }

  /** Urgence de la jauge : moins de 2 h, c'est le seuil d'alerte du backend. */
  gaugeTone(s: VolkorneEnclosState): 'bad' | 'warn' | 'ok' {
    if (!s.consumes) return 'ok';
    if (s.gauge_value <= 0) return 'bad';
    if (!s.empty_at) return 'ok';
    const ms = new Date(s.empty_at).getTime() - this.tick();
    return ms < 2 * 3600_000 ? 'warn' : 'ok';
  }

  mountPct(m: { xp: number; xp_remaining: number }): number {
    const total = m.xp + m.xp_remaining;
    return total > 0 ? Math.min(100, (m.xp / total) * 100) : 100;
  }

  readonly readyCount = computed(() =>
    this.states().reduce((n, s) => n + s.mounts.filter(m => m.is_done).length, 0));

  readonly trendView = computed<TrendView | null>(() => {
    const r = this.report();
    if (!r) return null;
    const rate = r.mean_ga_pa_per_mount;
    const detail = rate === null
      ? 'aucune fournée brisée'
      : `${rate.toFixed(3)} Ga PA/monture (théorique ${r.theoretical})`;
    const map: Record<VolkorneTrend, TrendView> = {
      // On n'annonce PAS de tendance sous trois fournées : le brisage est aléatoire et
      // deux points ne disent rien. Le backend applique la même règle.
      insufficient_data: { label: 'Pas assez de fournées', tone: 'neutral', detail },
      declining: { label: 'Rendement en baisse', tone: 'bad', detail },
      stable: { label: 'Rendement stable', tone: 'neutral', detail },
      improving: { label: 'Rendement en hausse', tone: 'good', detail },
    };
    return map[r.trend];
  });

  /** Courbe du taux mesuré, avec le taux théorique en ligne de repère. */
  readonly curve = computed<Curve | null>(() => {
    const r = this.report();
    if (!r) return null;
    const pts = r.batches
      .map(b => b.ga_pa_per_mount)
      .filter((v): v is number => v !== null);
    if (pts.length < 2) return null;

    const w = 320, h = 90, pad = 6;
    const lo = Math.min(...pts, r.theoretical) * 0.92;
    const hi = Math.max(...pts, r.theoretical) * 1.08;
    const x = (i: number) => pad + (i * (w - 2 * pad)) / (pts.length - 1);
    const y = (v: number) => h - pad - ((v - lo) / (hi - lo || 1)) * (h - 2 * pad);

    const line = pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    return {
      w, h, line,
      area: `${line} L${x(pts.length - 1).toFixed(1)},${h} L${x(0).toFixed(1)},${h} Z`,
      ref: y(r.theoretical),
    };
  });

  kamas(v: number | null): string {
    if (v === null) return '—';
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)} M`;
    if (v >= 1000) return `${Math.round(v / 1000)} k`;
    return String(Math.round(v));
  }
}
