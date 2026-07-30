import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnInit, Output, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule, X, Plus } from 'lucide-angular';
import { KestrelSource } from '@nexus/shared-types';
import { KestrelService } from './kestrel.service';

type Ctrl = 'text' | 'date' | 'number' | 'stepper' | 'enum' | 'dateArray';
interface Field {
  key: string; title: string; ctrl: Ctrl; group: string;
  enum?: string[]; min?: number; max?: number; required: boolean;
  default?: unknown; description?: string;
}
interface Section { title: string; fields: Field[]; }
interface Domain { id: string; icon: string; label: string; active: boolean; }

// Catalogue des domaines connus (icône + libellé). Ceux non encore enregistrés
// côté API apparaissent en « bientôt ».
const CATALOG: { id: string; icon: string; label: string }[] = [
  { id: 'flights', icon: '✈️', label: 'Vol' },
  { id: 'products', icon: '📦', label: 'Produit' },
  { id: 'events', icon: '🎫', label: 'Événement' },
];
const CABIN: Record<string, string> = {
  economy: 'Économie', premium_economy: 'Premium', business: 'Affaires', first: '1ère',
};

/** Modale « Nouvelle cible » — sélecteur de domaine + formulaire groupé, généré depuis le params_schema. */
@Component({
  selector: 'app-kestrel-new-target',
  standalone: true,
  imports: [FormsModule, LucideAngularModule],
  templateUrl: './kestrel-new-target.html',
  styleUrl: './kestrel-new-target.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class KestrelNewTarget implements OnInit {
  @Input() sources: KestrelSource[] = [];
  @Output() created = new EventEmitter<void>();
  @Output() closed = new EventEmitter<void>();

  private readonly api = inject(KestrelService);
  readonly X = X;
  readonly Plus = Plus;

  sourceId = '';
  label = '';
  currency = 'CAD';
  intervalH = 12;
  fields: Field[] = [];
  values: Record<string, unknown> = {};
  dates: string[] = [];
  newDate = '';
  ruleKind: 'threshold' | 'relative_drop' = 'threshold';
  threshold: number | null = null;
  percent = 15;
  windowDays = 30;
  saving = false;
  err: string | null = null;

  ngOnInit(): void {
    const first = this.domains.find(d => d.active);
    if (first) this.selectSource(first.id);
  }

  get domains(): Domain[] {
    const registered = new Set(this.sources.map(s => s.id));
    const known = CATALOG.map(c => ({ ...c, active: registered.has(c.id) }));
    // sources enregistrées inconnues du catalogue → cartes génériques
    const extra = this.sources
      .filter(s => !CATALOG.some(c => c.id === s.id))
      .map(s => ({ id: s.id, icon: '🔔', label: s.id, active: true }));
    return [...known, ...extra];
  }

  get source(): KestrelSource | undefined {
    return this.sources.find(s => s.id === this.sourceId);
  }

  get sections(): Section[] {
    const order: string[] = [];
    const map = new Map<string, Field[]>();
    for (const f of this.fields) {
      if (!map.has(f.group)) { map.set(f.group, []); order.push(f.group); }
      map.get(f.group)!.push(f);
    }
    return order.map(title => ({ title, fields: map.get(title)! }));
  }

  get arrField(): Field | undefined {
    return this.fields.find(f => f.ctrl === 'dateArray');
  }

  get valid(): boolean {
    if (!this.sourceId) return false;
    for (const f of this.fields) {
      if (f.required && f.ctrl !== 'dateArray') {
        const v = this.values[f.key];
        if (v === undefined || v === null || v === '') return false;
      }
    }
    if (this.ruleKind === 'threshold' && this.threshold == null) return false;
    return true;
  }

  selectSource(id: string): void {
    if (!this.domains.find(d => d.id === id)?.active) return;
    this.sourceId = id;
    this.fields = this.buildFields(this.source);
    this.values = {};
    this.dates = [];
    for (const f of this.fields) {
      if (f.ctrl === 'stepper') this.values[f.key] = f.default ?? f.min ?? 0;
      else if (f.ctrl === 'enum') this.values[f.key] = f.default ?? f.enum?.[0];
      else if (f.default !== undefined) this.values[f.key] = f.default;
    }
  }

  enumLabel(v: string): string {
    return CABIN[v] ?? v.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
  }

  step(f: Field, delta: number): void {
    const cur = Number(this.values[f.key] ?? f.min ?? 0);
    let n = cur + delta;
    if (f.min != null) n = Math.max(n, f.min);
    if (f.max != null) n = Math.min(n, f.max);
    this.values[f.key] = n;
  }

  addDate(): void {
    if (this.newDate && !this.dates.includes(this.newDate)) {
      this.dates = [...this.dates, this.newDate];
      this.newDate = '';
    }
  }
  removeDate(i: number): void {
    this.dates = this.dates.filter((_, x) => x !== i);
  }

  /** Champs qui occupent toute la largeur (les autres se rangent en grille 2 colonnes). */
  isWide(f: Field): boolean {
    return f.ctrl === 'date' || f.ctrl === 'enum' || f.ctrl === 'dateArray'
      || (f.ctrl === 'number' && !!f.description);
  }

  private buildFields(s?: KestrelSource): Field[] {
    if (!s) return [];
    const schema = s.params_schema as {
      properties?: Record<string, Record<string, unknown>>; required?: string[];
    };
    const props = schema.properties ?? {};
    const required = schema.required ?? [];
    return Object.entries(props).map(([key, def]) => {
      const rawType = def['type'];
      const t = Array.isArray(rawType) ? (rawType as string[]).find(x => x !== 'null') : rawType;
      let ctrl: Ctrl = 'text';
      if (def['enum']) ctrl = 'enum';
      else if (t === 'array') ctrl = 'dateArray';
      else if (def['format'] === 'date') ctrl = 'date';
      else if (t === 'integer') ctrl = 'stepper';
      else if (t === 'number') ctrl = 'number';
      return {
        key,
        title: (def['title'] as string) ?? key,
        ctrl,
        group: (def['x-group'] as string) ?? 'Détails',
        enum: def['enum'] as string[] | undefined,
        min: def['minimum'] as number | undefined,
        max: def['maximum'] as number | undefined,
        required: required.includes(key),
        default: def['default'],
        description: def['description'] as string | undefined,
      };
    });
  }

  submit(): void {
    const s = this.source;
    if (!s || !this.valid || this.saving) return;
    this.saving = true;
    this.err = null;

    const params: Record<string, unknown> = { ...this.values };
    if (this.arrField && this.dates.length) params[this.arrField.key] = this.dates;

    this.api.createTarget({
      source: s.id,
      label: this.label || undefined,
      params,
      currency: this.currency,
      interval_minutes: Math.max(this.intervalH, 1) * 60,
    }).subscribe({
      next: target => {
        const rule = this.ruleKind === 'threshold'
          ? { kind: 'threshold', config: { threshold: this.threshold } }
          : { kind: 'relative_drop', config: { percent: this.percent, window_days: this.windowDays } };
        const done = () => { this.saving = false; this.created.emit(); };
        this.api.createRule(target.id, rule).subscribe({ next: done, error: done });
      },
      error: e => {
        this.saving = false;
        this.err = (e?.error?.detail as string) ?? 'Création refusée.';
      },
    });
  }
}
