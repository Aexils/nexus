import {
  Component, ChangeDetectionStrategy, inject, signal, computed, OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  LucideAngularModule,
  ChevronLeft, ChevronRight, PlusCircle, Trash2, CheckCircle, Pencil,
} from 'lucide-angular';
import {
  PersonalExpense, PersonalBudget, BudgetSummary, PERSONAL_CATEGORIES, NexusUser,
} from '@nexus/shared-types';

const MONTH_LABELS: Record<string, string> = {
  '01': 'jan.', '02': 'fév.', '03': 'mar.', '04': 'avr.',
  '05': 'mai',  '06': 'jun.', '07': 'jul.', '08': 'aoû.',
  '09': 'sep.', '10': 'oct.', '11': 'nov.', '12': 'déc.',
};

interface Insight {
  icon: string;
  title: string;
  body: string;
  type: 'good' | 'warn' | 'bad' | 'info';
}

@Component({
  selector: 'app-budget-page',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule, RouterLink],
  templateUrl: './budget-page.html',
  styleUrl: './budget-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BudgetPage implements OnInit {
  private readonly http   = inject(HttpClient);
  private readonly route  = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly icons = { ChevronLeft, ChevronRight, PlusCircle, Trash2, CheckCircle, Pencil };
  readonly Math = Math;

  // ── State ──────────────────────────────────────────────────────────────────

  readonly userId: NexusUser = this.route.snapshot.data['user'] ?? 'alexis';
  readonly displayName = this.userId === 'alexis' ? 'Alexis' : 'Marion';

  readonly selectedMonth  = signal(this.currentMonthStr());
  readonly expenses       = signal<PersonalExpense[]>([]);
  readonly summaries      = signal<BudgetSummary[]>([]);
  readonly currentBudget  = signal<PersonalBudget | null>(null);

  readonly editingIncome  = signal(false);
  readonly submitting     = signal(false);
  readonly success        = signal(false);

  incomeInput = '';
  formCategory: string = PERSONAL_CATEGORIES[0];
  formAmount   = '';
  formDate     = this.todayStr();
  formComment  = '';

  readonly personalCategories = PERSONAL_CATEGORIES;

  // ── Computeds ──────────────────────────────────────────────────────────────

  readonly income = computed(() => this.currentBudget()?.income ?? 0);

  readonly currentSummary = computed(() =>
    this.summaries().find(s => s.month === this.selectedMonth()) ?? null
  );

  readonly maisonShare = computed(() => this.currentSummary()?.maisonShare ?? 0);

  readonly personalTotal = computed(() =>
    this.expenses().reduce((s, e) => s + e.amount, 0)
  );

  readonly savings = computed(() =>
    this.income() - this.maisonShare() - this.personalTotal()
  );

  readonly savingsRate = computed(() => {
    const inc = this.income();
    return inc > 0 ? (this.savings() / inc) * 100 : 0;
  });

  readonly insights = computed<Insight[]>(() => {
    const rate    = this.savingsRate();
    const savings = this.savings();
    const summs   = this.summaries();
    const exps    = this.expenses();
    const result: Insight[] = [];

    if (this.income() <= 0) {
      result.push({ icon: '💡', title: 'Revenu non défini', body: 'Définissez votre revenu pour activer les insights.', type: 'info' });
    } else if (rate >= 20) {
      result.push({ icon: '🏆', title: 'Excellent taux d\'épargne', body: `${rate.toFixed(1)}% — continuez ainsi !`, type: 'good' });
    } else if (rate >= 10) {
      result.push({ icon: '📊', title: 'Bonne épargne', body: `${rate.toFixed(1)}% — visez 20% pour l'avenir.`, type: 'info' });
    } else if (rate >= 0) {
      result.push({ icon: '⚠️', title: 'Épargne faible', body: `Seulement ${rate.toFixed(1)}% d'épargne ce mois.`, type: 'warn' });
    } else {
      result.push({ icon: '🚨', title: 'Budget dépassé', body: `${Math.abs(savings).toFixed(0)} $ de trop vs vos revenus.`, type: 'bad' });
    }

    const idx = summs.findIndex(s => s.month === this.selectedMonth());
    if (idx >= 0 && idx < summs.length - 1) {
      const prev = summs[idx + 1];
      const diff = savings - prev.savings;
      if (diff > 0) {
        result.push({ icon: '📈', title: 'Mieux qu\'avant', body: `+${Math.round(diff)} $ vs mois précédent.`, type: 'good' });
      } else if (diff < 0) {
        result.push({ icon: '📉', title: 'Moins qu\'avant', body: `${Math.round(diff)} $ vs mois précédent.`, type: 'warn' });
      }
    }

    if (exps.length > 0) {
      const catMap: Record<string, number> = {};
      for (const e of exps) catMap[e.category] = (catMap[e.category] ?? 0) + e.amount;
      const [topCat, topAmt] = Object.entries(catMap).sort((a, b) => b[1] - a[1])[0];
      result.push({ icon: '🔍', title: `Top : ${topCat}`, body: `${Math.round(topAmt)} $ en ${topCat} ce mois.`, type: 'info' });
    }

    const sel = this.selectedMonth();
    const [y, m] = sel.split('-').map(Number);
    if (sel === this.currentMonthStr() && exps.length > 0) {
      const day         = new Date().getDate();
      const daysInMonth = new Date(y, m, 0).getDate();
      const projected   = (this.personalTotal() / day) * daysInMonth;
      result.push({ icon: '🔮', title: 'Projection fin de mois', body: `~${Math.round(projected)} $ de dépenses perso estimées.`, type: 'info' });
    }

    return result;
  });

  readonly savingsBarData = computed(() => {
    const data = [...this.summaries()].reverse();
    if (!data.length) return [];
    const maxAbs = Math.max(...data.map(s => Math.abs(s.savings)), 1);
    return data.map(s => ({
      month:     s.month,
      label:     MONTH_LABELS[s.month.split('-')[1]] ?? s.month.split('-')[1],
      savings:   s.savings,
      height:    (Math.abs(s.savings) / maxAbs) * 80,
      positive:  s.savings >= 0,
      isCurrent: s.month === this.selectedMonth(),
    }));
  });

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  ngOnInit(): void {
    this.loadSummaries();
    this.loadExpenses();
    this.loadBudget();
  }

  // ── Data ───────────────────────────────────────────────────────────────────

  loadExpenses(): void {
    this.http.get<PersonalExpense[]>('/api/expenses/personal', {
      params: { userId: this.userId, month: this.selectedMonth() },
    }).subscribe({ next: d => this.expenses.set(d) });
  }

  loadSummaries(): void {
    this.http.get<BudgetSummary[]>('/api/expenses/budget-summary', {
      params: { userId: this.userId },
    }).subscribe({ next: d => this.summaries.set(d) });
  }

  loadBudget(): void {
    this.http.get<PersonalBudget | null>('/api/expenses/budget', {
      params: { userId: this.userId, month: this.selectedMonth() },
    }).subscribe({ next: d => this.currentBudget.set(d ?? null) });
  }

  // ── Month navigation ───────────────────────────────────────────────────────

  prevMonth(): void {
    this.selectedMonth.update(m => this.offsetMonth(m, -1));
    this.loadExpenses(); this.loadBudget();
  }

  nextMonth(): void {
    this.selectedMonth.update(m => this.offsetMonth(m, 1));
    this.loadExpenses(); this.loadBudget();
  }

  // ── Income edit ────────────────────────────────────────────────────────────

  startEditIncome(): void {
    this.incomeInput = this.income() > 0 ? String(this.income()) : '';
    this.editingIncome.set(true);
  }

  saveIncome(): void {
    const val = parseFloat(this.incomeInput);
    if (isNaN(val) || val < 0) { this.editingIncome.set(false); return; }
    this.http.put<PersonalBudget>('/api/expenses/budget', {
      userId: this.userId, month: this.selectedMonth(), income: val,
    }).subscribe({ next: b => {
      this.currentBudget.set(b);
      this.loadSummaries();
      this.editingIncome.set(false);
    }});
  }

  cancelEditIncome(): void { this.editingIncome.set(false); }

  // ── Expense form ───────────────────────────────────────────────────────────

  submit(): void {
    const amount = parseFloat(this.formAmount);
    if (!this.formCategory || isNaN(amount) || amount <= 0 || !this.formDate) return;
    this.submitting.set(true);
    this.http.post<PersonalExpense>('/api/expenses/personal', {
      userId: this.userId, category: this.formCategory,
      amount, date: this.formDate, comment: this.formComment,
    }).subscribe({
      next: () => {
        this.submitting.set(false);
        this.success.set(true);
        setTimeout(() => this.success.set(false), 2000);
        this.formAmount  = '';
        this.formComment = '';
        this.loadExpenses(); this.loadSummaries();
      },
      error: () => this.submitting.set(false),
    });
  }

  deleteExpense(id: number): void {
    this.http.delete(`/api/expenses/personal/${id}`).subscribe({
      next: () => { this.expenses.update(l => l.filter(e => e.id !== id)); this.loadSummaries(); },
    });
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  fmt(n: number): string {
    return Math.abs(n).toLocaleString('fr-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' $';
  }

  fmtSigned(n: number): string {
    const abs = Math.abs(n).toLocaleString('fr-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (n >= 0 ? '+' : '−') + abs + ' $';
  }

  formatDate(d: string): string {
    return new Date(d + 'T12:00:00').toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' });
  }

  monthDisplayLabel(ym: string): string {
    const [year, month] = ym.split('-');
    const l = MONTH_LABELS[month] ?? month;
    return `${l.charAt(0).toUpperCase() + l.slice(1)} ${year}`;
  }

  isCurrentMonth(): boolean { return this.selectedMonth() === this.currentMonthStr(); }

  savingsClass(): string {
    const s = this.savings();
    if (s > 0)  return 'positive';
    if (s < 0)  return 'negative';
    return 'zero';
  }

  insightClass(t: Insight['type']): string {
    return `insight-${t}`;
  }

  backUrl(): string {
    return `/${this.userId}`;
  }

  private currentMonthStr(): string { return new Date().toISOString().slice(0, 7); }
  private todayStr(): string        { return new Date().toISOString().slice(0, 10); }

  private offsetMonth(ym: string, delta: number): string {
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
}
