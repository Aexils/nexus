import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import Database from 'better-sqlite3';
import { LinkOutage } from '@nexus/shared-types';
import * as path from 'path';

// Persistance des coupures Internet : survit aux restarts du pod (même PVC que le
// Journal en prod). C'est la preuve horodatée à opposer à Bell — elle doit durer.
// Par défaut : à côté de la base du Journal (LOG_DB_PATH) → même PVC en prod ; cwd en dev.
const LOG_DB = process.env['LOG_DB_PATH'];
const DB_PATH = process.env['LINK_DB_PATH']
  ?? path.join(LOG_DB ? path.dirname(LOG_DB) : process.cwd(), 'nexus-link.db');

const RETENTION_DAYS = 90;

@Injectable()
export class LinkStoreService {
  private readonly logger = new Logger(LinkStoreService.name);
  private readonly db: Database.Database;

  constructor() {
    this.db = new Database(DB_PATH);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS outages (
        start        INTEGER NOT NULL PRIMARY KEY,   -- Unix ms, unique par début
        end          INTEGER NOT NULL,
        duration_sec INTEGER NOT NULL,
        hub_down     INTEGER NOT NULL                -- 0/1 : passerelle injoignable = Hub tombé
      );
      CREATE INDEX IF NOT EXISTS idx_outages_start ON outages(start);
    `);
    this.prune();
    this.logger.log(`Coupures persistées dans ${DB_PATH}`);
  }

  /** Enregistre une coupure terminée (upsert sur start pour l'idempotence). */
  insert(o: LinkOutage): void {
    if (o.end === null) return;   // on ne persiste que les coupures closes
    this.db.prepare(
      `INSERT INTO outages (start, end, duration_sec, hub_down) VALUES (?, ?, ?, ?)
       ON CONFLICT(start) DO UPDATE SET end = excluded.end,
         duration_sec = excluded.duration_sec, hub_down = excluded.hub_down`,
    ).run(o.start, o.end, o.durationSec, o.hubDown ? 1 : 0);
  }

  /** Coupures depuis `since` (Unix ms), récent → ancien. */
  since(since: number): LinkOutage[] {
    return (this.db
      .prepare('SELECT start, end, duration_sec, hub_down FROM outages WHERE start >= ? ORDER BY start DESC')
      .all(since) as { start: number; end: number; duration_sec: number; hub_down: number }[])
      .map(this.rowToOutage);
  }

  /** Les `limit` dernières coupures, récent → ancien. */
  recent(limit: number): LinkOutage[] {
    return (this.db
      .prepare('SELECT start, end, duration_sec, hub_down FROM outages ORDER BY start DESC LIMIT ?')
      .all(limit) as { start: number; end: number; duration_sec: number; hub_down: number }[])
      .map(this.rowToOutage);
  }

  private rowToOutage(r: { start: number; end: number; duration_sec: number; hub_down: number }): LinkOutage {
    return { start: r.start, end: r.end, durationSec: r.duration_sec, hubDown: r.hub_down === 1 };
  }

  @Interval(24 * 60 * 60 * 1000)
  prune(): void {
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    this.db.prepare('DELETE FROM outages WHERE start < ?').run(cutoff);
  }
}
