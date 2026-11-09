import { checkPassword, configured, cookieValue, hashPassword, issueSession, readSession, sameToken, sessionConfig, sessionCookie } from './session';

const SECRET = 'x'.repeat(40);

describe('session d’administration', () => {
  it('vérifie un mot de passe scrypt et refuse tout autre', () => {
    const stored = hashPassword('correct horse', 1024);
    expect(checkPassword('correct horse', stored)).toBe(true);
    expect(checkPassword('Correct horse', stored)).toBe(false);
    expect(checkPassword('correct horse', 'scrypt$1$00$00')).toBe(false);
    expect(checkPassword('x', undefined)).toBe(false);
  });

  it('signe, expire et refuse un jeton altéré', () => {
    const { token, session } = issueSession(SECRET, 1000);
    expect(readSession(token, SECRET, 2000)).toEqual(session);
    expect(readSession(token, SECRET, session.exp + 1)).toBeNull();
    expect(readSession(token, 'y'.repeat(40), 2000)).toBeNull();
    const [payload, signature] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ exp: 9e15, csrf: session.csrf })).toString('base64url');
    expect(readSession(`${forged}.${signature}`, SECRET, 2000)).toBeNull();
    expect(readSession(`${payload}.${signature}.x`, SECRET, 2000)).toBeNull();
  });

  it('cookie HttpOnly, SameSite=Strict, limité à /api ; Secure si demandé', () => {
    const cookie = sessionCookie('t', { origins: ['https://n'], secureCookie: true });
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/api');
    expect(cookie).toContain('Secure');
    expect(cookieValue('a=1; nexus_session=abc.def', 'nexus_session')).toBe('abc.def');
  });

  it('jamais configurée avec une origine « * » ou un secret court', () => {
    const base = { NEXUS_ADMIN_PASSWORD_HASH: hashPassword('p', 1024), NEXUS_SESSION_SECRET: SECRET };
    expect(configured(sessionConfig({ ...base, NEXUS_WRITE_ORIGINS: 'http://nexus.local' }))).toBe(true);
    expect(configured(sessionConfig({ ...base, NEXUS_WRITE_ORIGINS: '*' }))).toBe(false);
    expect(configured(sessionConfig({ ...base, NEXUS_SESSION_SECRET: 'court', NEXUS_WRITE_ORIGINS: 'http://n' }))).toBe(false);
    expect(sameToken(undefined, 'a')).toBe(false);
    expect(sameToken('ab', 'ab')).toBe(true);
  });
});
