import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthController } from '../auth/auth.controller';
import { hashPassword } from '../auth/session';
import { WriteGuard } from '../auth/write.guard';
import { AggregatorController } from './aggregator.controller';
import { AggregatorService } from './aggregator.service';
import { KaggReply } from './kagg-client';

const ORIGIN = 'http://nexus.test';
const PREFS = { schema: 1, active_profile: 'preferred' };

type Fake = { replies: (KaggReply | Error)[]; calls: { method: string; path: string; body?: unknown }[] };

async function start(fake: Fake, env: Record<string, string | undefined>) {
  Object.assign(process.env, env);
  const service = new AggregatorService(async (method, path, body) => {
    fake.calls.push({ method, path, body });
    const next = fake.replies.shift() ?? { status: 200, body: {} };
    if (next instanceof Error) throw next;
    return next;
  });
  const module = await Test.createTestingModule({
    controllers: [AggregatorController, AuthController],
    providers: [WriteGuard, { provide: AggregatorService, useValue: service }],
  }).compile();
  const app: INestApplication = module.createNestApplication({ logger: false });
  app.setGlobalPrefix('api');
  await app.listen(0);
  const base = await app.getUrl();
  const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
    fetch(base.replace('[::1]', '127.0.0.1') + path, {
      method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { app, call };
}

const CONFIGURED = {
  NEXUS_ADMIN_PASSWORD_HASH: hashPassword('secret-test', 1024),
  NEXUS_SESSION_SECRET: 's'.repeat(40),
  NEXUS_WRITE_ORIGINS: ORIGIN,
};

describe('routes Aggregator de Nexus', () => {
  let close: (() => Promise<void>) | null = null;
  afterEach(async () => {
    await close?.();
    close = null;
  });

  async function login(call: Awaited<ReturnType<typeof start>>['call']) {
    const res = await call('POST', '/api/auth/login', { password: 'secret-test' }, { Origin: ORIGIN });
    expect(res.status).toBe(200);
    const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0];
    return { cookie, csrf: ((await res.json()) as { csrf: string }).csrf };
  }

  it('lit les préférences et relaie l’aperçu sans session (lecture seule)', async () => {
    const fake: Fake = { replies: [{ status: 200, body: { version: 0, preferences: PREFS } }, { status: 200, body: { autoplay: [] } }], calls: [] };
    const { app, call } = await start(fake, CONFIGURED);
    close = () => app.close();
    expect(await (await call('GET', '/api/aggregator/preferences')).json()).toEqual({ version: 0, preferences: PREFS });
    const preview = await call('POST', '/api/aggregator/preview', { preferences: PREFS, media_type: 'movie', tmdb: '1' });
    expect(preview.status).toBe(200);
    expect(fake.calls.map(c => `${c.method} ${c.path}`)).toEqual(['GET /v1/preferences', 'POST /v1/preferences/preview']);
  });

  it('refuse une écriture sans session, d’une autre origine ou sans jeton anti-CSRF', async () => {
    const fake: Fake = { replies: [], calls: [] };
    const { app, call } = await start(fake, CONFIGURED);
    close = () => app.close();
    const body = { version: 0, preferences: PREFS };
    expect((await call('PUT', '/api/aggregator/preferences', body, { Origin: ORIGIN })).status).toBe(401);
    const { cookie, csrf } = await login(call);
    expect((await call('PUT', '/api/aggregator/preferences', body, { Origin: 'http://evil.test', Cookie: cookie, 'X-CSRF-Token': csrf })).status).toBe(403);
    expect((await call('PUT', '/api/aggregator/preferences', body, { Cookie: cookie, 'X-CSRF-Token': csrf })).status).toBe(403);
    expect((await call('PUT', '/api/aggregator/preferences', body, { Origin: ORIGIN, Cookie: cookie })).status).toBe(403);
    expect((await call('PUT', '/api/aggregator/preferences', body, { Origin: ORIGIN, Cookie: cookie, 'X-CSRF-Token': 'faux' })).status).toBe(403);
    expect(fake.calls).toEqual([]); // rien n'a atteint kube-aggregator
  });

  it('relaie version, 409, 422 et 403 du backend, et 503 s’il est injoignable', async () => {
    const fake: Fake = {
      replies: [
        { status: 200, body: { version: 1, preferences: PREFS, updated_by: 'nexus' } },
        { status: 409, body: { status: 'conflict', version: 4 } },
        { status: 422, body: { status: 'invalid', error: 'profiles.salon.rules : mot inconnu : 4K SDRR' } },
        { status: 403, body: { status: 'forbidden' } },
        new Error('connect ECONNREFUSED'),
      ],
      calls: [],
    };
    const { app, call } = await start(fake, CONFIGURED);
    close = () => app.close();
    const { cookie, csrf } = await login(call);
    const headers = { Origin: ORIGIN, Cookie: cookie, 'X-CSRF-Token': csrf };
    const put = () => call('PUT', '/api/aggregator/preferences', { version: 0, preferences: PREFS }, headers);
    const ok = await put();
    expect([ok.status, ((await ok.json()) as { version: number }).version]).toEqual([200, 1]);
    expect(fake.calls[0]).toEqual({ method: 'PUT', path: '/v1/preferences', body: { version: 0, preferences: PREFS } });
    const conflict = await put();
    expect([conflict.status, await conflict.json()]).toEqual([409, { status: 'conflict', version: 4 }]);
    const invalid = await put();
    expect(invalid.status).toBe(422);
    expect(((await invalid.json()) as { error: string }).error).toContain('mot inconnu');
    expect((await put()).status).toBe(403);
    const down = await put();
    expect([down.status, ((await down.json()) as { status: string }).status]).toEqual([503, 'unavailable']);
    expect((await call('PUT', '/api/aggregator/preferences', { preferences: PREFS }, headers)).status).toBe(400);
  });

  it('sans authentification configurée : connexion et écriture désactivées', async () => {
    const fake: Fake = { replies: [], calls: [] };
    const { app, call } = await start(fake, { NEXUS_ADMIN_PASSWORD_HASH: '', NEXUS_SESSION_SECRET: '', NEXUS_WRITE_ORIGINS: '' });
    close = () => app.close();
    expect((await call('POST', '/api/auth/login', { password: 'x' }, { Origin: ORIGIN })).status).toBe(503);
    expect((await call('PUT', '/api/aggregator/preferences', { version: 0, preferences: PREFS }, { Origin: ORIGIN })).status).toBe(503);
    expect(await (await call('GET', '/api/auth/session')).json()).toEqual({ authenticated: false, csrf: null, configured: false });
    expect(fake.calls).toEqual([]);
  });

  it('un HTTP 200 sans nouvelle version confirmée ne devient pas un succès', async () => {
    const fake: Fake = { replies: [{ status: 200, body: { version: 0, preferences: PREFS } }], calls: [] };
    const { app, call } = await start(fake, CONFIGURED);
    close = () => app.close();
    const { cookie, csrf } = await login(call);
    const response = await call('PUT', '/api/aggregator/preferences',
      { version: 0, preferences: { ...PREFS, playback: { confirm_duration: 10 } } },
      { Origin: ORIGIN, Cookie: cookie, 'X-CSRF-Token': csrf });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ status: 'unavailable' });
  });

  it('limite les tentatives de connexion et refuse une connexion d’une autre origine', async () => {
    const { app, call } = await start({ replies: [], calls: [] }, CONFIGURED);
    close = () => app.close();
    expect((await call('POST', '/api/auth/login', { password: 'secret-test' }, { Origin: 'http://evil.test' })).status).toBe(403);
    for (let i = 0; i < 5; i++) {
      expect((await call('POST', '/api/auth/login', { password: 'faux' }, { Origin: ORIGIN })).status).toBe(401);
    }
    expect((await call('POST', '/api/auth/login', { password: 'secret-test' }, { Origin: ORIGIN })).status).toBe(429);
  });
});
