import {
  Component,
  ChangeDetectionStrategy,
  inject,
  computed,
  signal,
  OnInit,
  ChangeDetectorRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { NexusUser, USER_PROFILES, UserProfile, BudgetSummary } from '@nexus/shared-types';
import { PageHeaderComponent } from '../../shared/page-header/page-header';

@Component({
  selector: 'app-me-page',
  standalone: true,
  imports: [CommonModule, PageHeaderComponent],
  templateUrl: './me-page.html',
  styleUrl: './me-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MePage implements OnInit {
  private readonly route  = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly cdr    = inject(ChangeDetectorRef);
  private readonly http   = inject(HttpClient);

  // ── Utilisateur déterminé par la route (/alexis ou /marion) ──────────

  readonly userId: NexusUser = this.route.snapshot.data['user'] ?? 'alexis';
  readonly profile: UserProfile = USER_PROFILES.find(p => p.id === this.userId) ?? USER_PROFILES[0];

  // ── Budget ───────────────────────────────────────────────────────────

  readonly budgetSummary = signal<BudgetSummary | null>(null);

  readonly maisonSharePct = computed(() => {
    const s = this.budgetSummary();
    return s && s.income > 0 ? (s.maisonShare / s.income) * 100 : 0;
  });

  readonly personalPct = computed(() => {
    const s = this.budgetSummary();
    return s && s.income > 0 ? (s.personalTotal / s.income) * 100 : 0;
  });

  readonly budgetSavings = computed(() => {
    const s = this.budgetSummary();
    return s ? s.savings : null;
  });

  ngOnInit() {
    this.loadBudgetSummary();
  }

  private loadBudgetSummary(): void {
    const currentMonth = new Date().toISOString().slice(0, 7);
    this.http.get<BudgetSummary[]>('/api/expenses/budget-summary', { params: { userId: this.userId } })
      .subscribe({ next: data => {
        const current = data.find(s => s.month === currentMonth) ?? data[0] ?? null;
        this.budgetSummary.set(current);
        this.cdr.markForCheck();
      }});
  }

  // ── Navigation ───────────────────────────────────────────────────────

  openBudget(): void { this.router.navigate([`/${this.userId}/budget`]); }

  // ── Budget helpers ───────────────────────────────────────────────────

  fmtBudget(n: number): string {
    return Math.round(n).toLocaleString('fr-CA') + ' $';
  }

  budgetSavingsClass(): string {
    const s = this.budgetSavings();
    if (s === null) return '';
    return s >= 0 ? 'savings-positive' : 'savings-negative';
  }

  budgetMonth(): string {
    const s = this.budgetSummary();
    if (!s) return '';
    const [, m] = s.month.split('-');
    const LABELS: Record<string, string> = {
      '01': 'jan.', '02': 'fév.', '03': 'mar.', '04': 'avr.',
      '05': 'mai',  '06': 'jun.', '07': 'jul.', '08': 'aoû.',
      '09': 'sep.', '10': 'oct.', '11': 'nov.', '12': 'déc.',
    };
    return LABELS[m] ?? m;
  }
}
