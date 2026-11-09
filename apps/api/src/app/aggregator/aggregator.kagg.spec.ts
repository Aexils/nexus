// Intégration RÉELLE et optionnelle (KAGG_E2E=1) : Nexus -> kube-aggregator en mTLS.
// Seules des lectures et un aperçu ; l'écriture complète (session, origine, jeton) doit être
// refusée par le backend (certificat non autorisé) : aucune préférence n'est modifiée.
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthController } from '../auth/auth.controller';
import { hashPassword } from '../auth/session';
import { WriteGuard } from '../auth/write.guard';
import { AggregatorController } from './aggregator.controller';
import { AggregatorService } from './aggregator.service';
import { httpsTransport, kaggConfig } from './kagg-client';

const run = process.env['KAGG_E2E'] === '1' ? describe : describe.skip;
const ORIGIN = 'http://nexus.e2e';

run('Nexus -> kube-aggregator (réel, sans écriture)', () => {
  let app: INestApplication;
  let base: string;

  beforeAll(async () => {
    Object.assign(process.env, {
      NEXUS_ADMIN_PASSWORD_HASH: hashPassword('essai-local', 1024),
      NEXUS_SESSION_SECRET: 'e'.repeat(40), NEXUS_WRITE_ORIGINS: ORIGIN,
    });
    const config = kaggConfig();
    if (!config) throw new Error('KAGG_URL et KAGG_TLS_DIR requis');
    const module = await Test.createTestingModule({
      controllers: [AggregatorController, AuthController],
      providers: [WriteGuard, { provide: AggregatorService, useValue: new AggregatorService(httpsTransport(config)) }],
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    await app.listen(0);
    base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  });
  afterAll(() => app?.close());

  const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
    fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...headers },
                         body: body === undefined ? undefined : JSON.stringify(body) });

  it('lit, prévisualise, et l’écriture complète est refusée par le backend', async () => {
    const read = await call('GET', '/api/aggregator/preferences');
    expect(read.status).toBe(200);
    const state = (await read.json()) as { version: number; preferences: Record<string, unknown> };
    console.log('version', state.version, 'profil', state.preferences['active_profile']);

    const preview = await call('POST', '/api/aggregator/preview',
      { preferences: { ...state.preferences, provider_order: ['vstream', 'jellyfin'] }, media_type: 'movie', tmdb: '27205' });
    const shown = (await preview.json()) as { releases: { refusal: string | null }[]; autoplay: string[]; refused: object };
    console.log('aperçu', preview.status, shown.releases.length, 'releases, autoplay', shown.autoplay.length, 'refus', shown.refused);
    expect(preview.status).toBe(200);

    const invalid = await call('POST', '/api/aggregator/preview',
      { preferences: { ...state.preferences, unknown: 'peut-être' }, media_type: 'movie', tmdb: '27205' });
    expect(invalid.status).toBe(422);

    const login = await call('POST', '/api/auth/login', { password: 'essai-local' }, { Origin: ORIGIN });
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
    const { csrf } = (await login.json()) as { csrf: string };
    const put = await call('PUT', '/api/aggregator/preferences', { version: state.version, preferences: state.preferences },
                           { Origin: ORIGIN, Cookie: cookie, 'X-CSRF-Token': csrf });
    console.log('PUT complet', put.status, await put.json());
    expect(put.status).toBe(403);

    const after = (await (await call('GET', '/api/aggregator/preferences')).json()) as { version: number };
    expect(after.version).toBe(state.version);
  });
});
