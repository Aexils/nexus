import {
  Component, ChangeDetectionStrategy, inject, signal, computed, OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import {
  LucideAngularModule,
  Database, Pencil, Trash2, Check, X, ChevronDown, ChevronRight,
  Tag, Layers, Store, ReceiptText, RefreshCw,
} from 'lucide-angular';
import { Expense } from '@nexus/shared-types';

interface CatRow    { name: string; count: number; }
interface SubcatRow { name: string; category: string; count: number; }
interface EnsRow    { name: string; subcategory: string; count: number; }

type Tab = 'categories' | 'subcategories' | 'enseignes' | 'expenses' | 'database';

const MONTH_LABELS: Record<string, string> = {
  '01': 'jan.', '02': 'fév.', '03': 'mar.', '04': 'avr.',
  '05': 'mai',  '06': 'jun.', '07': 'jul.', '08': 'aoû.',
  '09': 'sep.', '10': 'oct.', '11': 'nov.', '12': 'déc.',
};

@Component({
  selector: 'app-admin-page',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule],
  templateUrl: './admin-page.html',
  styleUrl: './admin-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminPage implements OnInit {
  private readonly http = inject(HttpClient);

  readonly icons = { Database, Pencil, Trash2, Check, X, ChevronDown, ChevronRight, Tag, Layers, Store, ReceiptText, RefreshCw };

  // ── Tabs ──────────────────────────────────────────────────────────────────

  readonly activeTab = signal<Tab>('categories');

  // ── Categories ────────────────────────────────────────────────────────────

  readonly cats    = signal<CatRow[]>([]);
  readonly editCat = signal<string | null>(null);  // oldName being edited
  editCatName    = '';
  editCatCascade = false;

  // ── Subcategories ─────────────────────────────────────────────────────────

  readonly subcats    = signal<SubcatRow[]>([]);
  readonly editSubcat = signal<string | null>(null);  // 'name|category'
  editSubcatName     = '';
  editSubcatCategory = '';
  editSubcatCascade  = false;

  // All category names for subcategory parent dropdown
  readonly catNames = computed(() => this.cats().map(c => c.name));

  // ── Enseignes ─────────────────────────────────────────────────────────────

  readonly ensRows    = signal<EnsRow[]>([]);
  readonly editEns    = signal<string | null>(null);  // 'name|subcategory'
  editEnsName        = '';
  editEnsSubcat      = '';
  editEnsCascade     = false;

  // All subcategory names for enseigne parent dropdown
  readonly subcatNames = computed(() => [...new Set(this.subcats().map(s => s.name))].sort());

  // ── Database explorer ─────────────────────────────────────────────────────

  readonly dbSchema        = signal<{ name: string; rowCount: number; columns: string[] }[]>([]);
  readonly selectedDbTable = signal<string | null>(null);
  readonly dbTableData     = signal<{ columns: string[]; rows: any[][] } | null>(null);
  readonly dbLoading       = signal(false);

  loadSchema() {
    this.http.get<{ name: string; rowCount: number; columns: string[] }[]>('/api/admin/schema').subscribe(s => {
      this.dbSchema.set(s);
      if (s.length && !this.selectedDbTable()) this.selectDbTable(s[0].name);
    });
  }

  selectDbTable(name: string) {
    this.selectedDbTable.set(name);
    this.dbLoading.set(true);
    this.http.get<{ columns: string[]; rows: any[][] }>(`/api/admin/table/${name}`).subscribe(d => {
      this.dbTableData.set(d);
      this.dbLoading.set(false);
    });
  }

  // ── Expenses ──────────────────────────────────────────────────────────────

  readonly allExpenses   = signal<Expense[]>([]);
  readonly expFilter     = signal('');
  readonly confirmDeleteId = signal<number | null>(null);

  readonly filteredExpenses = computed(() => {
    const q = this.expFilter().toLowerCase().trim();
    if (!q) return this.allExpenses();
    return this.allExpenses().filter(e =>
      e.category.toLowerCase().includes(q)  ||
      e.subcategory.toLowerCase().includes(q) ||
      e.enseigne.toLowerCase().includes(q)  ||
      e.paidBy.toLowerCase().includes(q)    ||
      e.comment.toLowerCase().includes(q)   ||
      String(e.amount).includes(q)          ||
      e.date.includes(q)
    );
  });

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  ngOnInit() {
    this.loadAll();
  }

  loadAll() {
    this.loadCats();
    this.loadSubcats();
    this.loadEnseignes();
    this.loadExpenses();
  }

  // ── Loaders ────────────────────────────────────────────────────────────────

  loadCats() {
    this.http.get<CatRow[]>('/api/admin/categories').subscribe({ next: d => this.cats.set(d) });
  }

  loadSubcats() {
    this.http.get<SubcatRow[]>('/api/admin/subcategories').subscribe({ next: d => this.subcats.set(d) });
  }

  loadEnseignes() {
    this.http.get<EnsRow[]>('/api/admin/enseignes').subscribe({ next: d => this.ensRows.set(d) });
  }

  loadExpenses() {
    this.http.get<Expense[]>('/api/admin/expenses').subscribe({ next: d => this.allExpenses.set(d) });
  }

  // ── Category edit ──────────────────────────────────────────────────────────

  startEditCat(cat: CatRow) {
    this.editCat.set(cat.name);
    this.editCatName    = cat.name;
    this.editCatCascade = false;
  }

  cancelEditCat() { this.editCat.set(null); }

  saveEditCat(oldName: string) {
    const newName = this.editCatName.trim();
    if (!newName) return;
    this.http.patch<CatRow[]>('/api/admin/categories', {
      oldName, newName, cascade: this.editCatCascade,
    }).subscribe({ next: d => { this.cats.set(d); this.editCat.set(null); this.loadSubcats(); } });
  }

  deleteCat(name: string) {
    this.http.delete<CatRow[]>(`/api/admin/categories?name=${encodeURIComponent(name)}`)
      .subscribe({ next: d => this.cats.set(d) });
  }

  // ── Subcategory edit ───────────────────────────────────────────────────────

  subcatKey(s: SubcatRow) { return `${s.name}|${s.category}`; }

  startEditSubcat(s: SubcatRow) {
    this.editSubcat.set(this.subcatKey(s));
    this.editSubcatName     = s.name;
    this.editSubcatCategory = s.category;
    this.editSubcatCascade  = false;
  }

  cancelEditSubcat() { this.editSubcat.set(null); }

  saveEditSubcat(s: SubcatRow) {
    const newName = this.editSubcatName.trim();
    const newCat  = this.editSubcatCategory.trim();
    if (!newName || !newCat) return;
    this.http.patch<SubcatRow[]>('/api/admin/subcategories', {
      oldName: s.name, oldCategory: s.category,
      newName, newCategory: newCat,
      cascade: this.editSubcatCascade,
    }).subscribe({ next: d => { this.subcats.set(d); this.editSubcat.set(null); this.loadEnseignes(); } });
  }

  deleteSubcat(s: SubcatRow) {
    this.http.delete<SubcatRow[]>(
      `/api/admin/subcategories?name=${encodeURIComponent(s.name)}&category=${encodeURIComponent(s.category)}`
    ).subscribe({ next: d => this.subcats.set(d) });
  }

  // ── Enseigne edit ──────────────────────────────────────────────────────────

  ensKey(e: EnsRow) { return `${e.name}|${e.subcategory}`; }

  startEditEns(e: EnsRow) {
    this.editEns.set(this.ensKey(e));
    this.editEnsName   = e.name;
    this.editEnsSubcat = e.subcategory;
    this.editEnsCascade = false;
  }

  cancelEditEns() { this.editEns.set(null); }

  saveEditEns(e: EnsRow) {
    const newName   = this.editEnsName.trim();
    const newSubcat = this.editEnsSubcat.trim();
    if (!newName || !newSubcat) return;
    this.http.patch<EnsRow[]>('/api/admin/enseignes', {
      oldName: e.name, oldSubcategory: e.subcategory,
      newName, newSubcategory: newSubcat,
      cascade: this.editEnsCascade,
    }).subscribe({ next: d => { this.ensRows.set(d); this.editEns.set(null); } });
  }

  deleteEns(e: EnsRow) {
    this.http.delete<EnsRow[]>(
      `/api/admin/enseignes?name=${encodeURIComponent(e.name)}&subcategory=${encodeURIComponent(e.subcategory)}`
    ).subscribe({ next: d => this.ensRows.set(d) });
  }

  // ── Expenses ───────────────────────────────────────────────────────────────

  deleteExpense(id: number) {
    this.http.delete(`/api/admin/expenses/${id}`).subscribe({
      next: () => {
        this.allExpenses.update(l => l.filter(e => e.id !== id));
        this.confirmDeleteId.set(null);
      },
    });
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  fmt(n: number): string {
    return n.toLocaleString('fr-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 2 });
  }

  formatDate(d: string): string {
    const [y, m, day] = d.split('-');
    return `${day} ${MONTH_LABELS[m] ?? m} ${y}`;
  }

  trackCat(_: number, r: CatRow)    { return r.name; }
  trackSubcat(_: number, r: SubcatRow) { return `${r.name}|${r.category}`; }
  trackEns(_: number, r: EnsRow)    { return `${r.name}|${r.subcategory}`; }
  trackExp(_: number, e: Expense)   { return e.id; }
}
