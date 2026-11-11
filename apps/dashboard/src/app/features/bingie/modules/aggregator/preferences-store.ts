import {
  AGGREGATOR_BUILTIN_PROFILES,
  AggregatorError,
  AggregatorPreferences,
  AggregatorPreferencesState,
  AggregatorPreview,
  AggregatorPreviewRequest,
  AggregatorTier,
} from '@nexus/shared-types';

// État de l'éditeur de préférences : brouillon local, version lue, état de synchronisation.
// Pur (aucune dépendance Angular) : la page l'enveloppe dans des signaux.

export type SyncStatus =
  | 'loading' | 'synced' | 'dirty' | 'saving'
  | 'conflict' | 'invalid' | 'forbidden' | 'unavailable' | 'unauthenticated';

export interface PreferencesApi {
  get(): Promise<AggregatorPreferencesState>;
  put(version: number, preferences: AggregatorPreferences): Promise<AggregatorPreferencesState>;
  preview(request: AggregatorPreviewRequest): Promise<AggregatorPreview>;
}

/** Erreur HTTP portant le corps relayé par Nexus. */
export class ApiError extends Error {
  constructor(readonly httpStatus: number, readonly body: AggregatorError) {
    super(body.error ?? body.status);
  }
}

export const TIERS: AggregatorTier[] = ['jellyfin', 'vstream', 'pov', 'other'];
export const TIER_LABELS: Record<AggregatorTier, string> = { jellyfin: 'Jellyfin', vstream: 'vStream', pov: 'POV', other: 'Autres' };

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function sameDocument(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v).sort().map(k => [k, (v as Record<string, unknown>)[k]]))
      : v);
}

export function slug(label: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = label.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'profil';
  const reserved = new Set([...Object.keys(AGGREGATOR_BUILTIN_PROFILES), 'none', 'custom']);
  let key = /^[a-z0-9]/.test(base) ? base : `p-${base}`;
  for (let n = 2; used.has(key) || reserved.has(key); n++) key = `${base.slice(0, 20)}-${n}`;
  return key;
}

export class PreferencesStore {
  server: AggregatorPreferencesState | null = null;
  draft: AggregatorPreferences | null = null;
  status: SyncStatus = 'loading';
  message: string | null = null;
  /** Version courante du backend lors d'un conflit (409). */
  conflictVersion: number | null = null;

  constructor(private readonly api: PreferencesApi, private readonly onChange: () => void = () => undefined) {}

  get dirty(): boolean {
    return !!this.server && !!this.draft && !sameDocument(this.server.preferences, this.draft);
  }

  private set(status: SyncStatus, message: string | null = null): void {
    this.status = status;
    this.message = message;
    this.onChange();
  }

  async load(): Promise<void> {
    this.set('loading');
    try {
      this.server = await this.api.get();
      this.draft = clone(this.server.preferences);
      this.conflictVersion = null;
      this.set('synced');
    } catch (error) {
      this.fail(error);
    }
  }

  /** Toute modification passe ici : le brouillon change, le serveur jamais avant « Enregistrer ». */
  edit(change: (draft: AggregatorPreferences) => void): void {
    if (!this.draft) return;
    change(this.draft);
    this.set(this.dirty ? 'dirty' : 'synced');
  }

  discard(): void {
    if (!this.server) return;
    this.draft = clone(this.server.preferences);
    this.set('synced');
  }

  async save(): Promise<void> {
    if (!this.server || !this.draft || !this.dirty) return;
    this.set('saving');
    try {
      this.server = await this.api.put(this.server.version, this.draft);
      this.draft = clone(this.server.preferences);
      this.set('synced');
    } catch (error) {
      this.fail(error);
    }
  }

  private fail(error: unknown): void {
    if (!(error instanceof ApiError)) return this.set('unavailable', 'kube-aggregator injoignable');
    const { httpStatus, body } = error;
    if (httpStatus === 409) {
      // Modifié ailleurs (Kodi, autre onglet) : jamais d'écrasement, le brouillon est conservé.
      this.conflictVersion = body.version ?? null;
      return this.set('conflict', 'Modifié ailleurs depuis le chargement : recharger avant d’enregistrer.');
    }
    if (httpStatus === 422) return this.set('invalid', body.error ?? 'document refusé');
    if (httpStatus === 401) return this.set('unauthenticated', 'Connexion requise pour enregistrer.');
    if (httpStatus === 403 && body.status === 'forbidden') {
      return this.set('forbidden', 'Nexus n’est pas autorisé à écrire dans kube-aggregator.');
    }
    if (httpStatus === 403) return this.set('unauthenticated', 'Session expirée : se reconnecter.');
    this.set('unavailable', body.error ?? 'kube-aggregator injoignable');
  }

  // --- Profils -----------------------------------------------------------------------------

  createProfile(label: string, rules = '1080p'): string {
    const key = slug(label, Object.keys(this.draft?.profiles ?? {}));
    this.edit(d => { d.profiles[key] = { label: label.trim() || 'Nouveau profil', rules }; });
    return key;
  }

  duplicateProfile(key: string): string | null {
    const source = this.draft?.profiles[key] ?? AGGREGATOR_BUILTIN_PROFILES[key];
    if (!source) return null;
    return this.createProfile(`${source.label} (copie)`.slice(0, 40), source.rules);
  }

  renameProfile(key: string, label: string): void {
    this.edit(d => { if (d.profiles[key]) d.profiles[key].label = label.slice(0, 40); });
  }

  deleteProfile(key: string): void {
    this.edit(d => {
      delete d.profiles[key];
      if (d.active_profile === key) d.active_profile = 'preferred';
    });
  }

  setActive(key: string): void {
    this.edit(d => { d.active_profile = key; });
  }

  setRules(key: string, rules: string[]): void {
    this.edit(d => { if (d.profiles[key]) d.profiles[key].rules = rules.map(r => r.trim()).filter(Boolean).join(' | '); });
  }

  // --- Compatibilité matérielle -----------------------------------------------------------

  /** Standard retire le champ (comportement actuel, et document lisible par Kodi beta10) ;
   *  seul le profil Raspberry Pi 5 l'écrit. Aucun autre champ de lecture n'est touché. */
  setHardwareProfile(profile: 'standard' | 'rpi5'): void {
    this.edit(d => {
      if (profile === 'rpi5') {
        (d.playback ??= {}).hardware_profile = 'rpi5';
        return;
      }
      if (!d.playback) return;
      delete d.playback.hardware_profile;
      if (!Object.keys(d.playback).length) delete d.playback;
    });
  }

  // --- Fournisseurs ----------------------------------------------------------------------------

  setProviderOrder(order: AggregatorTier[]): void {
    this.edit(d => { d.provider_order = [...order]; });
  }

  toggleProvider(tier: AggregatorTier): void {
    this.edit(d => {
      const on = d.provider_order.includes(tier);
      if (on && d.provider_order.length === 1) return; // au moins une source
      d.provider_order = on ? d.provider_order.filter(t => t !== tier) : [...d.provider_order, tier];
    });
  }
}
