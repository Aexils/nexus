import {
  ChangeDetectionStrategy, Component, EventEmitter, Input, OnInit, Output,
} from '@angular/core';
import { inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule, X, Plus, Trash2 } from 'lucide-angular';
import { KestrelSource } from '@nexus/shared-types';
import { KestrelService } from './kestrel.service';

type FieldKind = 'text' | 'date' | 'number' | 'integer' | 'enum' | 'dateArray';
interface Field {
  key: string; title: string; kind: FieldKind;
  enum?: string[]; required: boolean; default?: unknown; description?: string;
}

/** Formulaire de création de cible, GÉNÉRÉ depuis le `params_schema` de la source (§8). */
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
  readonly Trash2 = Trash2;

  sourceId = '';
  label = '';
  currency = 'CAD';
  intervalH = 12;
  fields: Field[] = [];
  values: Record<string, unknown> = {};
  dates: string[] = [];
  ruleKind: 'threshold' | 'relative_drop' = 'threshold';
  threshold: number | null = null;
  percent = 15;
  windowDays = 30;
  saving = false;
  err: string | null = null;

  ngOnInit(): void {
    if (this.sources.length) this.selectSource(this.sources[0].id);
  }

  get source(): KestrelSource | undefined {
    return this.sources.find(s => s.id === this.sourceId);
  }

  get arrField(): Field | undefined {
    return this.fields.find(f => f.kind === 'dateArray');
  }

  get valid(): boolean {
    if (!this.sourceId) return false;
    for (const f of this.fields) {
      if (f.required && f.kind !== 'dateArray') {
        const v = this.values[f.key];
        if (v === undefined || v === null || v === '') return false;
      }
    }
    if (this.ruleKind === 'threshold' && this.threshold == null) return false;
    return true;
  }

  selectSource(id: string): void {
    this.sourceId = id;
    this.fields = this.buildFields(this.source);
    this.values = {};
    this.dates = [];
    for (const f of this.fields) {
      if (f.kind !== 'dateArray' && f.default !== undefined) this.values[f.key] = f.default;
    }
  }

  addDate(): void { this.dates = [...this.dates, '']; }
  removeDate(i: number): void { this.dates = this.dates.filter((_, x) => x !== i); }

  private buildFields(s?: KestrelSource): Field[] {
    if (!s) return [];
    const schema = s.params_schema as { properties?: Record<string, Record<string, unknown>>; required?: string[] };
    const props = schema.properties ?? {};
    const required = schema.required ?? [];
    return Object.entries(props).map(([key, def]) => {
      const rawType = def['type'];
      const t = Array.isArray(rawType) ? (rawType as string[]).find(x => x !== 'null') : rawType;
      let kind: FieldKind = 'text';
      if (def['enum']) kind = 'enum';
      else if (t === 'array') kind = 'dateArray';
      else if (def['format'] === 'date') kind = 'date';
      else if (t === 'integer') kind = 'integer';
      else if (t === 'number') kind = 'number';
      return {
        key,
        title: (def['title'] as string) ?? key,
        kind,
        enum: def['enum'] as string[] | undefined,
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
    if (this.arrField) {
      const ds = this.dates.filter(d => d);
      if (ds.length) params[this.arrField.key] = ds;
    }

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
