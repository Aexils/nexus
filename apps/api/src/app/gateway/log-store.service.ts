import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import Database from 'better-sqlite3';
import { LogEntry } from '@nexus/shared-types';
import * as path from 'path';

// Persistance du Journal : survit aux restarts du pod (PVC /nexus-state en prod).
const DB_PATH = process.env['LOG_DB_PATH'] ?? path.join(process.cwd(), 'nexus-logs.db');

const RETENTION_DAYS = 30;
const MAX_ROWS = 20_000;   // garde-fou en plus de la rétention temporelle

@Injectable()
export class LogStoreService {
  private readonly logger = new Logger(LogStoreService.name);
  private readonly db: Database.Database;

  // Init dans le constructeur (pas onModuleInit) : d'autres services appellent
  // addLog() dès leur propre constructeur, avant les hooks de cycle de vie.
  constructor() {
    this.db = new Database(DB_PATH);
    // UNIQUE(ts, source, message) : les relais rejouent leur backfill après un
    // restart (kodi…) — INSERT OR IGNORE déduplique naturellement.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS logs (
        id      TEXT    NOT NULL,
        ts      INTEGER NOT NULL,
        level   TEXT    NOT NULL,
        source  TEXT    NOT NULL,
        message TEXT    NOT NULL,
        UNIQUE(ts, source, message)
      );
      CREATE INDEX IF NOT EXISTS idx_logs_ts ON logs(ts);
    `);
    this.prune();
    this.logger.log(`Journal persisté dans ${DB_PATH}`);
  }

  /** Insère l'entrée. → false si déjà connue (rejeu de backfill) : ne pas ré-émettre. */
  insert(e: LogEntry): boolean {
    const res = this.db
      .prepare('INSERT OR IGNORE INTO logs (id, ts, level, source, message) VALUES (?, ?, ?, ?, ?)')
      .run(e.id, e.timestamp, e.level, e.source, e.message);
    return res.changes > 0;
  }

  /** Dernières entrées, ordre chronologique (pour re-remplir le buffer au boot). */
  loadRecent(limit: number): LogEntry[] {
    const rows = this.db
      .prepare('SELECT id, ts, level, source, message FROM logs ORDER BY ts DESC LIMIT ?')
      .all(limit) as { id: string; ts: number; level: string; source: string; message: string }[];
    return rows.reverse().map(r => ({
      id: r.id,
      timestamp: r.ts,
      level: r.level as LogEntry['level'],
      source: r.source as LogEntry['source'],
      message: r.message,
    }));
  }

  @Interval(24 * 60 * 60 * 1000)
  prune(): void {
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    this.db.prepare('DELETE FROM logs WHERE ts < ?').run(cutoff);
    this.db.prepare(
      'DELETE FROM logs WHERE rowid NOT IN (SELECT rowid FROM logs ORDER BY ts DESC LIMIT ?)',
    ).run(MAX_ROWS);
  }
}
