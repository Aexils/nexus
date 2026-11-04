import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { KodiSetting, SkinSetting, TraktSettings, TraktSnapshotItem } from '@nexus/shared-types';
import KODI_HELP_FR from './kodi-help-fr.json';
import KODI_LABELS_FR from './kodi-labels-fr.json';
import SKIN_DEFAULTS from './skin-defaults.json';
import { SKIN_HELP_FR, colorHelpFr } from './skin-help-fr';
import { SKIN_GROUP_FR, SKIN_LABEL_FR, SKIN_SECTION_FR } from './skin-labels-fr';
import { TvPreview, TvZone } from './tv-preview';

const REFRESH_MS = 4000;
const MAX_RESULTS = 120;
/** Au-delà, la télé est éteinte ou a refusé : on ne laisse pas « Envoi… » affiché pour toujours. */
const CONFIRM_MS = 20000;
const UNDO_MS = 8000;

/** Les réglages du skin qui portent la couleur d'accent, avec l'opacité d'origine de chacun. */
const ACCENT_SETTINGS: Record<string, string> = {
  ActiveSpinControlColor: 'ff',
  SpinnerTextureColor: 'ff',
  OSDVolumeButtonColor: 'ff',
  LineUnderMenuIconsColor: 'ff',
  BingieProgressBarColor: 'ff',
  OSDProgressBarColor: 'ff',
  OSDProgressBarCacheColor: '80',
  BingieOSDProgressBarColor: 'ff',
  BingieOSDProgressBarCacheColor: '80',
  OSDBufferingSpinnerColor: 'ff',
  PVRGuideProgressIndicatorColor: 'ff',
  BingieNewEpisodesTagColor: 'ff',
  'WatchedIndicator.Watched.Color': 'e6',
  'WatchedIndicator.Progress.Color': 'e6',
  'WatchedIndicator.Episodes.Color': 'e6',
  'WatchedIndicator.UnWatched.Color': 'e6',
};

/** Ce que l'aperçu sait montrer, et la zone de l'écran concernée. */
const SKIN_ZONES: Record<string, TvZone> = {
  DisableSpotlightContent: 'spotlight',
  AutoHidePlotOnIdle: 'spotlight',
  DisableDummySpotlight: 'spotlight',
  SpotLightTrailers: 'spotlight',
  NoClearLogoBingie: 'spotlight',
  BingieSpotlightPlotTextColor: 'spotlight',
  EnableFixedFrameWidgets: 'row',
  BingieAutoTrailer: 'row',
  PreferTvShowThumbWidget: 'row',
  'WatchedIndicator.Watched': 'row',
  'WatchedIndicator.Watched.Color': 'row',
  EnableNewEpisodesIndicator: 'row',
  BingieNewEpisodesTagColor: 'row',
  'NewEpisodes.TextColor': 'row',
  BingieProgressBarColor: 'row',
  BingieProgressBarBackgroundColor: 'row',
  BingieLabelTextColor: 'row',
  ViewDetailsBorderFocusColor: 'row',
  DisableStaticSlimMenu: 'menu',
  MainMenuButtonColor: 'menu',
  MainMenuFocusButtonColor: 'menu',
  LineUnderMenuIconsColor: 'menu',
};

/** Les réglages qu'on vient vraiment changer. Ceux que la télé n'envoie pas sont ignorés. */
const ESSENTIALS: { title: string; keys: string[] }[] = [
  { title: 'Accueil', keys: ['DisableSpotlightContent', 'SpotLightTrailers', 'BingieAutoTrailer', 'ShowInformationBypass', 'EnableFixedFrameWidgets', 'DisableStaticSlimMenu'] },
  { title: 'Affiches', keys: ['PreferTvShowThumbWidget', 'NoClearLogoBingie', 'WatchedIndicator.Watched', 'EnableNewEpisodesIndicator'] },
  { title: 'Lecture', keys: ['locale.audiolanguage', 'locale.subtitlelanguage', 'videoplayer.adjustrefreshrate', 'AutoCloseVideoOSD', 'EnableTimeInfo'] },
];

/** Un réglage, quelle que soit son origine, comme la page l'affiche. */
interface Row {
  source: 'kodi' | 'skin';
  key: string;
  label: string;
  /** Le nom affiché sur la télé, qui reste en anglais. */
  original: string;
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
  zone: TvZone | null;
}

const kodiHelp = KODI_HELP_FR as Record<string, string>;
const kodiLabels = KODI_LABELS_FR as Record<string, string>;
const skinColors = SKIN_DEFAULTS.colors as Record<string, string>;
const skinBoolsOn = new Set(SKIN_DEFAULTS.boolOn);

function fromKodi(s: KodiSetting): Row {
  return {
    source: 'kodi',
    key: s.id,
    label: kodiLabels[s.label] ?? s.label,
    original: s.label,
    help: kodiHelp[s.id] ?? s.help,
    group: kodiLabels[s.category] ?? s.category,
    section: `kodi:${s.section}`,
    type: s.type,
    value: s.value,
    default: s.default,
    options: s.options ?? null,
    minimum: s.minimum ?? null,
    maximum: s.maximum ?? null,
    editable: s.editable,
    inverted: false,
    zone: null,
  };
}

function fromSkin(s: SkinSetting, section: string): Row {
  return {
    source: 'skin',
    key: s.setting,
    label: SKIN_LABEL_FR[s.setting] ?? s.label,
    original: s.label,
    help: s.kind === 'color' ? colorHelpFr(s.group) : (SKIN_HELP_FR[s.setting] ?? ''),
    group: SKIN_GROUP_FR[s.group] ?? s.group,
    section: `skin:${section}`,
    type: s.kind === 'bool' ? 'boolean' : 'color',
    value: s.value,
    default: s.kind === 'bool' ? skinBoolsOn.has(s.setting) : skinColors[s.setting],
    options: null,
    minimum: null,
    maximum: null,
    editable: true,
    inverted: s.inverted === true,
    zone: SKIN_ZONES[s.setting] ?? null,
  };
}

function sameValue(a: unknown, b: unknown): boolean {
  const text = (v: unknown) => (typeof v === 'string' ? v.toLowerCase() : JSON.stringify(v));
  return text(a) === text(b);
}

@Component({
  selector: 'app-trakt-settings',
  standalone: true,
  imports: [RouterLink, TvPreview],
  templateUrl: './trakt-settings.html',
  styleUrl: './trakt-settings.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TraktSettingsPage implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private timer?: ReturnType<typeof setInterval>;
  private undoTimer?: ReturnType<typeof setTimeout>;
  /** Heure d'envoi de chaque changement pas encore confirmé. */
  private readonly sentAt = new Map<string, number>();

  readonly accents = [
    { name: 'Rouge', hex: 'e50914' },
    { name: 'Orange', hex: 'f97316' },
    { name: 'Ambre', hex: 'f5b301' },
    { name: 'Vert', hex: '1db954' },
    { name: 'Bleu', hex: '0a84ff' },
    { name: 'Violet', hex: '8b5cf6' },
  ];

  readonly data = signal<TraktSettings | null>(null);
  readonly art = signal<TraktSnapshotItem[]>([]);
  readonly section = signal('essentiel');
  readonly query = signal('');
  readonly zone = signal<TvZone | null>(null);
  /** Valeurs demandées et pas encore confirmées par la télé. */
  readonly pending = signal<Record<string, unknown>>({});
  readonly failure = signal<string | null>(null);
  /** Reste affiché jusqu'au prochain changement : le rafraîchissement ne doit pas l'effacer. */
  readonly unconfirmed = signal<string | null>(null);
  readonly undo = signal<{ message: string; restore: { row: Row; value: unknown }[] } | null>(null);

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
  readonly changedCount = computed(() => this.rows().filter(r => r.editable && this.isChanged(r)).length);

  private readonly matches = computed(() => {
    const wanted = this.query().trim().toLocaleLowerCase();
    if (wanted) {
      return this.rows().filter(r => `${r.label} ${r.original} ${r.help} ${r.group}`.toLocaleLowerCase().includes(wanted));
    }
    if (this.section() === 'modifies') return this.rows().filter(r => r.editable && this.isChanged(r));
    return this.rows().filter(r => r.section === this.section());
  });
  readonly hiddenResults = computed(() => Math.max(0, this.matches().length - MAX_RESULTS));

  readonly groups = computed(() => {
    if (!this.searching() && this.section() === 'essentiel') {
      const byKey = new Map(this.rows().map(r => [r.key, r]));
      return ESSENTIALS.map(g => ({
        title: g.title,
        note: '',
        colors: false,
        rows: g.keys.map(k => byKey.get(k)).filter((r): r is Row => !!r),
      })).filter(g => g.rows.length);
    }
    const flat = this.searching() || this.section() === 'modifies';
    const groups = new Map<string, Row[]>();
    for (const row of this.matches().slice(0, MAX_RESULTS)) {
      const title = flat ? `${this.sectionName(row.section)} : ${row.group}` : row.group;
      groups.set(title, [...(groups.get(title) ?? []), row]);
    }
    return [...groups].map(([title, rows]) => {
      const colors = rows.every(r => r.type === 'color');
      // La même phrase sur chaque couleur n'apprend rien : elle est dite une fois, sur le groupe.
      return { title, rows, colors, note: colors ? rows[0].help : '' };
    });
  });

  /** Les réglages du skin avec les changements en cours, pour que l'aperçu réagisse tout de suite. */
  readonly previewValues = computed(() => {
    const values: Record<string, unknown> = {};
    for (const r of this.rows()) if (r.source === 'skin') values[r.key] = r.value;
    for (const [key, value] of Object.entries(this.pending())) {
      if (key.startsWith('skin:')) values[key.slice(5)] = value;
    }
    return values;
  });

  /** L'accent actuel, lu sur la barre de progression, sans son opacité. */
  readonly accent = computed(() => String(this.previewValues()['BingieProgressBarColor'] ?? 'ffe50914').slice(2).toLowerCase());

  ngOnInit(): void {
    void this.load();
    void this.loadArt();
    this.timer = setInterval(() => {
      if (!document.hidden) void this.load();
    }, REFRESH_MS);
  }

  ngOnDestroy(): void {
    clearInterval(this.timer);
    clearTimeout(this.undoTimer);
  }

  /** Les images de l'aperçu : la rangée la plus fournie en vraies illustrations. */
  private async loadArt(): Promise<void> {
    try {
      const rows = await firstValueFrom(this.http.get<Record<string, TraktSnapshotItem[]>>('/api/trakt/row-snapshots'));
      const best = Object.values(rows).sort((a, b) => b.filter(i => i.art.fanart).length - a.filter(i => i.art.fanart).length)[0] ?? [];
      this.art.set(best.filter(i => i.art.fanart));
    } catch {
      // Sans images, l'aperçu montre quand même la disposition.
    }
  }

  private async load(): Promise<void> {
    try {
      const data = await firstValueFrom(this.http.get<TraktSettings>('/api/trakt/settings'));
      this.data.set(data);
      this.settlePending();
      this.failure.set(null);
    } catch {
      this.failure.set('Le service ne répond pas. Les réglages affichés sont peut-être anciens.');
    }
  }

  /** Retire ce que la télé a confirmé, et signale ce qu'elle n'a pas confirmé à temps. */
  private settlePending(): void {
    const waiting = { ...this.pending() };
    const expired: string[] = [];
    for (const row of this.rows()) {
      const key = `${row.source}:${row.key}`;
      if (!(key in waiting)) continue;
      if (sameValue(waiting[key], row.value)) {
        delete waiting[key];
        this.sentAt.delete(key);
      } else if (Date.now() - (this.sentAt.get(key) ?? 0) > CONFIRM_MS) {
        delete waiting[key];
        this.sentAt.delete(key);
        expired.push(row.label);
      }
    }
    this.pending.set(waiting);
    if (expired.length) {
      this.unconfirmed.set(`La télé n'a pas confirmé : ${expired.join(', ')}. Vérifie que Kodi est allumé, puis réessaie.`);
    }
  }

  isCurrent(section: string): boolean {
    return !this.searching() && this.section() === section;
  }

  open(section: string): void {
    this.section.set(section);
    this.query.set('');
  }

  skinSectionName(name: string): string {
    return SKIN_SECTION_FR[name] ?? name;
  }

  kodiText(text: string): string {
    return kodiLabels[text] ?? text;
  }

  sectionName(section: string): string {
    const name = section.split(':').slice(1).join(':');
    return section.startsWith('skin:') ? this.skinSectionName(name) : this.kodiText(name);
  }

  currentValue(row: Row): unknown {
    const key = `${row.source}:${row.key}`;
    return key in this.pending() ? this.pending()[key] : row.value;
  }

  /** Une valeur en lecture seule, lisible même quand c'est une liste. */
  displayValue(row: Row): string {
    const value = this.currentValue(row);
    if (Array.isArray(value)) return value.join(', ') || 'Aucune';
    return String(value ?? '');
  }

  isWaiting(row: Row): boolean {
    return `${row.source}:${row.key}` in this.pending();
  }

  isChanged(row: Row): boolean {
    return row.default !== undefined && !sameValue(row.value, row.default);
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

  toggle(row: Row): void {
    const on = this.isOn(row);
    void this.change(row, this.currentValue(row) !== true);
    this.offerUndo(`${row.label} : ${on ? 'désactivé' : 'activé'}`, [{ row, value: row.value }]);
  }

  reset(row: Row): void {
    this.offerUndo(`${row.label} : valeur par défaut`, [{ row, value: row.value }]);
    void this.change(row, row.default);
  }

  /** Envoie un changement. Renvoie false si le service l'a refusé. */
  async change(row: Row, value: unknown): Promise<boolean> {
    const key = `${row.source}:${row.key}`;
    this.pending.set({ ...this.pending(), [key]: value });
    this.sentAt.set(key, Date.now());
    this.unconfirmed.set(null);
    try {
      await firstValueFrom(this.http.post('/api/trakt/settings', { source: row.source, id: row.key, value }));
      this.failure.set(null);
      return true;
    } catch {
      const waiting = { ...this.pending() };
      delete waiting[key];
      this.pending.set(waiting);
      this.sentAt.delete(key);
      this.failure.set(`${row.label} : envoi refusé par le service. Réessaie dans un instant.`);
      return false;
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

  /** Une seule couleur pour tous les réglages d'accent, envoyés l'un après l'autre. */
  async setAccent(hex: string): Promise<void> {
    if (hex === this.accent()) return;
    const targets = this.rows().filter(r => r.source === 'skin' && r.key in ACCENT_SETTINGS);
    this.offerUndo("Couleur d'accent changée", targets.map(row => ({ row, value: row.value })));
    for (const row of targets) {
      if (!(await this.change(row, `${ACCENT_SETTINGS[row.key]}${hex}`))) return;
    }
  }

  private offerUndo(message: string, restore: { row: Row; value: unknown }[]): void {
    clearTimeout(this.undoTimer);
    this.undo.set({ message, restore });
    this.undoTimer = setTimeout(() => this.undo.set(null), UNDO_MS);
  }

  async runUndo(): Promise<void> {
    const undo = this.undo();
    if (!undo) return;
    clearTimeout(this.undoTimer);
    this.undo.set(null);
    for (const { row, value } of undo.restore) {
      if (!(await this.change(row, value))) return;
    }
  }
}
