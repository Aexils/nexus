import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { SESSION_COOKIE, configured, cookieValue, readSession, sameToken, sessionConfig } from './session';

/** Écriture : origine autorisée, session valide et jeton anti-CSRF. Réservée aux routes qui le
 *  déclarent (@UseGuards) : les autres applications de Nexus ne changent pas de règles. */
@Injectable()
export class WriteGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const config = sessionConfig();
    if (!configured(config)) {
      throw new ServiceUnavailableException({ status: 'unavailable', error: 'authentification non configurée' });
    }
    const request = context.switchToHttp().getRequest<Request>();
    // Le navigateur envoie toujours Origin sur PUT/POST ; absente ou étrangère : refus (CSRF).
    const origin = request.headers.origin;
    if (!origin || !config.origins.includes(origin)) {
      throw new ForbiddenException({ status: 'csrf', error: 'origine non autorisée' });
    }
    const session = readSession(cookieValue(request.headers.cookie, SESSION_COOKIE), config.secret);
    if (!session) throw new UnauthorizedException({ status: 'unauthenticated' });
    const header = request.headers['x-csrf-token'];
    if (!sameToken(Array.isArray(header) ? header[0] : header, session.csrf)) {
      throw new ForbiddenException({ status: 'csrf', error: 'jeton anti-CSRF absent ou faux' });
    }
    return true;
  }
}
