import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthController } from '../auth/auth.controller';
import { hashPassword } from '../auth/session';
import { WriteGuard } from '../auth/write.guard';
import { TraktController } from './trakt.controller';
import { TraktService } from './trakt.service';

const ORIGIN = 'http://nexus.test';

describe('Trakt via Nexus : écritures protégées, lectures publiques', () => {
  let app: INestApplication;
  let base: string;
  const calls: string[] = [];

  beforeAll(async () => {
    Object.assign(process.env, {
      NEXUS_ADMIN_PASSWORD_HASH: hashPassword('secret-test', 1024),
      NEXUS_SESSION_SECRET: 't'.repeat(40), NEXUS_WRITE_ORIGINS: ORIGIN,
    });
    const fake = {
      lists: async () => { calls.push('lists'); return []; },
      revokeDevice: async (device: string) => { calls.push('revoke ' + device); },
    };
    const module = await Test.createTestingModule({
      controllers: [TraktController, AuthController],
      providers: [WriteGuard, { provide: TraktService, useValue: fake }],
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    await app.listen(0);
    base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  });
  afterAll(() => app.close());

  const call = (method: string, path: string, headers: Record<string, string> = {}, body?: unknown) =>
    fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...headers },
                         body: body === undefined ? undefined : JSON.stringify(body) });

  it('lecture sans session, écriture refusée sans session puis acceptée avec', async () => {
    expect((await call('GET', '/api/trakt/lists')).status).toBe(200);
    expect((await call('DELETE', '/api/trakt/devices/kodi-test', { Origin: ORIGIN })).status).toBe(401);
    expect(calls).toEqual(['lists']); // le refus n'a jamais atteint kube-trakt
    const login = await call('POST', '/api/auth/login', { Origin: ORIGIN }, { password: 'secret-test' });
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
    const { csrf } = (await login.json()) as { csrf: string };
    const ok = await call('DELETE', '/api/trakt/devices/kodi-test', { Origin: ORIGIN, Cookie: cookie, 'X-CSRF-Token': csrf });
    expect(ok.status).toBeLessThan(300);
    expect(calls).toEqual(['lists', 'revoke kodi-test']);
  });
});
