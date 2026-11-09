import { Body, Controller, ForbiddenException, Get, HttpCode, HttpException, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { NexusSession } from '@nexus/shared-types';
import {
  SESSION_COOKIE,
  checkPassword,
  clearedCookie,
  configured,
  cookieValue,
  issueSession,
  readSession,
  sessionCookie,
  sessionConfig,
} from './session';

const MAX_FAILURES = 5;
const WINDOW_MS = 10 * 60_000;

@Controller('auth')
export class AuthController {
  /** Échecs récents par adresse : au-delà, connexion refusée un moment (force brute). */
  private readonly failures = new Map<string, number[]>();

  @Get('session')
  session(@Req() request: Request): NexusSession {
    const config = sessionConfig();
    const session = readSession(cookieValue(request.headers.cookie, SESSION_COOKIE), config.secret);
    return { authenticated: !!session, csrf: session?.csrf ?? null, configured: configured(config) };
  }

  @Post('login')
  @HttpCode(200)
  login(@Req() request: Request, @Body('password') password: unknown, @Res({ passthrough: true }) response: Response): NexusSession {
    const config = sessionConfig();
    if (!configured(config)) {
      throw new HttpException({ status: 'unavailable', error: 'authentification non configurée' }, 503);
    }
    if (!request.headers.origin || !config.origins.includes(request.headers.origin)) {
      throw new ForbiddenException({ status: 'csrf', error: 'origine non autorisée' });
    }
    const client = String(request.headers['x-real-ip'] ?? request.socket.remoteAddress ?? '?');
    const now = Date.now();
    const recent = (this.failures.get(client) ?? []).filter(at => now - at < WINDOW_MS);
    if (recent.length >= MAX_FAILURES) {
      throw new HttpException({ status: 'forbidden', error: 'trop de tentatives, réessayer plus tard' }, 429);
    }
    if (typeof password !== 'string' || password.length > 256 || !checkPassword(password, config.passwordHash)) {
      this.failures.set(client, [...recent, now]);
      throw new HttpException({ status: 'unauthenticated', error: 'mot de passe incorrect' }, 401);
    }
    this.failures.delete(client);
    const { token, session } = issueSession(config.secret as string, now);
    response.setHeader('Set-Cookie', sessionCookie(token, config));
    return { authenticated: true, csrf: session.csrf, configured: true };
  }

  @Post('logout')
  @HttpCode(204)
  logout(@Res({ passthrough: true }) response: Response): void {
    response.setHeader('Set-Cookie', clearedCookie(sessionConfig()));
  }
}
