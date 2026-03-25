import {
  Component,
  ChangeDetectionStrategy,
  inject,
  computed,
  signal,
  OnInit,
  OnDestroy,
  ChangeDetectorRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import {
  CdkDrag,
  CdkDragDrop,
  CdkDragHandle,
  CdkDragPlaceholder,
  CdkDropList,
  moveItemInArray,
} from '@angular/cdk/drag-drop';
import { NexusService } from '../../core/services/nexus.service';
import { StatusBadge } from '../../shared/components/status-badge/status-badge';
import { NexusUser, PsnPresence, USER_PROFILES, UserProfile, BudgetSummary } from '@nexus/shared-types';

type MeCardId = 'abs' | 'booklore' | 'psn' | 'sideloadly' | 'budget';
const ALL_ME_CARDS: MeCardId[] = ['abs', 'booklore', 'psn', 'sideloadly', 'budget'];

function loadMeOrder(key: string, defaults: MeCardId[]): MeCardId[] {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? '') as MeCardId[];
    if (Array.isArray(saved) && saved.length === defaults.length) return saved;
  } catch { /* use defaults */ }
  return [...defaults];
}

@Component({
  selector: 'app-me-page',
  standalone: true,
  imports: [CommonModule, StatusBadge, CdkDropList, CdkDrag, CdkDragHandle, CdkDragPlaceholder],
  templateUrl: './me-page.html',
  styleUrl: './me-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MePage implements OnInit, OnDestroy {
  private readonly route   = inject(ActivatedRoute);
  private readonly router  = inject(Router);
  private readonly cdr     = inject(ChangeDetectorRef);
  private readonly http    = inject(HttpClient);
  readonly nexus = inject(NexusService);

  // ── Utilisateur déterminé par la route (/alexis ou /marion) ──────────

  readonly userId: NexusUser = this.route.snapshot.data['user'] ?? 'alexis';
  readonly profile: UserProfile = USER_PROFILES.find(p => p.id === this.userId) ?? USER_PROFILES[0];

  // ── Statuts filtrés pour cet utilisateur ─────────────────────────────

  readonly abs      = computed(() => this.nexus.absStatusMap()[this.userId]);
  readonly psn      = computed(() => this.nexus.psnStatusMap()[this.userId]);
  readonly booklore = computed(() => this.nexus.bookloreStatusMap()[this.userId]);

  readonly sdly = this.nexus.sideloadlyStatus;

  readonly sdlyMyAccounts = computed(() => {
    const accs = this.sdly().accounts;
    if (this.userId === 'marion') {
      return accs.filter(a => a.appleId.toLowerCase().includes('rotrou.marion'));
    }
    return accs.filter(a => !a.appleId.toLowerCase().includes('rotrou.marion'));
  });

  readonly sdlyMyApps = computed(() => {
    const myAppleIds = new Set(this.sdlyMyAccounts().map(a => a.appleId));
    return this.sdly().apps.filter(app => myAppleIds.has(app.appleId));
  });

  readonly sdlyExpiringCount = computed(() =>
    this.sdlyMyApps().filter(a => a.status === 'expiring' || a.status === 'expired').length,
  );

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

  // ── Countdown clock ──────────────────────────────────────────────────

  readonly now = signal(Date.now());
  private interval?: ReturnType<typeof setInterval>;

  ngOnInit() {
    this.interval = setInterval(() => { this.now.set(Date.now()); this.cdr.markForCheck(); }, 1000);
    this.loadBudgetSummary();
  }
  ngOnDestroy() { if (this.interval) clearInterval(this.interval); }

  private loadBudgetSummary(): void {
    const currentMonth = new Date().toISOString().slice(0, 7);
    this.http.get<BudgetSummary[]>('/api/expenses/budget-summary', { params: { userId: this.userId } })
      .subscribe({ next: data => {
        const current = data.find(s => s.month === currentMonth) ?? data[0] ?? null;
        this.budgetSummary.set(current);
        this.cdr.markForCheck();
      }});
  }

  // ── DnD order ────────────────────────────────────────────────────────

  private readonly orderKey = `nexus-cards-me-${this.userId}`;

  cardOrder = signal<MeCardId[]>(loadMeOrder(this.orderKey, ALL_ME_CARDS));

  onCardDrop(event: CdkDragDrop<MeCardId[]>): void {
    const arr = [...this.cardOrder()];
    moveItemInArray(arr, event.previousIndex, event.currentIndex);
    this.cardOrder.set(arr);
    localStorage.setItem(this.orderKey, JSON.stringify(arr));
  }

  // ── ABS helpers ──────────────────────────────────────────────────────

  absProgress(currentTime: number, duration: number): number {
    return duration > 0 ? Math.round((currentTime / duration) * 100) : 0;
  }

  coverUrl(libraryItemId: string): string {
    return `/api/abs/cover/${libraryItemId}?userId=${this.userId}`;
  }

  formatDurationHuman(sec: number): string {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    if (h > 0) return `${h}h ${m}min ${s}s`;
    if (m > 0) return `${m}min ${s}s`;
    return `${s}s`;
  }

  // ── PSN helpers ──────────────────────────────────────────────────────

  presenceLabel(p: PsnPresence): string {
    switch (p) {
      case 'ingame': return 'En jeu';
      case 'online': return 'En ligne';
      case 'away':   return 'Absent';
      default:       return 'Hors ligne';
    }
  }

  presenceClass(p: PsnPresence): string {
    switch (p) {
      case 'ingame': return 'ingame';
      case 'online': return 'online';
      case 'away':   return 'away';
      default:       return 'offline';
    }
  }

  formatIsoDuration(iso: string): string {
    const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
    if (!m) return iso;
    const h  = parseInt(m[1] ?? '0', 10);
    const mn = parseInt(m[2] ?? '0', 10);
    if (h > 0) return mn > 0 ? `${h}h ${mn}min` : `${h}h`;
    return `${mn} min`;
  }

  formatRelativeIso(iso: string): string {
    try {
      const ms      = Date.now() - new Date(iso).getTime();
      const days    = Math.floor(ms / 86_400_000);
      const hours   = Math.floor(ms / 3_600_000);
      const minutes = Math.floor(ms / 60_000);
      if (minutes < 1)  return "à l'instant";
      if (hours   < 1)  return `il y a ${minutes}min`;
      if (hours   < 24) return `il y a ${hours}h`;
      if (days    < 7)  return `il y a ${days}j`;
      return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
    } catch { return ''; }
  }

  // ── Sideloadly helpers ───────────────────────────────────────────────

  formatCountdown(ms: number): string {
    if (ms <= 0) return 'Expiré';
    const totalSec = Math.floor(ms / 1000);
    const d = Math.floor(totalSec / 86400);
    const h = Math.floor((totalSec % 86400) / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    if (d > 0) return `${d}j ${h}h`;
    if (h > 0) return `${h}h ${m}min`;
    return `${m}min`;
  }

  appStatusClass(status: string): string {
    return status === 'ok' ? 'active' : status === 'expiring' ? 'warn' : 'error';
  }

  appStatusLabel(status: string): string {
    return status === 'ok' ? 'Actif' : status === 'expiring' ? 'Expire bientôt' : 'Expiré';
  }

  // ── Navigation ───────────────────────────────────────────────────────

  openAbs():      void { this.router.navigate(['/audiobookshelf']); }
  openBooklore(): void { this.router.navigate(['/booklore']); }
  openPsn():      void { this.router.navigate(['/playstation']); }
  openSdly():   void { this.router.navigate(['/sideloadly']); }
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
