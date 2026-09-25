import {
  Body, Controller, Delete, Get, Param, Patch, Req, Res,
  BadRequestException, ServiceUnavailableException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Readable } from 'node:stream';
import { TytoStoreService } from './tyto-store.service';
import { TytoService } from './tyto.service';
import { TytoMode, TytoModeState, TytoSettings } from '@nexus/shared-types';

const MODES: TytoMode[] = ['off', 'silent', 'armed'];
const TYTO_URL = process.env['TYTO_URL'] ?? '';

// Les segments viennent de l'URL : gabarit exact, jamais de normalisation de
// chemin. Tyto revérifie de son côté — deux barrières valent mieux qu'une.
const SAFE_DAY = /^\d{4}-\d{2}-\d{2}$/;
const SAFE_FILE = /^[0-9-]{1,32}\.m4a$/;

interface SetModeBody {
  mode: TytoMode;
  /** Désarmement temporaire : réarmement automatique après N heures. */
  hours?: number;
  source?: string;
}

@Controller('tyto')
export class TytoController {
  constructor(
    private readonly store: TytoStoreService,
    private readonly svc: TytoService,
  ) {}

  /**
   * Consommé par DEUX clients : le dashboard, et Tyto lui-même qui va chercher
   * son mode toutes les 15 s (il tourne hors cluster et n'est pas joignable).
   */
  @Get('mode')
  getMode(): TytoModeState {
    return this.store.get();
  }

  @Patch('mode')
  setMode(@Body() body: SetModeBody): TytoModeState {
    if (!MODES.includes(body?.mode)) {
      throw new BadRequestException(`mode invalide (attendu : ${MODES.join(', ')})`);
    }
    let until: number | null = null;
    if (body.hours !== undefined && body.hours !== null) {
      const h = Number(body.hours);
      if (!Number.isFinite(h) || h <= 0 || h > 168) {
        throw new BadRequestException('hours doit être compris entre 0 et 168');
      }
      until = Date.now() + h * 3600_000;
    }
    const state = this.store.set(body.mode, until, body.source ?? 'dashboard');
    this.svc.refreshAfterModeChange();
    return state;
  }

  /**
   * Réglages de détection. Servis au même sondage que le mode (voir GET /mode)
   * pour que Tyto n'ait qu'un aller-retour ; ce PATCH sert au dashboard.
   * Les bornes sont appliquées dans le store — ici on ne fait que router.
   */
  @Patch('settings')
  setSettings(@Body() body: Partial<TytoSettings> & { reset?: boolean }): TytoModeState {
    const state = body?.reset
      ? this.store.resetSettings()
      : this.store.setSettings(body ?? {});
    this.svc.refreshAfterModeChange();
    return state;
  }

  @Get('recordings')
  async recordings(): Promise<unknown> {
    const r = await this.fetchTyto('/recordings');
    return r.json();
  }

  /** Supprime une piste (fichier + sa ligne d'événement, côté Tyto). */
  @Delete('audio/:day/:file')
  async deleteOne(@Param('day') day: string, @Param('file') file: string): Promise<unknown> {
    if (!SAFE_DAY.test(day) || !SAFE_FILE.test(file)) {
      throw new BadRequestException('nom invalide');
    }
    const r = await this.fetchTyto(`/audio/${day}/${file}`, undefined, 'DELETE');
    return r.json();
  }

  /**
   * Vide toutes les pistes. Destructif et sans retour : l'UI doit demander une
   * confirmation explicite. Pensé pour l'après-rodage, quand on jette les faux
   * positifs d'une nuit d'essai.
   */
  @Delete('recordings')
  async deleteAll(): Promise<unknown> {
    const r = await this.fetchTyto('/recordings', undefined, 'DELETE');
    return r.json();
  }

  /**
   * Relais des pistes. On RETRANSMET l'en-tête Range et le 206 : sans ça, pas
   * de déplacement dans la piste, et Safari refuse même de lancer la lecture.
   */
  @Get('audio/:day/:file')
  async audio(
    @Param('day') day: string,
    @Param('file') file: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (!SAFE_DAY.test(day) || !SAFE_FILE.test(file)) {
      throw new BadRequestException('nom invalide');
    }
    const range = req.headers.range;
    const upstream = await this.fetchTyto(
      `/audio/${day}/${file}`, range ? { Range: range } : undefined);

    res.status(upstream.status);
    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    if (!upstream.body) { res.end(); return; }
    this.pipeSafely(upstream.body, res);
  }

  /**
   * Écoute en direct : flux ADTS sans fin. Pas de Content-Length, et on coupe
   * le lien amont dès que le navigateur ferme — sinon ffmpeg tournerait
   * indéfiniment sur l'hôte pour un auditeur parti.
   */
  @Get('live')
  async live(@Req() req: Request, @Res() res: Response): Promise<void> {
    const ac = new AbortController();
    // ⚠ On écoute `res` et PAS `req` : `req` émet 'close' aussi quand la réponse
    // se termine normalement (une requête GET n'a pas de corps). Aborter à ce
    // moment-là déclenche un AbortError sur le flux déjà consommé — et cette
    // erreur, non gérée, TUE le processus Node. Le garde `writableEnded`
    // distingue « le navigateur a fermé » de « on a fini de répondre ».
    res.on('close', () => { if (!res.writableEnded) ac.abort(); });

    let upstream: globalThis.Response;
    try {
      upstream = await fetch(`${TYTO_URL}/live`, { signal: ac.signal });
    } catch (e) {
      throw new ServiceUnavailableException(`Tyto injoignable : ${(e as Error).message}`);
    }
    if (!upstream.ok) {
      // 409 = système éteint, micro relâché. On le laisse passer tel quel :
      // l'UI doit pouvoir dire « allume d'abord » plutôt que « erreur ».
      res.status(upstream.status).json(await upstream.json().catch(() => ({})));
      return;
    }
    res.status(200);
    res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'audio/aac');
    res.setHeader('Cache-Control', 'no-store');
    if (!upstream.body) { res.end(); return; }
    this.pipeSafely(upstream.body, res);
  }

  /**
   * Relaie un flux amont vers la réponse. Un flux coupé (auditeur parti, abort,
   * EPIPE) est une situation NORMALE ici : sans gestionnaire, l'erreur remonte
   * en 'error' non géré et arrête le processus.
   */
  private pipeSafely(body: unknown, res: Response): void {
    const stream = Readable.fromWeb(body as never);
    stream.on('error', () => { if (!res.writableEnded) res.end(); });
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  }

  private async fetchTyto(path: string, headers?: Record<string, string>, method = 'GET') {
    if (!TYTO_URL) throw new ServiceUnavailableException('TYTO_URL non configurée');
    try {
      return await fetch(`${TYTO_URL}${path}`, {
        method, headers, signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      throw new ServiceUnavailableException(`Tyto injoignable : ${(e as Error).message}`);
    }
  }
}
