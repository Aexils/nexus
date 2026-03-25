import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import Database from 'better-sqlite3';
import {
  Expense, ExpenseMonthSummary, MonthlyBreakdown, MonthlySubcategory,
  PersonalExpense, PersonalBudget, BudgetSummary,
} from '@nexus/shared-types';
import * as path from 'path';

const DB_PATH = process.env['EXPENSE_DB_PATH'] ?? path.join(process.cwd(), 'nexus-expenses.db');

@Injectable()
export class ExpenseService implements OnModuleInit {
  private readonly logger = new Logger(ExpenseService.name);
  private db!: Database.Database;

  onModuleInit() {
    this.db = new Database(DB_PATH);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS expenses (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        paid_by    TEXT    NOT NULL,
        store      TEXT    NOT NULL DEFAULT '',
        category   TEXT    NOT NULL,
        amount     REAL    NOT NULL,
        date       TEXT    NOT NULL,
        created_at TEXT    NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS stores (
        id   INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT    NOT NULL UNIQUE
      );

      CREATE TABLE IF NOT EXISTS categories (
        id   INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT    NOT NULL UNIQUE
      );

      CREATE TABLE IF NOT EXISTS subcategories (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        name     TEXT NOT NULL,
        category TEXT NOT NULL,
        UNIQUE(name, category)
      );

      CREATE TABLE IF NOT EXISTS enseignes (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT NOT NULL,
        subcategory TEXT NOT NULL,
        UNIQUE(name, subcategory)
      );
    `);

    // Migration: add comment column if it doesn't exist
    try {
      this.db.exec(`ALTER TABLE expenses ADD COLUMN comment TEXT NOT NULL DEFAULT ''`);
    } catch {
      // Column already exists — safe to ignore
    }

    // Migration: add subcategory column if it doesn't exist
    try {
      this.db.exec(`ALTER TABLE expenses ADD COLUMN subcategory TEXT NOT NULL DEFAULT ''`);
    } catch {
      // Column already exists — safe to ignore
    }

    // Seed default categories if table is empty
    const catCount = (this.db.prepare('SELECT COUNT(*) as n FROM categories').get() as any).n;
    if (catCount === 0) {
      const insertCat = this.db.prepare('INSERT OR IGNORE INTO categories (name) VALUES (?)');
      for (const name of ['Courses', 'Mimi chaton', 'Restaurant', 'Divers']) {
        insertCat.run(name);
      }
    }

    this.createPersonalTables();
    this.logger.log(`Expense DB ready — ${DB_PATH}`);
  }

  private createPersonalTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS personal_expenses (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    TEXT    NOT NULL,
        category   TEXT    NOT NULL,
        amount     REAL    NOT NULL,
        date       TEXT    NOT NULL,
        comment    TEXT    NOT NULL DEFAULT '',
        created_at TEXT    NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS personal_budgets (
        user_id TEXT NOT NULL,
        month   TEXT NOT NULL,
        income  REAL NOT NULL DEFAULT 0,
        PRIMARY KEY(user_id, month)
      );
    `);
  }

  // ── Categories ────────────────────────────────────────────────────────────

  getCategories(): string[] {
    return (this.db.prepare('SELECT name FROM categories ORDER BY name COLLATE NOCASE').all() as any[]).map(r => r.name);
  }

  addCategory(name: string): string[] {
    this.db.prepare('INSERT OR IGNORE INTO categories (name) VALUES (?)').run(name.trim());
    return this.getCategories();
  }

  // ── Subcategories ─────────────────────────────────────────────────────────

  getSubcategories(category: string): string[] {
    return (this.db.prepare(
      'SELECT name FROM subcategories WHERE category = ? ORDER BY name COLLATE NOCASE'
    ).all(category) as any[]).map(r => r.name);
  }

  addSubcategory(name: string, category: string): string[] {
    this.db.prepare('INSERT OR IGNORE INTO subcategories (name, category) VALUES (?, ?)').run(name.trim(), category);
    return this.getSubcategories(category);
  }

  // ── Enseignes ─────────────────────────────────────────────────────────────

  getEnseignes(subcategory: string): string[] {
    return (this.db.prepare(
      'SELECT name FROM enseignes WHERE subcategory = ? ORDER BY name COLLATE NOCASE'
    ).all(subcategory) as any[]).map(r => r.name);
  }

  addEnseigne(name: string, subcategory: string): string[] {
    this.db.prepare('INSERT OR IGNORE INTO enseignes (name, subcategory) VALUES (?, ?)').run(name.trim(), subcategory);
    return this.getEnseignes(subcategory);
  }

  // ── Expenses ──────────────────────────────────────────────────────────────

  create(paidBy: string, enseigne: string, category: string, subcategory: string, amount: number, date: string, comment = ''): Expense {
    const info = this.db
      .prepare(`INSERT INTO expenses (paid_by, store, category, subcategory, amount, date, comment) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(paidBy, enseigne, category, subcategory, amount, date, comment);
    const row = this.db.prepare('SELECT * FROM expenses WHERE id = ?').get(info.lastInsertRowid) as any;
    return this.mapRow(row);
  }

  update(id: number, data: {
    paidBy?: string; enseigne?: string; category?: string; subcategory?: string;
    amount?: number; date?: string; comment?: string;
  }): Expense | null {
    const fields: string[] = [];
    const values: (string | number)[] = [];

    if (data.paidBy      !== undefined) { fields.push('paid_by = ?');    values.push(data.paidBy); }
    if (data.enseigne    !== undefined) { fields.push('store = ?');       values.push(data.enseigne); }
    if (data.category    !== undefined) { fields.push('category = ?');    values.push(data.category); }
    if (data.subcategory !== undefined) { fields.push('subcategory = ?'); values.push(data.subcategory); }
    if (data.amount      !== undefined) { fields.push('amount = ?');      values.push(data.amount); }
    if (data.date        !== undefined) { fields.push('date = ?');        values.push(data.date); }
    if (data.comment     !== undefined) { fields.push('comment = ?');     values.push(data.comment); }

    if (!fields.length) return null;
    values.push(id);

    this.db.prepare(`UPDATE expenses SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    const row = this.db.prepare('SELECT * FROM expenses WHERE id = ?').get(id) as any;
    return row ? this.mapRow(row) : null;
  }

  findAll(filters: { month?: string; paidBy?: string; category?: string } = {}): Expense[] {
    let query = 'SELECT * FROM expenses WHERE 1=1';
    const params: (string | number)[] = [];

    if (filters.month) {
      query += ` AND strftime('%Y-%m', date) = ?`;
      params.push(filters.month);
    }
    if (filters.paidBy) {
      query += ' AND paid_by = ?';
      params.push(filters.paidBy);
    }
    if (filters.category) {
      query += ' AND category = ?';
      params.push(filters.category);
    }

    query += ' ORDER BY date DESC, id DESC';
    return (this.db.prepare(query).all(...params) as any[]).map(r => this.mapRow(r));
  }

  delete(id: number): boolean {
    const result = this.db.prepare('DELETE FROM expenses WHERE id = ?').run(id);
    return result.changes > 0;
  }

  getMonthlyBreakdown(): MonthlyBreakdown[] {
    const rows = this.db.prepare(`
      SELECT
        strftime('%Y-%m', date) as month,
        category,
        SUM(CASE WHEN paid_by = 'alexis' THEN amount ELSE 0 END) as total_alexis,
        SUM(CASE WHEN paid_by = 'marion' THEN amount ELSE 0 END) as total_marion,
        SUM(amount) as total
      FROM expenses
      GROUP BY month, category
      ORDER BY month DESC, total DESC
    `).all() as any[];

    const map = new Map<string, MonthlyBreakdown>();
    for (const r of rows) {
      if (map.size >= 12 && !map.has(r.month)) break;
      if (!map.has(r.month)) {
        map.set(r.month, { month: r.month, totalAlexis: 0, totalMarion: 0, total: 0, categories: [], subcategories: [] });
      }
      const m = map.get(r.month)!;
      m.categories.push({ category: r.category, alexis: r.total_alexis, marion: r.total_marion, total: r.total });
      m.totalAlexis += r.total_alexis;
      m.totalMarion += r.total_marion;
      m.total       += r.total;
    }

    const subRows = this.db.prepare(`
      SELECT
        strftime('%Y-%m', date) as month,
        category,
        subcategory,
        SUM(CASE WHEN paid_by = 'alexis' THEN amount ELSE 0 END) as total_alexis,
        SUM(CASE WHEN paid_by = 'marion' THEN amount ELSE 0 END) as total_marion,
        SUM(amount) as total
      FROM expenses
      WHERE subcategory != ''
      GROUP BY month, category, subcategory
      ORDER BY month DESC, total DESC
    `).all() as any[];

    for (const sr of subRows) {
      const m = map.get(sr.month);
      if (!m) continue;
      m.subcategories.push({
        subcategory: sr.subcategory,
        category:    sr.category,
        alexis:      sr.total_alexis,
        marion:      sr.total_marion,
        total:       sr.total,
      } as MonthlySubcategory);
    }

    return Array.from(map.values());
  }

  getSummaries(): ExpenseMonthSummary[] {
    const rows = this.db.prepare(`
      SELECT
        strftime('%Y-%m', date) as month,
        SUM(CASE WHEN paid_by = 'alexis' THEN amount ELSE 0 END) as total_alexis,
        SUM(CASE WHEN paid_by = 'marion' THEN amount ELSE 0 END) as total_marion,
        SUM(amount) as total
      FROM expenses
      GROUP BY month
      ORDER BY month DESC
      LIMIT 12
    `).all() as any[];

    return rows.map(r => ({
      month:       r.month,
      totalAlexis: r.total_alexis,
      totalMarion: r.total_marion,
      total:       r.total,
    }));
  }

  // ── Personal Expenses ─────────────────────────────────────────────────────

  getPersonalExpenses(userId: string, month: string): PersonalExpense[] {
    const rows = this.db.prepare(
      `SELECT * FROM personal_expenses WHERE user_id = ? AND strftime('%Y-%m', date) = ? ORDER BY date DESC, id DESC`
    ).all(userId, month) as any[];
    return rows.map(r => this.mapPersonalRow(r));
  }

  addPersonalExpense(userId: string, category: string, amount: number, date: string, comment = ''): PersonalExpense {
    const info = this.db.prepare(
      `INSERT INTO personal_expenses (user_id, category, amount, date, comment) VALUES (?, ?, ?, ?, ?)`
    ).run(userId, category, amount, date, comment);
    const row = this.db.prepare('SELECT * FROM personal_expenses WHERE id = ?').get(info.lastInsertRowid) as any;
    return this.mapPersonalRow(row);
  }

  deletePersonalExpense(id: number): boolean {
    const result = this.db.prepare('DELETE FROM personal_expenses WHERE id = ?').run(id);
    return result.changes > 0;
  }

  getBudget(userId: string, month: string): PersonalBudget | null {
    const row = this.db.prepare(
      `SELECT * FROM personal_budgets WHERE user_id = ? AND month = ?`
    ).get(userId, month) as any;
    if (!row) return null;
    return { userId: row.user_id, month: row.month, income: row.income };
  }

  setBudget(userId: string, month: string, income: number): PersonalBudget {
    this.db.prepare(
      `INSERT INTO personal_budgets (user_id, month, income) VALUES (?, ?, ?)
       ON CONFLICT(user_id, month) DO UPDATE SET income = excluded.income`
    ).run(userId, month, income);
    return { userId: userId as any, month, income };
  }

  getBudgetSummaries(userId: string): BudgetSummary[] {
    const maisonRows = this.db.prepare(`
      SELECT strftime('%Y-%m', date) as month, SUM(amount)/2.0 as maison_share
      FROM expenses GROUP BY month ORDER BY month DESC LIMIT 12
    `).all() as { month: string; maison_share: number }[];

    const personalRows = this.db.prepare(`
      SELECT strftime('%Y-%m', date) as month, category, SUM(amount) as total
      FROM personal_expenses WHERE user_id = ?
      GROUP BY month, category ORDER BY month DESC
    `).all(userId) as { month: string; category: string; total: number }[];

    const budgetRows = this.db.prepare(`
      SELECT month, income FROM personal_budgets WHERE user_id = ? ORDER BY month DESC LIMIT 12
    `).all(userId) as { month: string; income: number }[];

    const monthSet = new Set<string>();
    for (const r of maisonRows) monthSet.add(r.month);
    for (const r of personalRows) monthSet.add(r.month);
    for (const r of budgetRows) monthSet.add(r.month);

    const months = [...monthSet].sort().reverse().slice(0, 12);

    const maisonMap = new Map(maisonRows.map(r => [r.month, r.maison_share]));
    const budgetMap = new Map(budgetRows.map(r => [r.month, r.income]));

    const personalMap = new Map<string, { category: string; total: number }[]>();
    for (const r of personalRows) {
      if (!personalMap.has(r.month)) personalMap.set(r.month, []);
      personalMap.get(r.month)!.push({ category: r.category, total: r.total });
    }

    return months.map(month => {
      const income = budgetMap.get(month) ?? 0;
      const maisonShare = maisonMap.get(month) ?? 0;
      const byCat = personalMap.get(month) ?? [];
      const personalTotal = byCat.reduce((s, x) => s + x.total, 0);
      const savings = income - maisonShare - personalTotal;
      const savingsRate = income > 0 ? (savings / income) * 100 : 0;
      return { month, income, maisonShare, personalTotal, savings, savingsRate, personalByCategory: byCat };
    });
  }

  /** Expose the DB instance for AdminService (same module, no second connection) */
  get database(): Database.Database { return this.db; }

  private mapPersonalRow(r: any): PersonalExpense {
    return {
      id:        r.id,
      userId:    r.user_id,
      category:  r.category,
      amount:    r.amount,
      date:      r.date,
      comment:   r.comment ?? '',
      createdAt: r.created_at,
    };
  }

  private mapRow(r: any): Expense {
    return {
      id:          r.id,
      paidBy:      r.paid_by,
      enseigne:    r.store ?? '',
      category:    r.category,
      subcategory: r.subcategory ?? '',
      amount:      r.amount,
      date:        r.date,
      comment:     r.comment ?? '',
      createdAt:   r.created_at,
    };
  }
}
