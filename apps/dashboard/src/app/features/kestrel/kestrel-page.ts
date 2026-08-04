import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { forkJoin } from 'rxjs';
import {
  LucideAngularModule, RefreshCw, Trash2, ExternalLink, Bell, Info, Plus,
} from 'lucide-angular';
import {
  KestrelAlert, KestrelObservation, KestrelSource, KestrelTarget,
} from '@nexus/shared-types';
import { KestrelService } from './kestrel.service';
import { KestrelLogo } from './kestrel-logo';
import { KestrelNewTarget } from './kestrel-new-target';

// ── View-models ──────────────────────────────────────────────────────────────
interface Chart {
  w: number; h: number; line: string; area: string;
  endX: number; endY: number; down: boolean;
}
interface ProviderPill { name: string; on: boolean; tier: 'trusted' | 'best' | 'off'; }
interface VariantPill { label: string; price: number; best: boolean; }
interface Card {
  target: KestrelTarget;
  icon: string;
  chips: string[];
  best: KestrelObservation | null;
  allIn: boolean;
  basis: string;
  providers: ProviderPill[];
  variants: VariantPill[];
  chart: Chart | null;
}

const TWO_HOURS = 2 * 3600 * 1000;
const BEST_EFFORT = new Set(['skyscanner']);

@Component({
  selector: 'app-kestrel-page',
  standalone: true,
  imports: [LucideAngularModule, KestrelLogo, KestrelNewTarget],
  templateUrl: './kestrel-page.html',
  styleUrl: './kestrel-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class KestrelPage implements OnInit {
  private readonly api = inject(KestrelService);

  readonly RefreshCw = RefreshCw;
  readonly Trash2 = Trash2;
  readonly ExternalLink = ExternalLink;
  readonly Bell = Bell;
  readonly Info = Info;
  readonly Plus = Plus;

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly collecting = signal<number | null>(null);
  readonly showNew = signal(false);

  readonly sources = signal<KestrelSource[]>([]);
  private readonly targets = signal<KestrelTarget[]>([]);
  private readonly obs = signal<Record<number, KestrelObservation[]>>({});
  readonly alerts = signal<KestrelAlert[]>([]);

  readonly cards = computed<Card[]>(() =>
    this.targets().map(t => this.buildCard(t, this.obs()[t.id] ?? [])),
  );

  readonly kpi = computed(() => {
    const cards = this.cards();
    const active = this.targets().filter(t => t.active).length;
    const best = cards
      .map(c => c.best?.price)
      .filter((p): p is number => typeof p === 'number');
    return {
      targets: this.targets().length,
      active,
      alerts7d: this.alerts().filter(a => Date.now() - Date.parse(a.notified_at) < 7 * 864e5).length,
      best: best.length ? Math.min(...best) : null,
    };
  });

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    this.loading.set(true);
    this.error.set(null);
    forkJoin({
      sources: this.api.sources(),
      targets: this.api.targets(),
      alerts: this.api.alerts(50),
    }).subscribe({
      next: ({ sources, targets, alerts }) => {
        this.sources.set(sources);
        this.targets.set(targets);
        this.alerts.set(alerts);
        this.loading.set(false);
        targets.forEach(t => this.loadObs(t.id));
      },
      error: () => {
        this.error.set("Kestrel injoignable — le service tourne-t-il sur :8000 ? (uv run uvicorn kestrel.main:app)");
        this.loading.set(false);
      },
    });
  }

  private loadObs(targetId: number): void {
    this.api.observations(targetId, 500).subscribe(list => {
      this.obs.update(m => ({ ...m, [targetId]: list }));
    });
  }

  collect(targetId: number): void {
    if (this.collecting()) return;
    this.collecting.set(targetId);
    this.api.collect(targetId).subscribe({
      next: () => { this.loadObs(targetId); this.api.alerts(50).subscribe(a => this.alerts.set(a)); this.collecting.set(null); },
      error: () => this.collecting.set(null),
    });
  }

  remove(targetId: number): void {
    this.api.deleteTarget(targetId).subscribe(() => {
      this.targets.update(list => list.filter(t => t.id !== targetId));
    });
  }

  onCreated(): void {
    this.showNew.set(false);
    this.reload();
  }

  targetLabel(id: number): string {
    return this.targets().find(t => t.id === id)?.label ?? `#${id}`;
  }

  money(n: number): string {
    return Math.round(n).toLocaleString('fr-CA');
  }

  ago(iso: string): string {
    const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
    if (s < 60) return "à l'instant";
    if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
    if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
    return `il y a ${Math.floor(s / 86400)} j`;
  }

  // ── Construction d'un card ─────────────────────────────────────────────────
  private buildCard(t: KestrelTarget, observations: KestrelObservation[]): Card {
    const source = this.sources().find(s => s.id === t.source);
    const sorted = [...observations].sort((a, b) => Date.parse(b.observed_at) - Date.parse(a.observed_at));
    const top = sorted.length ? Date.parse(sorted[0].observed_at) : 0;
    const batch = sorted.filter(o => top - Date.parse(o.observed_at) < TWO_HOURS);

    const best = this.pickBest(batch);

    // Providers : présents dans le dernier lot + ceux déclarés par la source (off).
    const seen = new Map<string, KestrelObservation>();
    for (const o of batch) if (!seen.has(o.provider)) seen.set(o.provider, o);
    const declared = source?.providers ?? [...seen.keys()];
    const providers: ProviderPill[] = declared.map(name => {
      const o = seen.get(name);
      const on = !!o;
      const tier: ProviderPill['tier'] = !o ? 'off' : (o.trusted && !BEST_EFFORT.has(name) ? 'trusted' : 'best');
      return { name, on, tier };
    });

    // Variantes du dernier lot (min prix par variante).
    const byVariant = new Map<string, number>();
    for (const o of batch) {
      const key = o.variant ?? 'oneway';
      byVariant.set(key, Math.min(byVariant.get(key) ?? Infinity, o.price));
    }
    const variants: VariantPill[] = [...byVariant.entries()]
      .map(([key, price]) => ({ label: this.variantLabel(key), price, best: best ? Math.abs(price - best.price) < 0.5 : false }))
      .sort((a, b) => a.price - b.price)
      .slice(0, 4);

    return {
      target: t,
      icon: this.iconFor(t.source),
      chips: this.chipsFor(t),
      best,
      allIn: best?.all_in ?? true,
      basis: (best?.raw?.['price_basis'] as string) ?? '',
      providers,
      variants,
      chart: this.buildChart(sorted, best?.variant ?? null),
    };
  }

  private pickBest(batch: KestrelObservation[]): KestrelObservation | null {
    const valid = batch.filter(o => o.price > 0);
    const trusted = valid.filter(o => o.trusted);
    const pool = trusted.filter(o => o.all_in).length ? trusted.filter(o => o.all_in) : trusted;
    const src = pool.length ? pool : valid;
    return src.length ? src.reduce((a, b) => (b.price < a.price ? b : a)) : null;
  }

  private buildChart(sorted: KestrelObservation[], variant: string | null): Chart | null {
    // Série = meilleur prix fiable par relevé (variante de référence si connue), ordre chrono.
    const rows = sorted
      .filter(o => o.trusted && o.price > 0 && (variant == null || (o.variant ?? 'oneway') === variant))
      .sort((a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at));
    // min par timestamp (arrondi minute) pour dédoublonner les providers
    const map = new Map<number, number>();
    for (const o of rows) {
      const k = Math.round(Date.parse(o.observed_at) / 60000);
      map.set(k, Math.min(map.get(k) ?? Infinity, o.price));
    }
    const series = [...map.entries()].sort((a, b) => a[0] - b[0]).map(e => e[1]);
    if (series.length < 2) return null;

    const W = 520, H = 132, padT = 10, padB = 8, padL = 6, padR = 6;
    const iw = W - padL - padR, ih = H - padT - padB;
    let lo = Math.min(...series), hi = Math.max(...series);
    const span = hi - lo || hi * 0.06 || 1;
    lo -= span * 0.18; hi += span * 0.18;
    const x = (i: number) => padL + (i / (series.length - 1)) * iw;
    const y = (p: number) => padT + (1 - (p - lo) / (hi - lo)) * ih;
    const line = series.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p).toFixed(1)}`).join(' ');
    const area = `${line} L${x(series.length - 1).toFixed(1)} ${(padT + ih).toFixed(1)} L${padL.toFixed(1)} ${(padT + ih).toFixed(1)} Z`;
    return {
      w: W, h: H, line, area,
      endX: x(series.length - 1), endY: y(series[series.length - 1]),
      down: series[series.length - 1] <= series[0],
    };
  }

  private iconFor(source: string): string {
    return { flights: '✈️', products: '📦', events: '🎫' }[source] ?? '🔔';
  }

  private variantLabel(key: string): string {
    if (key === 'oneway') return 'Aller simple';
    // date ISO -> "26 fév"
    const d = new Date(key + 'T00:00:00');
    return isNaN(+d) ? key : `Retour ${d.toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' })}`;
  }

  private chipsFor(t: KestrelTarget): string[] {
    const p = t.params as Record<string, unknown>;
    const chips: string[] = [];
    if (t.source === 'flights') {
      const adults = Number(p['adults'] ?? 1);
      const children = Number(p['children'] ?? 0);
      const pax = adults + children;
      chips.push(`👤 ${pax} pax`);
      chips.push(`💺 ${String(p['cabin_class'] ?? 'economy')}`);
      const bags = Number(p['checked_bags'] ?? 0);
      if (bags > 0) chips.push(`🧳 ${bags} bagage${bags > 1 ? 's' : ''}`);
      const rets = Array.isArray(p['return_dates']) ? (p['return_dates'] as unknown[]).length : 0;
      chips.push(rets ? `🔁 ${rets} retour${rets > 1 ? 's' : ''}` : '➡️ aller simple');
    } else {
      chips.push(t.source);
    }
    chips.push(`⏱ ${Math.round(t.interval_minutes / 60)} h`);
    return chips;
  }
}
