import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import Database from 'better-sqlite3';
import {
  ImmigrationApplicant, DocStatus, DocCategory, DocComment,
  RequiredDocument, ApplicantProgress, ImmigrationOverview,
} from '@nexus/shared-types';
import * as path from 'path';

const DB_PATH =
  process.env['IMMIGRATION_DB_PATH'] ?? path.join(process.cwd(), 'nexus-immigration.db');

/** Échéance projet par défaut (éditable ensuite depuis l'UI). */
const DEFAULT_DEADLINE = '2026-09-21';

interface SeedDoc {
  name: string;
  detail: string;
  category: DocCategory;
}

const APPLICANTS: { id: ImmigrationApplicant; name: string }[] = [
  { id: 'alexis', name: 'Alexis Levasseur' },
  { id: 'marion', name: 'Marion Rotrou' },
];

const SEED: Record<ImmigrationApplicant, SeedDoc[]> = {
  alexis: [
    { name: 'Études',                                  detail: 'Diplômes ou grades universitaires', category: 'required' },
    { name: "Relevé d'emploi",                         detail: "Analyste de l'informatique",        category: 'required' },
    { name: "Relevé d'emploi",                         detail: 'Développeur',                        category: 'required' },
    { name: "Relevé d'emploi",                         detail: 'Développeur Web',                    category: 'required' },
    { name: "Relevé d'emploi",                         detail: 'Ingénieur de développement',        category: 'required' },
    { name: "Relevé d'emploi",                         detail: 'Développeur (2)',                    category: 'required' },
    { name: "Relevé d'emploi",                         detail: 'Développeur (3)',                    category: 'required' },
    { name: 'Preuve de ressources financières suffisantes', detail: '',                             category: 'required' },
    { name: 'Certificat de police',                    detail: 'France',                             category: 'required' },
    { name: 'Photographie',                            detail: '',                                   category: 'required' },
    { name: 'Passeports / titres de voyage',           detail: 'Documents multiples',                category: 'required' },
    { name: "Preuve d'examen médical préalable",       detail: '',                                   category: 'required' },
    { name: "Déclaration officielle d'union de fait",  detail: 'IMM5409',                            category: 'required' },
    { name: 'Renseignements du client',                detail: '',                                   category: 'optional' },
  ],
  marion: [
    { name: "Relevé d'emploi",                         detail: 'Agent administratif',                category: 'required' },
    { name: "Relevé d'emploi",                         detail: 'Coordinatrice ALSH',                 category: 'required' },
    { name: "Relevé d'emploi",                         detail: 'Réceptionniste',                     category: 'required' },
    { name: "Relevé d'emploi",                         detail: 'Animatrice suivi de projet',         category: 'required' },
    { name: "Relevé d'emploi",                         detail: 'Vendeuse en boulangerie',            category: 'required' },
    { name: "Relevé d'emploi",                         detail: 'Vendeuse (2)',                       category: 'required' },
    { name: "Relevé d'emploi",                         detail: 'Vendeuse (3)',                       category: 'required' },
    { name: "Relevé d'emploi",                         detail: 'Directrice adjointe ALSH',           category: 'required' },
    { name: 'Études',                                  detail: 'Diplômes ou grades universitaires', category: 'required' },
    { name: 'Photographie',                            detail: '',                                   category: 'required' },
    { name: "Preuve d'examen médical préalable",       detail: '',                                   category: 'required' },
    { name: 'Passeports / titres de voyage',           detail: 'Documents multiples',                category: 'required' },
    { name: "Document d'identité national",            detail: 'Documents multiples',                category: 'required' },
    { name: 'Certificat de police',                    detail: 'France',                             category: 'required' },
    { name: 'Renseignements du client',                detail: '',                                   category: 'optional' },
  ],
};

@Injectable()
export class ImmigrationService implements OnModuleInit {
  private readonly logger = new Logger(ImmigrationService.name);
  private db!: Database.Database;

  onModuleInit() {
    this.db = new Database(DB_PATH);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS immigration_documents (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        applicant_id TEXT    NOT NULL,
        name         TEXT    NOT NULL,
        detail       TEXT    NOT NULL DEFAULT '',
        category     TEXT    NOT NULL DEFAULT 'required',
        status       TEXT    NOT NULL DEFAULT 'not_provided',
        sort_order   INTEGER NOT NULL DEFAULT 0,
        updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS immigration_comments (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id INTEGER NOT NULL,
        text        TEXT    NOT NULL,
        created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS immigration_settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    this.seedIfEmpty();
    this.ensureDeadline();
    this.logger.log(`Immigration DB ready — ${DB_PATH}`);
  }

  private seedIfEmpty(): void {
    const count = (this.db.prepare('SELECT COUNT(*) as n FROM immigration_documents').get() as any).n;
    if (count > 0) return;

    const insert = this.db.prepare(
      `INSERT INTO immigration_documents (applicant_id, name, detail, category, sort_order)
       VALUES (?, ?, ?, ?, ?)`,
    );
    const tx = this.db.transaction(() => {
      for (const { id } of APPLICANTS) {
        SEED[id].forEach((doc, i) => insert.run(id, doc.name, doc.detail, doc.category, i));
      }
    });
    tx();
    this.logger.log('Immigration — documents initiaux seedés');
  }

  private ensureDeadline(): void {
    const existing = this.db
      .prepare(`SELECT value FROM immigration_settings WHERE key = 'deadline'`)
      .get() as { value: string } | undefined;
    if (existing) return;

    this.db.prepare(`INSERT INTO immigration_settings (key, value) VALUES ('deadline', ?)`).run(DEFAULT_DEADLINE);
  }

  // ── Lecture ────────────────────────────────────────────────────────────────

  getDeadline(): string {
    const row = this.db
      .prepare(`SELECT value FROM immigration_settings WHERE key = 'deadline'`)
      .get() as { value: string } | undefined;
    return row?.value ?? new Date().toISOString().slice(0, 10);
  }

  getOverview(): ImmigrationOverview {
    const rows = this.db
      .prepare(
        `SELECT d.*, (SELECT COUNT(*) FROM immigration_comments c WHERE c.document_id = d.id) AS comment_count
         FROM immigration_documents d
         ORDER BY d.applicant_id, d.sort_order, d.id`,
      )
      .all() as any[];

    const applicants: ApplicantProgress[] = APPLICANTS.map(({ id, name }) => {
      const docs = rows.filter(r => r.applicant_id === id).map(r => this.mapDoc(r));
      const required = docs.filter(d => d.category === 'required');
      return {
        id,
        name,
        documents: docs,
        requiredTotal:      required.length,
        requiredProvided:   required.filter(d => d.status === 'provided').length,
        requiredInProgress: required.filter(d => d.status === 'in_progress').length,
      };
    });

    const totalRequired = applicants.reduce((s, a) => s + a.requiredTotal, 0);
    const totalProvided = applicants.reduce((s, a) => s + a.requiredProvided, 0);

    return { deadline: this.getDeadline(), applicants, totalRequired, totalProvided };
  }

  // ── Mutations ────────────────────────────────────────────────────────────────

  setDeadline(deadline: string): string {
    this.db
      .prepare(
        `INSERT INTO immigration_settings (key, value) VALUES ('deadline', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(deadline);
    return this.getDeadline();
  }

  setStatus(id: number, status: DocStatus): RequiredDocument | null {
    this.db
      .prepare(`UPDATE immigration_documents SET status = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(status, id);
    const row = this.db
      .prepare(
        `SELECT d.*, (SELECT COUNT(*) FROM immigration_comments c WHERE c.document_id = d.id) AS comment_count
         FROM immigration_documents d WHERE d.id = ?`,
      )
      .get(id) as any;
    return row ? this.mapDoc(row) : null;
  }

  getComments(documentId: number): DocComment[] {
    const rows = this.db
      .prepare(`SELECT * FROM immigration_comments WHERE document_id = ? ORDER BY created_at DESC, id DESC`)
      .all(documentId) as any[];
    return rows.map(r => ({ id: r.id, text: r.text, createdAt: r.created_at }));
  }

  addComment(documentId: number, text: string): DocComment {
    const info = this.db
      .prepare(`INSERT INTO immigration_comments (document_id, text) VALUES (?, ?)`)
      .run(documentId, text);
    const row = this.db
      .prepare(`SELECT * FROM immigration_comments WHERE id = ?`)
      .get(info.lastInsertRowid) as any;
    return { id: row.id, text: row.text, createdAt: row.created_at };
  }

  deleteComment(id: number): boolean {
    return this.db.prepare(`DELETE FROM immigration_comments WHERE id = ?`).run(id).changes > 0;
  }

  documentExists(id: number): boolean {
    return !!this.db.prepare('SELECT 1 FROM immigration_documents WHERE id = ?').get(id);
  }

  private mapDoc(r: any): RequiredDocument {
    return {
      id:           r.id,
      applicantId:  r.applicant_id,
      name:         r.name,
      detail:       r.detail ?? '',
      category:     r.category,
      status:       r.status,
      commentCount: r.comment_count ?? 0,
      comments:     [],
      updatedAt:    r.updated_at,
    };
  }
}
