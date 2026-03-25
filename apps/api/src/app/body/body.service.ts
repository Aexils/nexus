import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import Database from 'better-sqlite3';
import * as crypto from 'crypto';
import * as path from 'path';
import {
  BodyMeasurement, BodySettings, BodyMetricKey, ALL_BODY_METRIC_KEYS,
} from '@nexus/shared-types';

const DB_PATH = process.env['EXPENSE_DB_PATH'] ?? path.join(process.cwd(), 'nexus-expenses.db');

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

const DEFAULT_ENABLED: BodyMetricKey[] = ALL_BODY_METRIC_KEYS;

@Injectable()
export class BodyService implements OnModuleInit {
  private readonly logger = new Logger(BodyService.name);
  private db!: Database.Database;

  onModuleInit() {
    this.db = new Database(DB_PATH);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS body_measurements (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        date        TEXT    NOT NULL UNIQUE,
        weight      REAL,
        neck        REAL,
        chest       REAL,
        abdomen     REAL,
        waist       REAL,
        hips        REAL,
        arm_left    REAL,
        arm_right   REAL,
        thigh_left  REAL,
        thigh_right REAL,
        calf_left   REAL,
        calf_right  REAL,
        created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS body_settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    this.logger.log('Body DB tables ready');
  }

  // ── Auth ──────────────────────────────────────────────────────────────────

  hasPassword(): boolean {
    const row = this.db.prepare(`SELECT value FROM body_settings WHERE key = 'password_hash'`).get() as any;
    return !!row;
  }

  /** Verify raw password (hashes it then compares) */
  verifyPassword(password: string): boolean {
    return this.verifyToken(sha256(password));
  }

  /** Verify pre-hashed token (used for session validation) */
  verifyToken(token: string): boolean {
    const row = this.db.prepare(`SELECT value FROM body_settings WHERE key = 'password_hash'`).get() as any;
    if (!row) return false;
    return row.value === token;
  }

  /** Returns the session token (= sha256 of password) on success */
  login(password: string): string | null {
    const hash = sha256(password);
    if (!this.verifyToken(hash)) return null;
    return hash;
  }

  setupPassword(password: string): string {
    const hash = sha256(password);
    this.db.prepare(`INSERT OR REPLACE INTO body_settings (key, value) VALUES ('password_hash', ?)`).run(hash);
    return hash;
  }

  changePassword(oldPassword: string, newPassword: string): string | null {
    if (!this.verifyPassword(oldPassword)) return null;
    return this.setupPassword(newPassword);
  }

  // ── Settings ──────────────────────────────────────────────────────────────

  getSettings(): BodySettings {
    const rows = this.db.prepare(`SELECT key, value FROM body_settings`).all() as { key: string; value: string }[];
    const map = new Map(rows.map(r => [r.key, r.value]));

    const enabledRaw = map.get('enabled_metrics');
    return {
      hasPassword:     map.has('password_hash'),
      height:          map.has('height')            ? parseFloat(map.get('height')!)            : undefined,
      targetWeight:    map.has('target_weight')     ? parseFloat(map.get('target_weight')!)     : undefined,
      targetNeck:      map.has('target_neck')       ? parseFloat(map.get('target_neck')!)       : undefined,
      targetChest:     map.has('target_chest')      ? parseFloat(map.get('target_chest')!)      : undefined,
      targetAbdomen:   map.has('target_abdomen')    ? parseFloat(map.get('target_abdomen')!)    : undefined,
      targetWaist:     map.has('target_waist')      ? parseFloat(map.get('target_waist')!)      : undefined,
      targetHips:      map.has('target_hips')       ? parseFloat(map.get('target_hips')!)       : undefined,
      targetArmLeft:   map.has('target_arm_left')   ? parseFloat(map.get('target_arm_left')!)   : undefined,
      targetArmRight:  map.has('target_arm_right')  ? parseFloat(map.get('target_arm_right')!)  : undefined,
      targetThighLeft: map.has('target_thigh_left') ? parseFloat(map.get('target_thigh_left')!) : undefined,
      targetThighRight:map.has('target_thigh_right')? parseFloat(map.get('target_thigh_right')!): undefined,
      targetCalfLeft:  map.has('target_calf_left')  ? parseFloat(map.get('target_calf_left')!)  : undefined,
      targetCalfRight: map.has('target_calf_right') ? parseFloat(map.get('target_calf_right')!) : undefined,
      enabledMetrics:  enabledRaw ? JSON.parse(enabledRaw) : DEFAULT_ENABLED,
    };
  }

  updateSettings(settings: Partial<Omit<BodySettings, 'hasPassword'>>): void {
    const upsert = this.db.prepare(`INSERT OR REPLACE INTO body_settings (key, value) VALUES (?, ?)`);
    const del    = this.db.prepare(`DELETE FROM body_settings WHERE key = ?`);

    const setOrDel = (key: string, val: any) => {
      if (val === undefined || val === null || val === '') del.run(key);
      else upsert.run(key, String(val));
    };

    if ('height'           in settings) setOrDel('height',            settings.height);
    if ('targetWeight'     in settings) setOrDel('target_weight',     settings.targetWeight);
    if ('targetNeck'       in settings) setOrDel('target_neck',       settings.targetNeck);
    if ('targetChest'      in settings) setOrDel('target_chest',      settings.targetChest);
    if ('targetAbdomen'    in settings) setOrDel('target_abdomen',    settings.targetAbdomen);
    if ('targetWaist'      in settings) setOrDel('target_waist',      settings.targetWaist);
    if ('targetHips'       in settings) setOrDel('target_hips',       settings.targetHips);
    if ('targetArmLeft'    in settings) setOrDel('target_arm_left',   settings.targetArmLeft);
    if ('targetArmRight'   in settings) setOrDel('target_arm_right',  settings.targetArmRight);
    if ('targetThighLeft'  in settings) setOrDel('target_thigh_left', settings.targetThighLeft);
    if ('targetThighRight' in settings) setOrDel('target_thigh_right',settings.targetThighRight);
    if ('targetCalfLeft'   in settings) setOrDel('target_calf_left',  settings.targetCalfLeft);
    if ('targetCalfRight'  in settings) setOrDel('target_calf_right', settings.targetCalfRight);
    if (settings.enabledMetrics !== undefined) {
      upsert.run('enabled_metrics', JSON.stringify(settings.enabledMetrics));
    }
  }

  // ── Measurements ──────────────────────────────────────────────────────────

  getMeasurements(): BodyMeasurement[] {
    const rows = this.db.prepare(`SELECT * FROM body_measurements ORDER BY date DESC`).all() as any[];
    return rows.map(r => this.mapRow(r));
  }

  upsertMeasurement(date: string, data: Partial<Omit<BodyMeasurement, 'id' | 'date' | 'createdAt'>>): BodyMeasurement {
    const existing = this.db.prepare(`SELECT id FROM body_measurements WHERE date = ?`).get(date) as any;

    if (existing) {
      const fieldMap: Record<string, string> = {
        weight: 'weight', neck: 'neck', chest: 'chest', abdomen: 'abdomen',
        waist: 'waist', hips: 'hips', armLeft: 'arm_left', armRight: 'arm_right',
        thighLeft: 'thigh_left', thighRight: 'thigh_right', calfLeft: 'calf_left', calfRight: 'calf_right',
      };
      const fields: string[] = [];
      const values: any[] = [];
      for (const [jsKey, dbKey] of Object.entries(fieldMap)) {
        if ((data as any)[jsKey] !== undefined) {
          fields.push(`${dbKey} = ?`);
          values.push((data as any)[jsKey]);
        }
      }
      if (fields.length) {
        values.push(date);
        this.db.prepare(`UPDATE body_measurements SET ${fields.join(', ')} WHERE date = ?`).run(...values);
      }
    } else {
      this.db.prepare(`
        INSERT INTO body_measurements
          (date, weight, neck, chest, abdomen, waist, hips, arm_left, arm_right, thigh_left, thigh_right, calf_left, calf_right)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        date,
        data.weight ?? null, data.neck ?? null, data.chest ?? null,
        data.abdomen ?? null, data.waist ?? null, data.hips ?? null,
        data.armLeft ?? null, data.armRight ?? null,
        data.thighLeft ?? null, data.thighRight ?? null,
        data.calfLeft ?? null, data.calfRight ?? null,
      );
    }

    return this.mapRow(this.db.prepare(`SELECT * FROM body_measurements WHERE date = ?`).get(date) as any);
  }

  deleteMeasurement(id: number): boolean {
    return this.db.prepare(`DELETE FROM body_measurements WHERE id = ?`).run(id).changes > 0;
  }

  private mapRow(r: any): BodyMeasurement {
    return {
      id:          r.id,
      date:        r.date,
      weight:      r.weight      ?? undefined,
      neck:        r.neck        ?? undefined,
      chest:       r.chest       ?? undefined,
      abdomen:     r.abdomen     ?? undefined,
      waist:       r.waist       ?? undefined,
      hips:        r.hips        ?? undefined,
      armLeft:     r.arm_left    ?? undefined,
      armRight:    r.arm_right   ?? undefined,
      thighLeft:   r.thigh_left  ?? undefined,
      thighRight:  r.thigh_right ?? undefined,
      calfLeft:    r.calf_left   ?? undefined,
      calfRight:   r.calf_right  ?? undefined,
      createdAt:   r.created_at,
    };
  }
}
