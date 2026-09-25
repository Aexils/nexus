import { Injectable, Logger } from '@nestjs/common';
import Database from 'better-sqlite3';
import { TytoMode, TytoModeState } from '@nexus/shared-types';
import * as path from 'path';

// Le mode de Tyto est de l'état DURABLE : il doit survivre au restart du pod,
// sinon un simple rollout désarmerait la surveillance en silence. Même PVC que
// le Journal et les coupures (nexus-state en prod, cwd en dev).
const LOG_DB = process.env['LOG_DB_PATH'];
const DB_PATH = process.env['TYTO_DB_PATH']
  ?? path.join(LOG_DB ? path.dirname(LOG_DB) : process.cwd(), 'nexus-tyto.db');

// Une seule ligne, id figé : c'est un réglage, pas une collection.
const ROW_ID = 1;

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
        changed_at INTEGER NOT NULL
      );
    `);
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
      `SELECT mode, until, source, changed_at FROM mode WHERE id = ?`
    ).get(ROW_ID) as { mode: TytoMode; until: number | null; source: string; changed_at: number };

    if (r.until !== null && Date.now() >= r.until) {
      // L'échéance est le garde-fou central : on ne compte pas sur l'utilisateur
      // pour se souvenir de réarmer avant de partir.
      this.logger.log(`Échéance atteinte (${new Date(r.until).toISOString()}) → réarmement`);
      return this.set('armed', null, 'réarmement auto');
    }
    return { mode: r.mode, until: r.until, source: r.source, changedAt: r.changed_at };
  }

  set(mode: TytoMode, until: number | null, source: string): TytoModeState {
    const changedAt = Date.now();
    this.db.prepare(
      `UPDATE mode SET mode = ?, until = ?, source = ?, changed_at = ? WHERE id = ?`
    ).run(mode, until, source, changedAt, ROW_ID);
    return { mode, until, source, changedAt };
  }
}
