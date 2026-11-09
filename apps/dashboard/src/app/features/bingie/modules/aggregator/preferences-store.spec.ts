import { AggregatorPreferences, AggregatorPreferencesState } from '@nexus/shared-types';
import { ApiError, PreferencesApi, PreferencesStore, sameDocument, slug } from './preferences-store';

function prefs(): AggregatorPreferences {
  return {
    schema: 1, active_profile: 'preferred', profiles: {}, profile_strict: false,
    provider_order: ['jellyfin', 'vstream', 'pov', 'other'], unknown: 'accept',
    strict: { min_resolution: null, required_languages: [], allowed_codecs: [], hdr: 'any', min_size_gb: null,
              max_size_gb: null, require_known_availability: false, excluded_formats: ['cam', 'telesync'] },
    soft: { preferred_resolution: null, preferred_languages: [], preferred_codecs: [] },
  };
}

function api(responses: Partial<Record<'get' | 'put', (AggregatorPreferencesState | Error)[]>>) {
  const calls: { version: number; preferences: AggregatorPreferences }[] = [];
  const next = (list: (AggregatorPreferencesState | Error)[] | undefined) => {
    const value = list?.shift();
    if (!value) throw new Error('aucune réponse');
    if (value instanceof Error) throw value;
    return value;
  };
  const fake: PreferencesApi = {
    get: async () => next(responses.get),
    put: async (version, preferences) => { calls.push({ version, preferences: JSON.parse(JSON.stringify(preferences)) }); return next(responses.put); },
    preview: async () => ({ profile: 'preferred', rules: [], autoplay: [], refused: {}, releases: [] }),
  };
  return { fake, calls };
}

const v0: AggregatorPreferencesState = { version: 0, updated_at: null, updated_by: null, preferences: prefs() };

describe('éditeur de préférences', () => {
  it('signale les modifications non enregistrées et les annule', async () => {
    const { fake } = api({ get: [v0] });
    const store = new PreferencesStore(fake);
    await store.load();
    expect([store.status, store.dirty]).toEqual(['synced', false]);
    store.edit(d => { d.unknown = 'reject'; });
    expect([store.status, store.dirty]).toEqual(['dirty', true]);
    store.edit(d => { d.unknown = 'accept'; });
    expect([store.status, store.dirty]).toEqual(['synced', false]); // revenu à l'identique
    store.edit(d => { d.profile_strict = true; });
    store.discard();
    expect(store.draft?.profile_strict).toBe(false);
  });

  it('enregistre avec la version lue, puis repart de la réponse du backend', async () => {
    const saved = { ...v0, version: 1, updated_by: 'nexus', preferences: { ...prefs(), unknown: 'reject' as const } };
    const { fake, calls } = api({ get: [v0], put: [saved] });
    const store = new PreferencesStore(fake);
    await store.load();
    store.edit(d => { d.unknown = 'reject'; });
    await store.save();
    expect(calls[0].version).toBe(0);
    expect([store.status, store.server?.version, store.dirty]).toEqual(['synced', 1, false]);
  });

  it('conflit 409 : brouillon conservé, aucun écrasement, rechargement demandé', async () => {
    const { fake, calls } = api({ get: [v0], put: [new ApiError(409, { status: 'conflict', version: 3 })] });
    const store = new PreferencesStore(fake);
    await store.load();
    store.edit(d => { d.profile_strict = true; });
    await store.save();
    expect([store.status, store.conflictVersion, store.draft?.profile_strict]).toEqual(['conflict', 3, true]);
    expect(calls).toHaveLength(1);
  });

  it('erreurs 422, 401, 403 et backend injoignable deviennent des états lisibles', async () => {
    const cases: [Error, string][] = [
      [new ApiError(422, { status: 'invalid', error: 'profiles.salon.rules : mot inconnu : SDRR' }), 'invalid'],
      [new ApiError(401, { status: 'unauthenticated' }), 'unauthenticated'],
      [new ApiError(403, { status: 'csrf' }), 'unauthenticated'],
      [new ApiError(403, { status: 'forbidden' }), 'forbidden'],
      [new ApiError(503, { status: 'unavailable' }), 'unavailable'],
      [new TypeError('Failed to fetch'), 'unavailable'],
    ];
    for (const [error, status] of cases) {
      const { fake } = api({ get: [v0], put: [error] });
      const store = new PreferencesStore(fake);
      await store.load();
      store.edit(d => { d.profile_strict = true; });
      await store.save();
      expect(store.status).toBe(status);
    }
    const { fake } = api({ get: [new ApiError(503, { status: 'unavailable', error: 'kube-aggregator injoignable' })] });
    const store = new PreferencesStore(fake);
    await store.load();
    expect([store.status, store.message]).toEqual(['unavailable', 'kube-aggregator injoignable']);
  });

  it('crée, duplique, renomme, active et supprime des profils', async () => {
    const { fake } = api({ get: [v0] });
    const store = new PreferencesStore(fake);
    await store.load();
    const salon = store.createProfile('Salon 4K', '4K SDR MULTI | 1080p fr');
    const copy = store.duplicateProfile('preferred') as string;
    expect(salon).toBe('salon-4k');
    expect(copy).toMatch(/^[a-z0-9][a-z0-9-]{0,31}$/);
    expect(store.draft?.profiles[copy]).toEqual({ label: '4K SDR MULTi → 4K HDR MULTi → 1080p SDR MULTi (copie)'.slice(0, 40).trim(),
                                                   rules: '4K SDR MULTI | 4K HDR MULTI | 1080p SDR MULTI' });
    store.renameProfile(salon, 'Salon');
    store.setActive(salon);
    store.setRules(salon, ['1080p fr', ' ', '720p']);
    expect(store.draft?.profiles[salon]).toEqual({ label: 'Salon', rules: '1080p fr | 720p' });
    store.deleteProfile(salon);
    expect([store.draft?.active_profile, salon in (store.draft?.profiles ?? {})]).toEqual(['preferred', false]);
  });

  it('réordonne les fournisseurs et en garde toujours au moins un', async () => {
    const { fake } = api({ get: [v0] });
    const store = new PreferencesStore(fake);
    await store.load();
    store.setProviderOrder(['vstream', 'jellyfin', 'pov', 'other']);
    for (const tier of ['jellyfin', 'pov', 'other', 'vstream'] as const) store.toggleProvider(tier);
    expect(store.draft?.provider_order).toEqual(['vstream']);
    store.toggleProvider('pov');
    expect(store.draft?.provider_order).toEqual(['vstream', 'pov']);
  });

  it('clés de profil sûres et uniques, jamais réservées', () => {
    expect(slug('Préféré', [])).toBe('prefere');
    expect(slug('preferred', [])).toBe('preferred-2');
    expect(slug('Salon', ['salon'])).toBe('salon-2');
    expect(sameDocument({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(true);
  });
});
