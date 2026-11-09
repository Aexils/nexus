import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { KeyValuePipe } from '@angular/common';
import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDragPlaceholder, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
import {
  AGGREGATOR_BUILTIN_PROFILES,
  AggregatorPreferences,
  AggregatorPreview,
  AggregatorPreviewRequest,
  AggregatorTier,
} from '@nexus/shared-types';
import { PageHeaderComponent } from '../../../../shared/page-header/page-header';
import { ApiError, SyncStatus, TIERS, TIER_LABELS } from './preferences-store';
import { CODECS, DYNAMICS, RESOLUTIONS, RuleChips, describeRule, formatRule, parseRule, splitRules } from './rule-chips';
import { previewRows } from './preview-view';
import { AggregatorDraft } from './aggregator-draft';
import { BingieSession } from '../../bingie-session';

/** Liste de mots d'une section (langues, codecs, formats) : les seuls champs tableaux. */
function wordList(d: AggregatorPreferences, section: 'strict' | 'soft', key: string): string[] {
  return (d[section] as unknown as Record<string, string[]>)[key];
}

const STATUS_LABELS: Record<SyncStatus, string> = {
  loading: 'chargement…', synced: 'synchronisé', dirty: 'modifications non enregistrées', saving: 'enregistrement…',
  conflict: 'modifié ailleurs', invalid: 'refusé par le moteur', forbidden: 'écriture refusée',
  unavailable: 'kube-aggregator injoignable', unauthenticated: 'connexion requise',
};
const REFUSALS: Record<string, string> = {
  not_authorized: 'non autorisé', availability: 'indisponible', resolution: 'résolution', language: 'langue',
  codec: 'codec', hdr: 'HDR', size: 'taille', format: 'format exclu', profile: 'hors profil', source: 'source désactivée',
};

@Component({
  selector: 'app-aggregator-page',
  standalone: true,
  imports: [PageHeaderComponent, KeyValuePipe, CdkDropList, CdkDrag, CdkDragHandle, CdkDragPlaceholder],
  templateUrl: './aggregator-page.html',
  styleUrl: './aggregator-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AggregatorPage implements OnInit, OnDestroy {
  /** Session commune de Bingie : une seule connexion, gérée par le cadre. */
  readonly session = inject(BingieSession);
  /** Révision locale : la page relit le magasin (objets mutables) quand elle change. */
  /** Brouillon partagé : survit à la navigation entre modules Bingie. */
  private readonly draftService = inject(AggregatorDraft);
  private readonly rev = this.draftService.rev;
  readonly store = this.draftService.store;

  readonly resolutions = RESOLUTIONS;
  readonly dynamics = DYNAMICS;
  readonly codecs = CODECS;
  readonly tierLabels = TIER_LABELS;
  readonly builtins = AGGREGATOR_BUILTIN_PROFILES;

  readonly selected = signal<string>('preferred');
  readonly preview = signal<AggregatorPreview | null>(null);
  readonly previewError = signal<string | null>(null);
  readonly previewing = signal(false);
  readonly query = signal<{ media_type: 'movie' | 'episode'; tmdb: string; season: number; episode: number }>(
    { media_type: 'movie', tmdb: '', season: 1, episode: 1 });
  private previewTimer: ReturnType<typeof setTimeout> | null = null;

  // Le magasin modifie ses objets sur place : même référence après une édition. Sans
  // « equal: () => false », Angular jugerait la valeur inchangée et ne recalculerait ni la liste
  // des profils ni les règles affichées.
  readonly draft = computed(() => { this.rev(); return this.store.draft; }, { equal: () => false });
  readonly server = computed(() => { this.rev(); return this.store.server; }, { equal: () => false });
  readonly status = computed(() => { this.rev(); return this.store.status; });
  readonly statusLabel = computed(() => STATUS_LABELS[this.status()]);
  readonly message = computed(() => { this.rev(); return this.store.message; });
  readonly dirty = computed(() => { this.rev(); return this.store.dirty; });
  readonly canWrite = computed(() => this.session.authenticated());
  readonly authConfigured = computed(() => this.session.configured());
  readonly inError = computed(() =>
    ['conflict', 'invalid', 'forbidden', 'unavailable', 'unauthenticated'].includes(this.status()));

  readonly customKeys = computed(() => Object.keys(this.draft()?.profiles ?? {}));
  readonly isBuiltin = computed(() => this.selected() in AGGREGATOR_BUILTIN_PROFILES);
  readonly selectedProfile = computed(() => {
    const key = this.selected();
    return this.draft()?.profiles[key] ?? AGGREGATOR_BUILTIN_PROFILES[key] ?? null;
  }, { equal: () => false });
  readonly rules = computed<RuleChips[]>(() => splitRules(this.selectedProfile()?.rules ?? '').map(parseRule));
  readonly enabledTiers = computed(() => [...(this.draft()?.provider_order ?? [])]);
  readonly disabledTiers = computed(() => TIERS.filter(t => !this.enabledTiers().includes(t)));
  readonly rows = computed(() => { const pv = this.preview(); return pv ? previewRows(pv) : []; });

  async ngOnInit(): Promise<void> {
    await Promise.all([this.draftService.open(), this.session.refresh()]);
    this.selected.set(this.store.draft?.active_profile ?? 'preferred');
  }

  ngOnDestroy(): void {
    if (this.previewTimer) clearTimeout(this.previewTimer);
  }

  // --- Transport vers l'API Nexus (qui relaie kube-aggregator) ---------------------------------

  // --- Enregistrement ---------------------------------------------------------------------------

  async save(): Promise<void> {
    if (!this.session.authenticated()) {
      this.session.loginNeeded.set(true);  // le cadre ouvre la connexion ; le brouillon est gardé
      return;
    }
    await this.store.save();
  }

  async reload(): Promise<void> {
    await this.store.load();
    this.schedulePreview();
  }

  discard(): void {
    this.store.discard();
    this.schedulePreview();
  }

  private change(edit: (d: AggregatorPreferences) => void): void {
    this.store.edit(edit);
    this.schedulePreview();
  }

  // --- Profils ------------------------------------------------------------------------------------

  select(key: string): void {
    this.selected.set(key);
  }

  createProfile(): void {
    this.selected.set(this.store.createProfile('Nouveau profil'));
    this.schedulePreview();
  }

  duplicate(): void {
    const key = this.store.duplicateProfile(this.selected());
    if (key) this.selected.set(key);
  }

  rename(label: string): void {
    this.store.renameProfile(this.selected(), label);
  }

  remove(): void {
    const key = this.selected();
    this.store.deleteProfile(key);
    this.selected.set(this.store.draft?.active_profile ?? 'preferred');
    this.schedulePreview();
  }

  activate(key: string): void {
    this.store.setActive(key);
    this.schedulePreview();
  }

  profileLabel(key: string): string {
    return this.draft()?.profiles[key]?.label ?? AGGREGATOR_BUILTIN_PROFILES[key]?.label ?? key;
  }

  // --- Règles ------------------------------------------------------------------------------------

  private writeRules(rules: RuleChips[]): void {
    this.store.setRules(this.selected(), rules.map(formatRule));
    this.schedulePreview();
  }

  dropRule(event: CdkDragDrop<RuleChips[]>): void {
    const rules = [...this.rules()];
    moveItemInArray(rules, event.previousIndex, event.currentIndex);
    this.writeRules(rules);
  }

  moveRule(index: number, delta: number): void {
    const rules = [...this.rules()];
    const target = index + delta;
    if (target < 0 || target >= rules.length) return;
    moveItemInArray(rules, index, target);
    this.writeRules(rules);
  }

  editRule(index: number, change: (chips: RuleChips) => void): void {
    const rules = this.rules().map(r => ({ ...r, resolutions: [...r.resolutions], dynamics: [...r.dynamics],
      languages: [...r.languages], codecs: [...r.codecs], extra: [...r.extra] }));
    change(rules[index]);
    this.writeRules(rules);
  }

  toggle(list: string[], value: string): void {
    const at = list.indexOf(value);
    if (at >= 0) list.splice(at, 1);
    else list.push(value);
  }

  toggleChip(index: number, field: 'resolutions' | 'dynamics' | 'codecs' | 'languages', value: string): void {
    this.editRule(index, r => this.toggle(r[field], value));
  }

  toggleMulti(index: number): void {
    this.editRule(index, r => { r.multi = !r.multi; });
  }

  addRule(): void {
    this.writeRules([...this.rules(), parseRule('1080p')]);
  }

  removeRule(index: number): void {
    const rules = this.rules().filter((_, i) => i !== index);
    if (rules.length) this.writeRules(rules);
  }

  addWord(index: number, field: 'languages', input: HTMLInputElement): void {
    const value = input.value.trim().toLowerCase();
    input.value = '';
    if (value) this.editRule(index, r => { if (!r[field].includes(value)) r[field].push(value); });
  }

  setSize(index: number, value: string): void {
    const size = value.trim() === '' ? null : Number(value.replace(',', '.'));
    this.editRule(index, r => { r.maxSize = size !== null && Number.isFinite(size) && size > 0 ? size : null; });
  }

  describe(chips: RuleChips): string {
    return describeRule(chips);
  }

  // --- Fournisseurs et filtres --------------------------------------------------------------------

  dropTier(event: CdkDragDrop<AggregatorTier[]>): void {
    const order = [...this.enabledTiers()];
    moveItemInArray(order, event.previousIndex, event.currentIndex);
    this.store.setProviderOrder(order);
    this.schedulePreview();
  }

  moveTier(index: number, delta: number): void {
    const order = [...this.enabledTiers()];
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    moveItemInArray(order, index, target);
    this.store.setProviderOrder(order);
    this.schedulePreview();
  }

  toggleTier(tier: AggregatorTier): void {
    this.store.toggleProvider(tier);
    this.schedulePreview();
  }

  setStrict<K extends keyof AggregatorPreferences['strict']>(key: K, value: AggregatorPreferences['strict'][K]): void {
    this.change(d => { d.strict[key] = value; });
  }

  setSoft<K extends keyof AggregatorPreferences['soft']>(key: K, value: AggregatorPreferences['soft'][K]): void {
    this.change(d => { d.soft[key] = value; });
  }

  setUnknown(value: 'accept' | 'reject'): void {
    this.change(d => { d.unknown = value; });
  }

  setProfileStrict(value: boolean): void {
    this.change(d => { d.profile_strict = value; });
  }

  sizeValue(value: string): number | null {
    const size = value.trim() === '' ? null : Number(value.replace(',', '.'));
    return size !== null && Number.isFinite(size) && size >= 0 ? size : null;
  }

  toggleWord(section: 'strict' | 'soft', key: 'allowed_codecs' | 'preferred_codecs' | 'excluded_formats', value: string): void {
    this.change(d => {
      const list = wordList(d, section, key);
      this.toggle(list, value);
    });
  }

  addListWord(section: 'strict' | 'soft', key: 'required_languages' | 'preferred_languages' | 'excluded_formats',
              input: HTMLInputElement): void {
    const value = input.value.trim().toLowerCase();
    input.value = '';
    if (!value) return;
    this.change(d => {
      const list = wordList(d, section, key);
      if (!list.includes(value)) list.push(value);
    });
  }

  removeListWord(section: 'strict' | 'soft', key: string, value: string): void {
    this.change(d => {
      const list = wordList(d, section, key);
      list.splice(list.indexOf(value), 1);
    });
  }

  // --- Aperçu : décision du moteur commun, jamais calculée ici -------------------------------------

  setQuery(change: Partial<{ media_type: 'movie' | 'episode'; tmdb: string; season: number; episode: number }>): void {
    this.query.update(q => ({ ...q, ...change }));
    this.schedulePreview(0);
  }

  setNumber(field: 'season' | 'episode', value: string): void {
    const number = Number.parseInt(value, 10);
    if (Number.isInteger(number) && number >= 0) this.setQuery({ [field]: number });
  }

  schedulePreview(delay = 600): void {
    if (this.previewTimer) clearTimeout(this.previewTimer);
    if (!/^[1-9]\d{0,9}$/.test(this.query().tmdb)) return;
    this.previewTimer = setTimeout(() => void this.runPreview(), delay);
  }

  async runPreview(): Promise<void> {
    const draft = this.store.draft;
    if (!draft) return;
    const q = this.query();
    const request: AggregatorPreviewRequest = { preferences: draft, media_type: q.media_type, tmdb: q.tmdb,
      ...(q.media_type === 'episode' ? { season: q.season, episode: q.episode } : {}) };
    this.previewing.set(true);
    try {
      this.preview.set(await this.draftService.api().preview(request));
      this.previewError.set(null);
    } catch (error) {
      this.previewError.set(error instanceof ApiError ? (error.body.error ?? error.body.status) : 'aperçu impossible');
    } finally {
      this.previewing.set(false);
    }
  }

  refusalLabel(reason: string): string {
    return (REFUSALS as Record<string, string | undefined>)[reason] ?? reason;
  }

  ago(seconds: number | null): string {
    if (!seconds) return 'jamais';
    const minutes = Math.round((Date.now() / 1000 - seconds) / 60);
    if (minutes < 1) return 'à l’instant';
    if (minutes < 60) return `il y a ${minutes} min`;
    const hours = Math.round(minutes / 60);
    return hours < 48 ? `il y a ${hours} h` : `il y a ${Math.round(hours / 24)} j`;
  }
}
