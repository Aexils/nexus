import { Injectable } from '@nestjs/common';
import { ExpenseService } from '../expense/expense.service';
import { Expense } from '@nexus/shared-types';

export interface CategoryRow    { name: string; count: number; }
export interface SubcategoryRow { name: string; category: string; count: number; }
export interface EnseigneRow    { name: string; subcategory: string; count: number; }

@Injectable()
export class AdminService {
  constructor(private readonly expenseSvc: ExpenseService) {}

  private get db() { return this.expenseSvc.database; }

  // ── Categories ────────────────────────────────────────────────────────────

  getCategories(): CategoryRow[] {
    return this.db.prepare(`
      SELECT c.name, COUNT(e.id) as count
      FROM categories c
      LEFT JOIN expenses e ON e.category = c.name
      GROUP BY c.name
      ORDER BY c.name COLLATE NOCASE
    `).all() as CategoryRow[];
  }

  renameCategory(oldName: string, newName: string, cascade: boolean): CategoryRow[] {
    this.db.prepare('UPDATE categories SET name = ? WHERE name = ?').run(newName, oldName);
    if (cascade) {
      this.db.prepare('UPDATE expenses SET category = ? WHERE category = ?').run(newName, oldName);
      // Also cascade to subcategories
      this.db.prepare('UPDATE subcategories SET category = ? WHERE category = ?').run(newName, oldName);
    }
    return this.getCategories();
  }

  deleteCategory(name: string): CategoryRow[] {
    this.db.prepare('DELETE FROM categories WHERE name = ?').run(name);
    return this.getCategories();
  }

  // ── Subcategories ─────────────────────────────────────────────────────────

  getSubcategories(): SubcategoryRow[] {
    return this.db.prepare(`
      SELECT s.name, s.category, COUNT(e.id) as count
      FROM subcategories s
      LEFT JOIN expenses e ON e.subcategory = s.name AND e.category = s.category
      GROUP BY s.name, s.category
      ORDER BY s.category COLLATE NOCASE, s.name COLLATE NOCASE
    `).all() as SubcategoryRow[];
  }

  renameSubcategory(
    oldName: string, oldCategory: string,
    newName: string, newCategory: string,
    cascade: boolean,
  ): SubcategoryRow[] {
    this.db.prepare(
      'UPDATE subcategories SET name = ?, category = ? WHERE name = ? AND category = ?'
    ).run(newName, newCategory, oldName, oldCategory);
    // Update enseignes that referenced this subcategory
    this.db.prepare('UPDATE enseignes SET subcategory = ? WHERE subcategory = ?').run(newName, oldName);
    if (cascade) {
      this.db.prepare(
        'UPDATE expenses SET subcategory = ?, category = ? WHERE subcategory = ? AND category = ?'
      ).run(newName, newCategory, oldName, oldCategory);
    }
    return this.getSubcategories();
  }

  deleteSubcategory(name: string, category: string): SubcategoryRow[] {
    this.db.prepare('DELETE FROM subcategories WHERE name = ? AND category = ?').run(name, category);
    return this.getSubcategories();
  }

  // ── Enseignes ─────────────────────────────────────────────────────────────

  getEnseignes(): EnseigneRow[] {
    return this.db.prepare(`
      SELECT en.name, en.subcategory, COUNT(e.id) as count
      FROM enseignes en
      LEFT JOIN expenses e ON e.store = en.name AND e.subcategory = en.subcategory
      GROUP BY en.name, en.subcategory
      ORDER BY en.subcategory COLLATE NOCASE, en.name COLLATE NOCASE
    `).all() as EnseigneRow[];
  }

  renameEnseigne(
    oldName: string, oldSubcategory: string,
    newName: string, newSubcategory: string,
    cascade: boolean,
  ): EnseigneRow[] {
    this.db.prepare(
      'UPDATE enseignes SET name = ?, subcategory = ? WHERE name = ? AND subcategory = ?'
    ).run(newName, newSubcategory, oldName, oldSubcategory);
    if (cascade) {
      this.db.prepare(
        'UPDATE expenses SET store = ?, subcategory = ? WHERE store = ? AND subcategory = ?'
      ).run(newName, newSubcategory, oldName, oldSubcategory);
    }
    return this.getEnseignes();
  }

  deleteEnseigne(name: string, subcategory: string): EnseigneRow[] {
    this.db.prepare('DELETE FROM enseignes WHERE name = ? AND subcategory = ?').run(name, subcategory);
    return this.getEnseignes();
  }

  // ── DB Explorer ───────────────────────────────────────────────────────────

  getSchema(): { name: string; rowCount: number; columns: string[] }[] {
    const tables = this.db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`
    ).all() as { name: string }[];
    return tables.map(t => {
      const cols = (this.db.prepare(`PRAGMA table_info("${t.name}")`).all() as any[]).map(c => c.name);
      const rowCount = (this.db.prepare(`SELECT COUNT(*) as n FROM "${t.name}"`).get() as any).n;
      return { name: t.name, rowCount, columns: cols };
    });
  }

  getTableData(tableName: string): { columns: string[]; rows: any[][] } {
    const ALLOWED = ['expenses', 'categories', 'subcategories', 'enseignes', 'stores', 'sqlite_sequence'];
    if (!ALLOWED.includes(tableName)) throw new Error('Table non autorisée');
    const cols = (this.db.prepare(`PRAGMA table_info("${tableName}")`).all() as any[]).map(c => c.name);
    const rows = (this.db.prepare(`SELECT * FROM "${tableName}" ORDER BY rowid DESC LIMIT 500`).all() as any[])
      .map(r => cols.map(c => r[c]));
    return { columns: cols, rows };
  }

  // ── Expenses (admin: all, no month filter) ────────────────────────────────

  getAllExpenses(): Expense[] {
    return (this.db.prepare('SELECT * FROM expenses ORDER BY date DESC, id DESC').all() as any[])
      .map(r => ({
        id:          r.id,
        paidBy:      r.paid_by,
        enseigne:    r.store ?? '',
        category:    r.category,
        subcategory: r.subcategory ?? '',
        amount:      r.amount,
        date:        r.date,
        comment:     r.comment ?? '',
        createdAt:   r.created_at,
      }));
  }

  deleteExpense(id: number): boolean {
    return this.expenseSvc.delete(id);
  }
}
