import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { KodiSetting, SkinSetting, TraktSettings } from '@nexus/shared-types';
import KODI_HELP_FR from './kodi-help-fr.json';
import { SKIN_HELP_FR, colorHelpFr } from './skin-help-fr';

const REFRESH_MS = 4000;
const MAX_RESULTS = 120;

/** Un réglage, quelle que soit son origine, comme la page l'affiche. */
interface Row {
  source: 'kodi' | 'skin';
  key: string;
  label: string;
  help: string;
  group: string;
  section: string;
  type: string;
  value: unknown;
  default: unknown;
  options: { label: string; value: unknown }[] | null;
  minimum: number | null;
  maximum: number | null;
  editable: boolean;
  /** L'interrupteur affiche le contraire du réglage enregistré. */
  inverted: boolean;
}

const kodiHelp = KODI_HELP_FR as Record<string, string>;

function fromKodi(s: KodiSetting): Row {
  return {
    source: 'kodi',
    key: s.id,
    label: s.label,
    help: kodiHelp[s.id] ?? s.help,
    group: s.category,
    section: `kodi:${s.section}`,
    type: s.type,
    value: s.value,
    default: s.default,
    options: s.options ?? null,
    minimum: s.minimum ?? null,
    maximum: s.maximum ?? null,
    editable: s.editable,
    inverted: false,
  };
}

function fromSkin(s: SkinSetting, section: string): Row {
  return {
    source: 'skin',
    key: s.setting,
    label: s.label,
    help: s.kind === 'color' ? colorHelpFr(s.group) : (SKIN_HELP_FR[s.setting] ?? ''),
    group: s.group,
    section: `skin:${section}`,
    type: s.kind === 'bool' ? 'boolean' : 'color',
    value: s.value,
    default: undefined,
    options: null,
    minimum: null,
    maximum: null,
    editable: true,
    inverted: s.inverted === true,
  };
}

@Component({
  selector: 'app-trakt-settings',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './trakt-settings.html',
  styleUrl: './trakt-settings.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TraktSettingsPage implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private timer?: ReturnType<typeof setInterval>;

  readonly data = signal<TraktSettings | null>(null);
  readonly section = signal('');
  readonly query = signal('');
  readonly onlyChanged = signal(false);
  /** Valeurs demandées et pas encore confirmées par la télé. */
  readonly pending = signal<Record<string, unknown>>({});
  readonly failure = signal<string | null>(null);

  readonly rows = computed<Row[]>(() => {
    const data = this.data();
    if (!data) return [];
    return [
      ...(data.kodi ?? []).map(fromKodi),
      ...(data.skin ?? []).flatMap(s => s.items.map(i => fromSkin(i, s.name))),
    ];
  });
  readonly kodiSections = computed(() => [...new Set((this.data()?.kodi ?? []).map(s => s.section))]);
  readonly skinSections = computed(() => (this.data()?.skin ?? []).map(s => s.name));
  readonly searching = computed(() => this.query().trim().length > 0);
  readonly visible = computed(() => {
    const wanted = this.query().trim().toLocaleLowerCase();
    const changed = this.onlyChanged();
    const list = this.rows().filter(r => {
      if (wanted) return `${r.label} ${r.help} ${r.group}`.toLocaleLowerCase().includes(wanted);
      if (changed) return this.isChanged(r);
      return r.section === this.section();
    });
    return list.slice(0, MAX_RESULTS);
  });
  readonly groups = computed(() => {
    const groups = new Map<string, Row[]>();
    for (const row of this.visible()) {
      const title = this.searching() || this.onlyChanged() ? `${this.sectionName(row.section)}, ${row.group}` : row.group;
      groups.set(title, [...(groups.get(title) ?? []), row]);
    }
    return [...groups].map(([title, rows]) => ({ title, rows }));
  });

  ngOnInit(): void {
    void this.load();
    this.timer = setInterval(() => void this.load(), REFRESH_MS);
  }

  ngOnDestroy(): void {
    clearInterval(this.timer);
  }

  private async load(): Promise<void> {
    try {
      const data = await firstValueFrom(this.http.get<TraktSettings>('/api/trakt/settings'));
      this.data.set(data);
      if (!this.section() && data.skin?.length) this.section.set(`skin:${data.skin[0].name}`);
      // La télé a confirmé : on retire ce qui était en attente.
      const waiting = { ...this.pending() };
      for (const row of this.rows()) {
        if (`${row.source}:${row.key}` in waiting && waiting[`${row.source}:${row.key}`] === row.value) {
          delete waiting[`${row.source}:${row.key}`];
        }
      }
      this.pending.set(waiting);
      this.failure.set(null);
    } catch {
      this.failure.set('Le service ne répond pas. Les réglages affichés sont peut-être anciens.');
    }
  }

  sectionName(section: string): string {
    return section.split(':').slice(1).join(':');
  }

  currentValue(row: Row): unknown {
    const key = `${row.source}:${row.key}`;
    return key in this.pending() ? this.pending()[key] : row.value;
  }

  isWaiting(row: Row): boolean {
    return `${row.source}:${row.key}` in this.pending();
  }

  isChanged(row: Row): boolean {
    return row.default !== undefined && JSON.stringify(row.value) !== JSON.stringify(row.default);
  }

  /** Les couleurs du skin sont en AARRGGBB, le sélecteur du navigateur en #RRGGBB. */
  colorOf(row: Row): string {
    const value = String(this.currentValue(row) ?? '');
    return /^[0-9a-f]{8}$/i.test(value) ? `#${value.slice(2)}` : '#000000';
  }

  optionIndex(row: Row): number {
    const value = JSON.stringify(this.currentValue(row));
    return (row.options ?? []).findIndex(o => JSON.stringify(o.value) === value);
  }

  /** L'état de l'interrupteur tel que la personne le comprend, inversions comprises. */
  isOn(row: Row): boolean {
    return (this.currentValue(row) === true) !== row.inverted;
  }

  async change(row: Row, value: unknown): Promise<void> {
    const key = `${row.source}:${row.key}`;
    this.pending.set({ ...this.pending(), [key]: value });
    try {
      await firstValueFrom(this.http.post('/api/trakt/settings', { source: row.source, id: row.key, value }));
      this.failure.set(null);
    } catch {
      const waiting = { ...this.pending() };
      delete waiting[key];
      this.pending.set(waiting);
      this.failure.set(`${row.label} n'a pas pu être envoyé à la télé.`);
    }
  }

  changeNumber(row: Row, raw: string): void {
    const value = Number(raw);
    if (Number.isFinite(value)) void this.change(row, value);
  }

  changeColor(row: Row, hex: string): void {
    const alpha = String(row.value ?? '').slice(0, 2) || 'ff';
    void this.change(row, `${alpha}${hex.slice(1)}`.toLowerCase());
  }
}
