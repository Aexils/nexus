import { Injectable, OnModuleInit, Logger, BadRequestException } from '@nestjs/common';
import {
  ImportBatch, ImportFormat, StagedTransaction, MerchantRule, ApplyDecision,
  ApplyResult, ImportHealth, ExpensePaidBy, StagedDestination, RuleOrigin,
  ParsedStatement,
} from '@nexus/shared-types';
import { ExpenseService } from '../expense/expense.service';
import { parseOfx } from './parsers/ofx.parser';
import { parseCsv } from './parsers/csv.parser';
import { classify, suggestPattern, dedupKey, normalizeLabel } from './classifier';

@Injectable()
export class ImportService implements OnModuleInit {
  private readonly logger = new Logger(ImportService.name);

  constructor(private readonly expenseSvc: ExpenseService) {}

  private get db() { return this.expenseSvc.database; }

  onModuleInit() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS import_batches (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        filename      TEXT    NOT NULL,
        format        TEXT    NOT NULL,
        account_owner TEXT    NOT NULL,
        account_mask  TEXT    NOT NULL DEFAULT '',
        imported_at   TEXT    NOT NULL DEFAULT (datetime('now')),
        tx_total      INTEGER NOT NULL DEFAULT 0,
        tx_new        INTEGER NOT NULL DEFAULT 0,
        tx_duplicate  INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS staged_transactions (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_id            INTEGER NOT NULL,
        fitid               TEXT    NOT NULL DEFAULT '',
        dedup_key           TEXT    NOT NULL,
        raw_label           TEXT    NOT NULL,
        date                TEXT    NOT NULL,
        amount              REAL    NOT NULL,
        is_credit           INTEGER NOT NULL DEFAULT 0,
        destination         TEXT    NOT NULL DEFAULT 'maison',
        perso_user          TEXT,
        enseigne            TEXT    NOT NULL DEFAULT '',
        category            TEXT    NOT NULL DEFAULT '',
        subcategory         TEXT    NOT NULL DEFAULT '',
        source              TEXT    NOT NULL DEFAULT 'unmatched',
        rule_id             INTEGER,
        duplicate_of_id     INTEGER,
        status              TEXT    NOT NULL DEFAULT 'pending',
        applied_expense_id  INTEGER
      );

      -- La clé de dédup est unique sur l'ensemble des lots : réimporter le
      -- même mois ne peut pas créer une seconde ligne.
      CREATE UNIQUE INDEX IF NOT EXISTS idx_staged_dedup
        ON staged_transactions(dedup_key);
      CREATE INDEX IF NOT EXISTS idx_staged_batch
        ON staged_transactions(batch_id, status);

      CREATE TABLE IF NOT EXISTS merchant_rules (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        pattern      TEXT    NOT NULL,
        match_type   TEXT    NOT NULL DEFAULT 'contains',
        enseigne     TEXT    NOT NULL,
        category     TEXT    NOT NULL,
        subcategory  TEXT    NOT NULL DEFAULT '',
        destination  TEXT    NOT NULL DEFAULT 'maison',
        priority     INTEGER NOT NULL DEFAULT 0,
        hits         INTEGER NOT NULL DEFAULT 0,
        origin       TEXT    NOT NULL DEFAULT 'user',
        created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
        last_used_at TEXT,
        UNIQUE(pattern, match_type)
      );
    `);

    this.logger.log('Import tables ready');
  }

  // ── Règles ────────────────────────────────────────────────────────────────

  getRules(): MerchantRule[] {
    return (this.db.prepare(
      'SELECT * FROM merchant_rules ORDER BY priority DESC, length(pattern) DESC'
    ).all() as any[]).map(r => this.mapRule(r));
  }

  /**
   * Crée ou met à jour une règle. Le motif est normalisé pour que
   * « Super C » saisi à la main matche « ACHAT SUPER C 0231 ».
   */
  upsertRule(data: {
    pattern: string; enseigne: string; category: string;
    subcategory?: string; destination?: StagedDestination;
    matchType?: 'exact' | 'contains' | 'regex'; priority?: number; origin?: RuleOrigin;
  }): MerchantRule {
    const matchType = data.matchType ?? 'contains';
    // Une regex est écrite telle quelle ; les autres motifs sont normalisés
    // comme le sont les libellés auxquels on les compare.
    const pattern = matchType === 'regex' ? data.pattern.trim() : normalizeLabel(data.pattern);
    if (!pattern) throw new BadRequestException('Motif vide');
    if (!data.enseigne?.trim()) throw new BadRequestException('Enseigne manquante');

    this.db.prepare(`
      INSERT INTO merchant_rules (pattern, match_type, enseigne, category, subcategory, destination, priority, origin)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(pattern, match_type) DO UPDATE SET
        enseigne    = excluded.enseigne,
        category    = excluded.category,
        subcategory = excluded.subcategory,
        destination = excluded.destination,
        priority    = excluded.priority
    `).run(
      pattern, matchType, data.enseigne.trim(), data.category ?? '',
      data.subcategory ?? '', data.destination ?? 'maison',
      data.priority ?? 0, data.origin ?? 'user',
    );

    const row = this.db.prepare(
      'SELECT * FROM merchant_rules WHERE pattern = ? AND match_type = ?'
    ).get(pattern, matchType) as any;

    // Une règle neuve doit aussi alimenter les listes déroulantes de la saisie manuelle.
    this.registerTaxonomy(row.category, row.subcategory, row.enseigne);

    return this.mapRule(row);
  }

  deleteRule(id: number): boolean {
    return this.db.prepare('DELETE FROM merchant_rules WHERE id = ?').run(id).changes > 0;
  }

  /** Enregistre catégorie / sous-catégorie / enseigne dans les tables existantes. */
  private registerTaxonomy(category: string, subcategory: string, enseigne: string): void {
    if (category) {
      this.db.prepare('INSERT OR IGNORE INTO categories (name) VALUES (?)').run(category);
    }
    if (category && subcategory) {
      this.db.prepare('INSERT OR IGNORE INTO subcategories (name, category) VALUES (?, ?)')
        .run(subcategory, category);
    }
    if (subcategory && enseigne) {
      this.db.prepare('INSERT OR IGNORE INTO enseignes (name, subcategory) VALUES (?, ?)')
        .run(enseigne, subcategory);
    }
  }

  // ── Amorçage depuis l'historique ──────────────────────────────────────────

  /**
   * Fabrique une règle par enseigne déjà présente dans `expenses`.
   *
   * L'historique a été saisi à la main : `store` y vaut « Walmart », pas
   * « ACHAT WAL-MART #3106 MONTREAL QC ». Le seed fournit donc la moitié
   * fiable de la règle — enseigne → catégorie, sans ambiguïté constatée sur
   * les 229 lignes existantes — et c'est le premier import qui raccordera le
   * libellé bancaire réel au bon motif.
   */
  seedRulesFromHistory(): { created: number; skipped: number } {
    const rows = this.db.prepare(`
      SELECT store, category, subcategory, COUNT(*) AS n
      FROM expenses
      WHERE store != ''
      GROUP BY store, category, subcategory
      ORDER BY n DESC
    `).all() as { store: string; category: string; subcategory: string; n: number }[];

    let created = 0;
    let skipped = 0;

    for (const row of rows) {
      const pattern = normalizeLabel(row.store);
      if (!pattern || pattern.length < 3) { skipped++; continue; }

      const exists = this.db.prepare(
        'SELECT id FROM merchant_rules WHERE pattern = ? AND match_type = ?'
      ).get(pattern, 'contains');
      if (exists) { skipped++; continue; }

      this.db.prepare(`
        INSERT INTO merchant_rules (pattern, match_type, enseigne, category, subcategory, destination, origin)
        VALUES (?, 'contains', ?, ?, ?, 'maison', 'seed')
      `).run(pattern, row.store, row.category, row.subcategory ?? '');
      created++;
    }

    this.logger.log(`Seed des règles : ${created} créées, ${skipped} ignorées`);
    return { created, skipped };
  }

  // ── Import ────────────────────────────────────────────────────────────────

  private parse(buf: Buffer, filename: string, format?: ImportFormat): ParsedStatement {
    const ext = (format ?? filename.split('.').pop() ?? '').toLowerCase();
    switch (ext) {
      case 'ofx': return parseOfx(buf, 'ofx');
      case 'qfx': return parseOfx(buf, 'qfx');
      case 'csv': return parseCsv(buf);
      default:
        throw new BadRequestException(
          `Format « ${ext} » non géré. Exportez en OFX 1.0.2 (recommandé), QFX ou CSV.`
        );
    }
  }

  /**
   * Lit un fichier, classe ce qu'il peut, et dépose le tout en staging.
   * Rien n'entre dans `expenses` à cette étape — la validation est explicite.
   */
  ingest(buf: Buffer, filename: string, accountOwner: ExpensePaidBy, format?: ImportFormat): ImportBatch {
    const stmt = this.parse(buf, filename, format);
    if (!stmt.transactions.length) {
      throw new BadRequestException('Aucune transaction lisible dans ce fichier.');
    }

    const rules = this.getRules();

    const batchInfo = this.db.prepare(`
      INSERT INTO import_batches (filename, format, account_owner, account_mask, tx_total)
      VALUES (?, ?, ?, ?, ?)
    `).run(filename, stmt.format, accountOwner, stmt.accountMask, stmt.transactions.length);
    const batchId = Number(batchInfo.lastInsertRowid);

    const insert = this.db.prepare(`
      INSERT INTO staged_transactions
        (batch_id, fitid, dedup_key, raw_label, date, amount, is_credit,
         destination, perso_user, enseigne, category, subcategory, source, rule_id, duplicate_of_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const seenKey = this.db.prepare('SELECT 1 FROM staged_transactions WHERE dedup_key = ?');

    let txNew = 0;
    let txDuplicate = 0;

    const run = this.db.transaction(() => {
      for (const tx of stmt.transactions) {
        const key = dedupKey(accountOwner, tx.fitid, tx.date, tx.amount, tx.rawLabel);

        // Déjà vu dans un lot précédent (ou plus haut dans ce fichier) : on passe.
        if (seenKey.get(key)) { txDuplicate++; continue; }

        const rule = tx.isCredit ? null : classify(tx.rawLabel, rules);

        // Un crédit est un dépôt, un remboursement ou un paiement de carte :
        // jamais une dépense. Proposé à « ne pas traiter », visible quand même.
        const destination: StagedDestination = tx.isCredit
          ? 'ignore'
          : (rule?.destination ?? 'maison');

        const duplicateOfId = tx.isCredit ? null : this.findLookalikeExpense(tx.date, tx.amount);

        insert.run(
          batchId, tx.fitid, key, tx.rawLabel, tx.date, tx.amount, tx.isCredit ? 1 : 0,
          destination,
          destination === 'perso' ? accountOwner : null,
          rule?.enseigne ?? '', rule?.category ?? '', rule?.subcategory ?? '',
          rule ? 'rule' : 'unmatched', rule?.id ?? null, duplicateOfId,
        );
        txNew++;
      }

      this.db.prepare('UPDATE import_batches SET tx_new = ?, tx_duplicate = ? WHERE id = ?')
        .run(txNew, txDuplicate, batchId);
    });

    run();

    this.logger.log(
      `Import ${filename} (${accountOwner}) : ${txNew} nouvelles, ${txDuplicate} déjà connues`
    );
    return this.getBatch(batchId)!;
  }

  /**
   * Cherche une dépense déjà saisie à la main qui ressemble à celle-ci.
   * Même date et même montant au cent près : c'est faible comme signal, donc
   * on ne fait que signaler, jamais écarter d'office.
   */
  private findLookalikeExpense(date: string, amount: number): number | null {
    const row = this.db.prepare(
      'SELECT id FROM expenses WHERE date = ? AND abs(amount - ?) < 0.005 LIMIT 1'
    ).get(date, amount) as { id: number } | undefined;
    return row?.id ?? null;
  }

  // ── Lecture ───────────────────────────────────────────────────────────────

  getBatches(limit = 24): ImportBatch[] {
    const rows = this.db.prepare(
      'SELECT * FROM import_batches ORDER BY id DESC LIMIT ?'
    ).all(limit) as any[];
    return rows.map(r => this.mapBatch(r));
  }

  getBatch(id: number): ImportBatch | null {
    const row = this.db.prepare('SELECT * FROM import_batches WHERE id = ?').get(id) as any;
    return row ? this.mapBatch(row) : null;
  }

  getStaged(batchId: number, status?: string): StagedTransaction[] {
    let q = 'SELECT * FROM staged_transactions WHERE batch_id = ?';
    const params: (string | number)[] = [batchId];
    if (status) { q += ' AND status = ?'; params.push(status); }
    q += ' ORDER BY date ASC, id ASC';
    return (this.db.prepare(q).all(...params) as any[]).map(r => this.mapStaged(r));
  }

  /**
   * Les lignes qu'aucune règle ne couvre, tous lots confondus, regroupées par
   * motif suggéré. C'est la liste de travail : une entrée ici = une règle à
   * écrire, et ensuite ce libellé ne reviendra plus jamais.
   */
  getUnmatched(): {
    suggestedPattern: string; samples: string[]; count: number;
    totalAmount: number; stagedIds: number[];
  }[] {
    const rows = this.db.prepare(`
      SELECT id, raw_label, amount FROM staged_transactions
      WHERE source = 'unmatched' AND status = 'pending' AND is_credit = 0
      ORDER BY date ASC
    `).all() as { id: number; raw_label: string; amount: number }[];

    const groups = new Map<string, {
      suggestedPattern: string; samples: string[]; count: number;
      totalAmount: number; stagedIds: number[];
    }>();

    for (const r of rows) {
      const pattern = suggestPattern(r.raw_label);
      let g = groups.get(pattern);
      if (!g) {
        g = { suggestedPattern: pattern, samples: [], count: 0, totalAmount: 0, stagedIds: [] };
        groups.set(pattern, g);
      }
      if (!g.samples.includes(r.raw_label) && g.samples.length < 5) g.samples.push(r.raw_label);
      g.count++;
      g.totalAmount += r.amount;
      g.stagedIds.push(r.id);
    }

    return [...groups.values()].sort((a, b) => b.count - a.count);
  }

  /**
   * Rejoue le moteur de règles sur les lignes en attente.
   * À appeler après avoir ajouté des règles : les lignes qui viennent d'être
   * couvertes passent de « unmatched » à « rule », sans toucher à ce que
   * l'utilisateur a déjà corrigé à la main.
   */
  reclassifyPending(batchId?: number): { reclassified: number; stillUnmatched: number } {
    const rules = this.getRules();

    let q = `SELECT * FROM staged_transactions
             WHERE status = 'pending' AND source != 'manual' AND is_credit = 0`;
    const params: number[] = [];
    if (batchId !== undefined) { q += ' AND batch_id = ?'; params.push(batchId); }

    const rows = this.db.prepare(q).all(...params) as any[];
    const update = this.db.prepare(`
      UPDATE staged_transactions
      SET enseigne = ?, category = ?, subcategory = ?, destination = ?,
          perso_user = ?, source = 'rule', rule_id = ?
      WHERE id = ?
    `);
    const owners = this.db.prepare('SELECT account_owner FROM import_batches WHERE id = ?');

    let reclassified = 0;
    let stillUnmatched = 0;

    const run = this.db.transaction(() => {
      for (const row of rows) {
        const rule = classify(row.raw_label, rules);
        if (!rule) { if (row.source === 'unmatched') stillUnmatched++; continue; }
        if (row.source === 'rule' && row.rule_id === rule.id) continue;

        const owner = (owners.get(row.batch_id) as { account_owner: string } | undefined)?.account_owner ?? null;
        update.run(
          rule.enseigne, rule.category, rule.subcategory, rule.destination,
          rule.destination === 'perso' ? owner : null,
          rule.id, row.id,
        );
        reclassified++;
      }
    });

    run();
    this.logger.log(`Reclassement : ${reclassified} lignes couvertes, ${stillUnmatched} encore inconnues`);
    return { reclassified, stillUnmatched };
  }

  // ── Validation ────────────────────────────────────────────────────────────

  /**
   * Applique les décisions de l'écran de révision.
   *
   * Chaque ligne part vers `expenses` (commune), `personal_expenses` (perso)
   * ou nulle part (ignorée) — et toute correction peut écrire une règle, ce
   * qui est le mécanisme d'apprentissage du système.
   */
  apply(batchId: number, decisions: ApplyDecision[]): ApplyResult {
    const batch = this.getBatch(batchId);
    if (!batch) throw new BadRequestException('Lot introuvable');

    const getStagedRow = this.db.prepare(
      "SELECT * FROM staged_transactions WHERE id = ? AND batch_id = ? AND status = 'pending'"
    );
    const markApplied = this.db.prepare(
      "UPDATE staged_transactions SET status = 'applied', applied_expense_id = ?, destination = ?, perso_user = ?, enseigne = ?, category = ?, subcategory = ? WHERE id = ?"
    );
    const markRejected = this.db.prepare(
      "UPDATE staged_transactions SET status = 'rejected', destination = 'ignore' WHERE id = ?"
    );
    const bumpRule = this.db.prepare(
      "UPDATE merchant_rules SET hits = hits + 1, last_used_at = datetime('now') WHERE id = ?"
    );

    let applied = 0;
    let rejected = 0;
    let rulesLearned = 0;

    const run = this.db.transaction(() => {
      for (const d of decisions) {
        const row = getStagedRow.get(d.id, batchId) as any;
        if (!row) continue;

        if (d.destination === 'ignore') {
          markRejected.run(d.id);
          rejected++;
          continue;
        }

        const enseigne    = d.enseigne    ?? row.enseigne;
        const category    = d.category    ?? row.category;
        const subcategory = d.subcategory ?? row.subcategory;

        if (!category) {
          throw new BadRequestException(
            `Ligne « ${row.raw_label} » : catégorie manquante.`
          );
        }

        let expenseId: number;

        if (d.destination === 'maison') {
          // Le titulaire du compte est celui qui a payé.
          const expense = this.expenseSvc.create(
            batch.accountOwner, enseigne, category, subcategory,
            row.amount, row.date, '',
          );
          expenseId = expense.id;
        } else {
          const user = (d.persoUser ?? row.perso_user ?? batch.accountOwner) as ExpensePaidBy;
          const personal = this.expenseSvc.addPersonalExpense(
            user, category, row.amount, row.date, enseigne,
          );
          expenseId = personal.id;
        }

        markApplied.run(expenseId, d.destination, d.persoUser ?? row.perso_user, enseigne, category, subcategory, d.id);
        if (row.rule_id) bumpRule.run(row.rule_id);
        applied++;

        // Apprentissage : la correction d'aujourd'hui est la règle de demain.
        if (d.learnRule) {
          this.upsertRule({
            pattern: suggestPattern(row.raw_label),
            enseigne, category, subcategory,
            destination: d.destination,
            origin: 'user',
          });
          rulesLearned++;
        }
      }
    });

    run();

    if (rulesLearned) this.reclassifyPending();

    this.logger.log(
      `Lot ${batchId} : ${applied} appliquées, ${rejected} ignorées, ${rulesLearned} règles apprises`
    );
    return { applied, rejected, rulesLearned, batch: this.getBatch(batchId)! };
  }

  /** Annule un lot entier tant qu'il n'est pas validé. */
  deleteBatch(id: number): boolean {
    const applied = (this.db.prepare(
      "SELECT COUNT(*) AS n FROM staged_transactions WHERE batch_id = ? AND status = 'applied'"
    ).get(id) as any).n;
    if (applied > 0) {
      throw new BadRequestException(
        `Ce lot a déjà ${applied} ligne(s) validée(s) — supprimez-les d'abord depuis la page Maison.`
      );
    }
    this.db.prepare('DELETE FROM staged_transactions WHERE batch_id = ?').run(id);
    return this.db.prepare('DELETE FROM import_batches WHERE id = ?').run(id).changes > 0;
  }

  // ── Santé ─────────────────────────────────────────────────────────────────

  getHealth(): ImportHealth {
    const byOrigin = this.db.prepare(
      'SELECT origin, COUNT(*) AS n FROM merchant_rules GROUP BY origin'
    ).all() as { origin: RuleOrigin; n: number }[];

    const rulesByOrigin = { seed: 0, user: 0, claude: 0 } as Record<RuleOrigin, number>;
    for (const r of byOrigin) rulesByOrigin[r.origin] = r.n;

    const perBatch = this.db.prepare(`
      SELECT b.id AS batch_id,
             substr(MIN(s.date), 1, 7) AS month,
             SUM(CASE WHEN s.source != 'unmatched' THEN 1 ELSE 0 END) AS matched,
             COUNT(s.id) AS total
      FROM import_batches b
      JOIN staged_transactions s ON s.batch_id = b.id AND s.is_credit = 0
      GROUP BY b.id
      ORDER BY b.id DESC
      LIMIT 12
    `).all() as { batch_id: number; month: string; matched: number; total: number }[];

    const recentBatches = perBatch.map(b => ({
      batchId: b.batch_id,
      month: b.month ?? '',
      autoRate: b.total ? (b.matched / b.total) * 100 : 0,
    }));

    const totalMatched = perBatch.reduce((s, b) => s + b.matched, 0);
    const totalLines   = perBatch.reduce((s, b) => s + b.total, 0);

    return {
      totalRules: rulesByOrigin.seed + rulesByOrigin.user + rulesByOrigin.claude,
      rulesByOrigin,
      autoRate: totalLines ? (totalMatched / totalLines) * 100 : 0,
      recentBatches,
    };
  }

  // ── Mapping ───────────────────────────────────────────────────────────────

  private mapBatch(r: any): ImportBatch {
    const counts = this.db.prepare(`
      SELECT
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status = 'pending' AND source = 'unmatched' AND is_credit = 0 THEN 1 ELSE 0 END) AS unmatched
      FROM staged_transactions WHERE batch_id = ?
    `).get(r.id) as { pending: number | null; unmatched: number | null };

    return {
      id:           r.id,
      filename:     r.filename,
      format:       r.format,
      accountOwner: r.account_owner,
      accountMask:  r.account_mask ?? '',
      importedAt:   r.imported_at,
      txTotal:      r.tx_total,
      txNew:        r.tx_new,
      txDuplicate:  r.tx_duplicate,
      pending:      counts.pending ?? 0,
      unmatched:    counts.unmatched ?? 0,
    };
  }

  private mapStaged(r: any): StagedTransaction {
    return {
      id:               r.id,
      batchId:          r.batch_id,
      fitid:            r.fitid,
      dedupKey:         r.dedup_key,
      rawLabel:         r.raw_label,
      date:             r.date,
      amount:           r.amount,
      isCredit:         !!r.is_credit,
      destination:      r.destination,
      persoUser:        r.perso_user,
      enseigne:         r.enseigne,
      category:         r.category,
      subcategory:      r.subcategory,
      source:           r.source,
      ruleId:           r.rule_id,
      duplicateOfId:    r.duplicate_of_id,
      status:           r.status,
      appliedExpenseId: r.applied_expense_id,
    };
  }

  private mapRule(r: any): MerchantRule {
    return {
      id:          r.id,
      pattern:     r.pattern,
      matchType:   r.match_type,
      enseigne:    r.enseigne,
      category:    r.category,
      subcategory: r.subcategory,
      destination: r.destination,
      priority:    r.priority,
      hits:        r.hits,
      origin:      r.origin,
      createdAt:   r.created_at,
      lastUsedAt:  r.last_used_at,
    };
  }
}
