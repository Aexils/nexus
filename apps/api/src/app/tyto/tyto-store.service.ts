import { Injectable, Logger } from '@nestjs/common';
import Database from 'better-sqlite3';
import {
  TytoMode, TytoModeState, TytoSettings, TYTO_SETTINGS_BOUNDS,
} from '@nexus/shared-types';
import * as path from 'path';

// Le mode de Tyto est de l'état DURABLE : il doit survivre au restart du pod,
// sinon un simple rollout désarmerait la surveillance en silence. Même PVC que
// le Journal et les coupures (nexus-state en prod, cwd en dev).
const LOG_DB = process.env['LOG_DB_PATH'];
const DB_PATH = process.env['TYTO_DB_PATH']
  ?? path.join(LOG_DB ? path.dirname(LOG_DB) : process.cwd(), 'nexus-tyto.db');

// Une seule ligne, id figé : c'est un réglage, pas une collection.
const ROW_ID = 1;

// Valeurs de départ = celles éprouvées à la mise en service (2026-09-25).
const DEFAULTS: TytoSettings = {
  deltaDb: 12, hangoverS: 8, maxEventS: 300, prerollS: 10, micGain: 50,
};

/**
 * Borne chaque réglage. Sans ça, un delta à 0 fait enregistrer en continu
 * jusqu'à remplir /mnt/perso, et un pré-roll démesuré mange la RAM de l'hôte.
 * Une valeur hors bornes est ramenée dans l'intervalle, jamais rejetée : on
 * préfère un réglage approximatif à un service qui refuse de démarrer.
 */
function clampSettings(raw: Partial<TytoSettings>, base: TytoSettings): TytoSettings {
  const out = { ...base };
  for (const k of Object.keys(DEFAULTS) as (keyof TytoSettings)[]) {
    const v = raw[k];
    if (v === undefined || v === null || !Number.isFinite(Number(v))) continue;
    const b = TYTO_SETTINGS_BOUNDS[k];
    out[k] = Math.min(b.max, Math.max(b.min, Number(v)));
  }
  return out;
}

@Injectable()
export class TytoStoreService {
  private readonly logger = new Logger(TytoStoreService.name);
  private readonly db: Database.Database;

  constructor() {
    this.db = new Database(DB_PATH);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS mode (
        id         INTEGER PRIMARY KEY CHECK (id = 1),
        mode       TEXT    NOT NULL,
        until      INTEGER,              -- Unix ms ; NULL = permanent
        source     TEXT    NOT NULL,
        changed_at INTEGER NOT NULL,
        settings   TEXT
      );
    `);
    // Colonne ajoutée après coup : les bases créées avant les réglages à chaud
    // n'en ont pas. ALTER échoue si elle existe déjà — on l'ignore.
    try { this.db.exec(`ALTER TABLE mode ADD COLUMN settings TEXT`); } catch { /* déjà là */ }
    // Défaut 'armed' : en l'absence de consigne on surveille. Ne jamais
    // initialiser à 'off' — une base neuve désarmerait sans que personne ne l'ait demandé.
    this.db.prepare(
      `INSERT OR IGNORE INTO mode (id, mode, until, source, changed_at)
       VALUES (?, 'armed', NULL, 'défaut', ?)`
    ).run(ROW_ID, Date.now());
    this.logger.log(`Mode Tyto persisté dans ${DB_PATH}`);
  }

  /** Lit le mode en appliquant le réarmement automatique si l'échéance est passée. */
  get(): TytoModeState {
    const r = this.db.prepare(
      `SELECT mode, until, source, changed_at, settings FROM mode WHERE id = ?`
    ).get(ROW_ID) as {
      mode: TytoMode; until: number | null; source: string;
      changed_at: number; settings: string | null;
    };

    if (r.until !== null && Date.now() >= r.until) {
      // L'échéance est le garde-fou central : on ne compte pas sur l'utilisateur
      // pour se souvenir de réarmer avant de partir.
      this.logger.log(`Échéance atteinte (${new Date(r.until).toISOString()}) → réarmement`);
      return this.set('armed', null, 'réarmement auto');
    }
    return {
      mode: r.mode, until: r.until, source: r.source, changedAt: r.changed_at,
      settings: this.parseSettings(r.settings),
    };
  }

  private parseSettings(raw: string | null): TytoSettings {
    if (!raw) return { ...DEFAULTS };
    try {
      return clampSettings(JSON.parse(raw) as Partial<TytoSettings>, DEFAULTS);
    } catch {
      this.logger.warn('Réglages illisibles en base — retour aux valeurs par défaut');
      return { ...DEFAULTS };
    }
  }

  /** Modifie tout ou partie des réglages ; les clés absentes sont conservées. */
  setSettings(patch: Partial<TytoSettings>): TytoModeState {
    const next = clampSettings(patch, this.get().settings);
    this.db.prepare(`UPDATE mode SET settings = ? WHERE id = ?`)
      .run(JSON.stringify(next), ROW_ID);
    this.logger.log(`Réglages Tyto : ${JSON.stringify(next)}`);
    return this.get();
  }

  /** Remet les valeurs éprouvées à la mise en service. */
  resetSettings(): TytoModeState {
    this.db.prepare(`UPDATE mode SET settings = ? WHERE id = ?`)
      .run(JSON.stringify(DEFAULTS), ROW_ID);
    return this.get();
  }

  set(mode: TytoMode, until: number | null, source: string): TytoModeState {
    const changedAt = Date.now();
    this.db.prepare(
      `UPDATE mode SET mode = ?, until = ?, source = ?, changed_at = ? WHERE id = ?`
    ).run(mode, until, source, changedAt, ROW_ID);
    const row = this.db.prepare(`SELECT settings FROM mode WHERE id = ?`)
      .get(ROW_ID) as { settings: string | null };
    return { mode, until, source, changedAt, settings: this.parseSettings(row.settings) };
  }
}
