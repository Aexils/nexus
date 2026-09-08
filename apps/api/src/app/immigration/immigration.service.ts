import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import Database from 'better-sqlite3';
import {
  ImmigrationApplicant, DocStatus, DocCategory, DocComment,
  RequiredDocument, ApplicantProgress, ImmigrationOverview,
} from '@nexus/shared-types';
import * as path from 'path';

const DB_PATH =
  process.env['IMMIGRATION_DB_PATH'] ?? path.join(process.cwd(), 'nexus-immigration.db');

/**
 * Échéance de dépôt de l'eAPR (éditable ensuite depuis l'UI).
 * IRCC ferme à la fin de cette journée **en UTC**, soit 20 h heure de Montréal.
 */
const DEFAULT_DEADLINE = '2026-09-21';

/**
 * Version du jeu de données initial. À incrémenter dès que `SEED` change :
 * au démarrage, une base seedée avec une version antérieure est purgée et rejouée
 * (les commentaires orphelins sont nettoyés dans la foulée).
 */
const SEED_VERSION = 2;

interface SeedDoc {
  /**
   * Identifiant stable de la case, propre au candidat. C'est LUI qui fait le lien entre
   * deux versions du seed : les libellés (`name`, `detail`) peuvent changer librement sans
   * détacher les commentaires ni perdre les statuts.
   */
  key: string;
  name: string;
  detail: string;
  category: DocCategory;
  /** État constaté sur le portail IRCC au 08/09/2026 — appliqué au premier remplissage seulement. */
  status: DocStatus;
}

const APPLICANTS: { id: ImmigrationApplicant; name: string }[] = [
  { id: 'alexis', name: 'Alexis Levasseur' },
  { id: 'marion', name: 'Marion Rotrou' },
];

/**
 * Liste de contrôle réelle du portail IRCC (profil E004432006), relevée le 08/09/2026.
 * Les cases « Relevé d'emploi » sont nommées par le portail avec l'intitulé du poste et
 * correspondent 1:1 aux lignes du formulaire « Antécédents - Emploi ».
 * Ne pas inventer de case : une expérience déclarée uniquement dans « Activités personnelles »
 * n'ouvre aucune case de checklist.
 */
const SEED: Record<ImmigrationApplicant, SeedDoc[]> = {
  alexis: [
    { key: 'etudes',            name: 'Études',                                       detail: 'Diplômes ou grades universitaires',                category: 'required', status: 'provided' },
    { key: 'fonds',             name: 'Preuve de ressources financières suffisantes', detail: '',                                                 category: 'required', status: 'provided' },
    { key: 'police',            name: 'Certificat de police',                         detail: 'France · réponse B3 du 24/08/2026',                category: 'required', status: 'provided' },
    { key: 'photo',             name: 'Photographie',                                 detail: '',                                                 category: 'required', status: 'provided' },
    { key: 'passeport',         name: 'Passeports / titres de voyage',                detail: 'Documents multiples',                              category: 'required', status: 'provided' },
    { key: 'medical',           name: "Preuve d'examen médical préalable",            detail: 'IUM U013185147',                                   category: 'required', status: 'provided' },
    { key: 'union-fait',        name: "Déclaration officielle d'union de fait",       detail: 'IMM5409',                                          category: 'required', status: 'in_progress' },
    { key: 'emploi-uqam',       name: "Relevé d'emploi",                              detail: "Analyste de l'informatique · UQAM",                category: 'required', status: 'provided' },
    { key: 'emploi-digiwin-1',  name: "Relevé d'emploi",                              detail: 'Développeur · Digiwin',                            category: 'required', status: 'provided' },
    { key: 'emploi-micro',      name: "Relevé d'emploi",                              detail: 'Développeur Web · Micro Entreprise',               category: 'required', status: 'provided' },
    { key: 'emploi-digiwin-2',  name: "Relevé d'emploi",                              detail: 'Apprenti responsable Ingenier · Digiwin',          category: 'required', status: 'provided' },
    { key: 'emploi-vidis',      name: "Relevé d'emploi",                              detail: 'Apprenti analyste programmeur · Vidis',            category: 'required', status: 'not_provided' },
    { key: 'emploi-digiwin-3',  name: "Relevé d'emploi",                              detail: 'Apprenti manager systèmes informatique · Digiwin', category: 'required', status: 'provided' },
    { key: 'renseignements',    name: 'Renseignements du client',                     detail: 'Documents facultatifs',                            category: 'optional', status: 'not_provided' },
  ],
  marion: [
    { key: 'etudes',            name: 'Études',                                       detail: 'Diplômes ou grades universitaires',                category: 'required', status: 'provided' },
    { key: 'photo',             name: 'Photographie',                                 detail: 'À refaire — 280×360 px, sous la norme',            category: 'required', status: 'in_progress' },
    { key: 'medical',           name: "Preuve d'examen médical préalable",            detail: 'IUM U013185178 · consentement manquant',           category: 'required', status: 'in_progress' },
    { key: 'passeport',         name: 'Passeports / titres de voyage',                detail: 'Documents multiples',                              category: 'required', status: 'provided' },
    { key: 'identite',          name: "Document d'identité national",                 detail: 'Documents multiples',                              category: 'required', status: 'provided' },
    { key: 'police',            name: 'Certificat de police',                         detail: 'France',                                           category: 'required', status: 'provided' },
    { key: 'emploi-oiiq-1',     name: "Relevé d'emploi",                              detail: 'Agent administratif · OIIQ',                       category: 'required', status: 'not_provided' },
    { key: 'emploi-mjc-1',      name: "Relevé d'emploi",                              detail: 'Coordinatrice ALSH · MJC Grieu',                   category: 'required', status: 'not_provided' },
    { key: 'emploi-oiiq-2',     name: "Relevé d'emploi",                              detail: 'Réceptionniste · OIIQ',                            category: 'required', status: 'not_provided' },
    { key: 'emploi-mjc-2',      name: "Relevé d'emploi",                              detail: 'Animatrice suivi de projet · MJC Grieu',           category: 'required', status: 'not_provided' },
    { key: 'emploi-mjc-3',      name: "Relevé d'emploi",                              detail: 'Directrice adjointe ALSH · MJC Grieu',             category: 'required', status: 'not_provided' },
    { key: 'renseignements',    name: 'Renseignements du client',                     detail: 'Documents facultatifs',                            category: 'optional', status: 'not_provided' },
  ],
};

/**
 * Rattrapage des bases seedées avant l'introduction de `slot_key` : associe les anciens
 * libellés `(name, detail)` à la case correspondante, pour conserver statuts et commentaires.
 * Les entrées absentes d'ici (les cases fantômes « Vendeuse », « Développeur (2) »…) restent
 * sans clé et seront traitées comme obsolètes.
 */
const LEGACY_KEYS: Record<ImmigrationApplicant, Record<string, string>> = {
  alexis: {
    'Études|Diplômes ou grades universitaires': 'etudes',
    'Preuve de ressources financières suffisantes|': 'fonds',
    'Certificat de police|France': 'police',
    'Photographie|': 'photo',
    'Passeports / titres de voyage|Documents multiples': 'passeport',
    "Preuve d'examen médical préalable|": 'medical',
    "Déclaration officielle d'union de fait|IMM5409": 'union-fait',
    "Relevé d'emploi|Analyste de l'informatique": 'emploi-uqam',
    "Relevé d'emploi|Développeur": 'emploi-digiwin-1',
    "Relevé d'emploi|Développeur Web": 'emploi-micro',
    'Renseignements du client|': 'renseignements',
  },
  marion: {
    'Études|Diplômes ou grades universitaires': 'etudes',
    'Photographie|': 'photo',
    "Preuve d'examen médical préalable|": 'medical',
    'Passeports / titres de voyage|Documents multiples': 'passeport',
    "Document d'identité national|Documents multiples": 'identite',
    'Certificat de police|France': 'police',
    "Relevé d'emploi|Agent administratif": 'emploi-oiiq-1',
    "Relevé d'emploi|Coordinatrice ALSH": 'emploi-mjc-1',
    "Relevé d'emploi|Réceptionniste": 'emploi-oiiq-2',
    "Relevé d'emploi|Animatrice suivi de projet": 'emploi-mjc-2',
    "Relevé d'emploi|Directrice adjointe ALSH": 'emploi-mjc-3',
    'Renseignements du client|': 'renseignements',
  },
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
        slot_key     TEXT,
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

    this.ensureSlotKeyColumn();
    this.syncSeed();
    this.ensureDeadline();
    this.logger.log(`Immigration DB ready — ${DB_PATH}`);
  }

  /**
   * Ajoute `slot_key` aux bases antérieures et le renseigne à partir des anciens libellés.
   * Sans ce rattrapage, une base existante verrait toutes ses cases traitées comme obsolètes.
   */
  private ensureSlotKeyColumn(): void {
    const columns = this.db.prepare(`PRAGMA table_info(immigration_documents)`).all() as { name: string }[];
    if (!columns.some(c => c.name === 'slot_key')) {
      this.db.exec(`ALTER TABLE immigration_documents ADD COLUMN slot_key TEXT`);
    }

    const orphans = this.db
      .prepare(`SELECT id, applicant_id, name, detail FROM immigration_documents WHERE slot_key IS NULL`)
      .all() as { id: number; applicant_id: ImmigrationApplicant; name: string; detail: string }[];
    if (orphans.length === 0) return;

    const setKey = this.db.prepare(`UPDATE immigration_documents SET slot_key = ? WHERE id = ?`);
    const tx = this.db.transaction(() => {
      for (const row of orphans) {
        const key = LEGACY_KEYS[row.applicant_id]?.[`${row.name}|${row.detail ?? ''}`];
        if (key) setKey.run(key, row.id);
      }
    });
    tx();
  }

  /**
   * Réconcilie la liste des documents avec `SEED`, sans jamais purger la table.
   *
   * Garanties, parce que cette base est persistante en production (PVC) :
   * - une case existante est mise à jour **en place** → son `id` ne bouge pas, ses commentaires
   *   restent attachés ;
   * - un statut déjà renseigné n'est jamais écrasé ; le statut du seed ne sert qu'à remplir
   *   les cases encore à « Manquant » ;
   * - une case obsolète n'est supprimée que si **elle ne porte aucun commentaire**. Sinon elle
   *   est conservée et signalée, pour que la suppression reste une décision humaine.
   */
  private syncSeed(): void {
    const count = (this.db.prepare('SELECT COUNT(*) as n FROM immigration_documents').get() as any).n;
    const storedVersion = Number(
      (this.db.prepare(`SELECT value FROM immigration_settings WHERE key = 'seed_version'`)
        .get() as { value: string } | undefined)?.value ?? 0,
    );

    if (count > 0 && storedVersion === SEED_VERSION) return;

    const findByKey = this.db.prepare(
      `SELECT id, status FROM immigration_documents WHERE applicant_id = ? AND slot_key = ?`,
    );
    const update = this.db.prepare(
      `UPDATE immigration_documents
          SET name = ?, detail = ?, category = ?, sort_order = ?, status = ?, updated_at = datetime('now')
        WHERE id = ?`,
    );
    const insert = this.db.prepare(
      `INSERT INTO immigration_documents (applicant_id, slot_key, name, detail, category, status, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );

    let inserted = 0, updated = 0, removed = 0;
    const kept: string[] = [];

    const tx = this.db.transaction(() => {
      for (const { id } of APPLICANTS) {
        SEED[id].forEach((doc, i) => {
          const existing = findByKey.get(id, doc.key) as { id: number; status: DocStatus } | undefined;
          if (existing) {
            // Le statut choisi par l'utilisateur prime ; le seed ne comble que les cases vierges.
            const status = existing.status === 'not_provided' ? doc.status : existing.status;
            update.run(doc.name, doc.detail, doc.category, i, status, existing.id);
            updated++;
          } else {
            insert.run(id, doc.key, doc.name, doc.detail, doc.category, doc.status, i);
            inserted++;
          }
        });

        const validKeys = SEED[id].map(d => d.key);
        const placeholders = validKeys.map(() => '?').join(', ');
        const obsolete = this.db
          .prepare(
            `SELECT d.id, d.name, d.detail,
                    (SELECT COUNT(*) FROM immigration_comments c WHERE c.document_id = d.id) AS n_comments
               FROM immigration_documents d
              WHERE d.applicant_id = ?
                AND (d.slot_key IS NULL OR d.slot_key NOT IN (${placeholders}))`,
          )
          .all(id, ...validKeys) as { id: number; name: string; detail: string; n_comments: number }[];

        for (const row of obsolete) {
          if (row.n_comments > 0) {
            kept.push(`${id} · ${row.name} — ${row.detail} (${row.n_comments} note(s))`);
            continue;
          }
          this.db.prepare('DELETE FROM immigration_documents WHERE id = ?').run(row.id);
          removed++;
        }
      }

      this.db
        .prepare(
          `INSERT INTO immigration_settings (key, value) VALUES ('seed_version', ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        )
        .run(String(SEED_VERSION));
    });
    tx();

    this.logger.log(
      `Immigration — seed v${storedVersion} → v${SEED_VERSION} : ` +
      `${inserted} ajoutée(s), ${updated} mise(s) à jour, ${removed} supprimée(s)`,
    );
    for (const k of kept) {
      this.logger.warn(`Immigration — case obsolète conservée car annotée : ${k}`);
    }
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
