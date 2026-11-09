import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

// Session d'administration de Nexus, limitée aux routes d'écriture qui la demandent (préférences
// Aggregator). Aucune dépendance : mot de passe scrypt, jeton signé HMAC, jeton anti-CSRF lié.

export const SESSION_COOKIE = 'nexus_session';
export const SESSION_TTL_MS = 12 * 3600_000;

export interface SessionConfig {
  /** « scrypt$N$sel$empreinte » (hex), produit par hashPassword. Absent : connexion désactivée. */
  passwordHash?: string;
  /** Secret de signature (32 octets au moins). Absent : connexion désactivée. */
  secret?: string;
  /** Origines autorisées à écrire (ex. http://nexus.10.10.10.210.nip.io), jamais « * ». */
  origins: string[];
  /** Cookie Secure : vrai dès que Nexus est servi en HTTPS. */
  secureCookie: boolean;
}

export interface Session {
  exp: number;
  csrf: string;
}

export function sessionConfig(env: NodeJS.ProcessEnv = process.env): SessionConfig {
  return {
    passwordHash: env['NEXUS_ADMIN_PASSWORD_HASH'] || undefined,
    secret: env['NEXUS_SESSION_SECRET'] || undefined,
    origins: (env['NEXUS_WRITE_ORIGINS'] ?? '').split(',').map(o => o.trim()).filter(o => o && o !== '*'),
    secureCookie: env['NEXUS_SECURE_COOKIE'] === 'true',
  };
}

export function configured(config: SessionConfig): boolean {
  return !!config.passwordHash && !!config.secret && config.secret.length >= 32 && config.origins.length > 0;
}

export function hashPassword(password: string, cost = 16384): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32, { N: cost });
  return `scrypt$${cost}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function checkPassword(password: string, stored: string | undefined): boolean {
  const parts = (stored ?? '').split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;
  const cost = Number(parts[1]);
  if (!Number.isInteger(cost) || cost < 1024 || cost > 1 << 20) return false;
  const expected = Buffer.from(parts[3], 'hex');
  if (expected.length !== 32) return false;
  const actual = scryptSync(password, Buffer.from(parts[2], 'hex'), 32, { N: cost });
  return timingSafeEqual(actual, expected);
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function issueSession(secret: string, now = Date.now()): { token: string; session: Session } {
  const session: Session = { exp: now + SESSION_TTL_MS, csrf: randomBytes(24).toString('base64url') };
  const payload = Buffer.from(JSON.stringify(session)).toString('base64url');
  return { token: `${payload}.${sign(payload, secret)}`, session };
}

export function readSession(token: string | undefined, secret: string | undefined, now = Date.now()): Session | null {
  if (!token || !secret) return null;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra !== undefined) return null;
  const expected = Buffer.from(sign(payload, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Session;
    if (typeof session.exp !== 'number' || typeof session.csrf !== 'string' || session.exp <= now) return null;
    return session;
  } catch {
    return null;
  }
}

export function cookieValue(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return undefined;
}

export function sessionCookie(token: string, config: SessionConfig): string {
  // HttpOnly : invisible du JavaScript ; SameSite=Strict : jamais envoyé depuis un autre site.
  const secure = config.secureCookie ? '; Secure' : '';
  return `${SESSION_COOKIE}=${token}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}${secure}`;
}

export function clearedCookie(config: SessionConfig): string {
  return `${SESSION_COOKIE}=; Path=/api; HttpOnly; SameSite=Strict; Max-Age=0${config.secureCookie ? '; Secure' : ''}`;
}

/** Même valeur, en temps constant (jeton anti-CSRF). */
export function sameToken(a: string | undefined, b: string): boolean {
  if (!a) return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
