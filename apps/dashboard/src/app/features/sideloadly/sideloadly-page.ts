import { Component, ChangeDetectionStrategy, inject, OnInit, OnDestroy, ChangeDetectorRef, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  LucideAngularModule,
  Smartphone, WifiOff, RefreshCw, AlertTriangle, CheckCircle, Clock, User, Tablet,
} from 'lucide-angular';
import { NexusService } from '../../core/services/nexus.service';
import { SideloadlyApp } from '@nexus/shared-types';

@Component({
  selector: 'app-sideloadly-page',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  templateUrl: './sideloadly-page.html',
  styleUrl: './sideloadly-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SideloadlyPage implements OnInit, OnDestroy {
  private readonly cdr   = inject(ChangeDetectorRef);
  private readonly nexus = inject(NexusService);

  readonly sideloadly = this.nexus.sideloadlyStatus;
  readonly icons = { Smartphone, WifiOff, RefreshCw, AlertTriangle, CheckCircle, Clock, User, Tablet };

  readonly now = signal(Date.now());
  private interval?: ReturnType<typeof setInterval>;

  ngOnInit() {
    this.interval = setInterval(() => {
      this.now.set(Date.now());
      this.cdr.markForCheck();
    }, 1000);
  }

  ngOnDestroy() {
    if (this.interval) clearInterval(this.interval);
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  formatCountdown(ms: number): string {
    if (ms <= 0) return 'Expiré';
    const totalSec = Math.floor(ms / 1000);
    const d = Math.floor(totalSec / 86400);
    const h = Math.floor((totalSec % 86400) / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    if (d > 0) return `${d}j ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }

  liveExpiresMs(app: SideloadlyApp): number {
    return new Date(app.nextRenewalAt).getTime() - this.now();
  }

  formatDate(iso: string): string {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('fr-FR', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
    } catch { return '—'; }
  }

  shortDate(iso: string): string {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
    } catch { return '—'; }
  }

  accountLabel(appleId: string): string {
    return appleId.split('@')[0];
  }

  statusClass(app: SideloadlyApp): string {
    return app.status;
  }

  badgeLabel(app: SideloadlyApp): string {
    if (app.status === 'expired')  return 'Expiré';
    if (app.status === 'expiring') return 'Expire bientôt';
    return 'Actif';
  }

  get totalApps()    { return this.sideloadly().apps.length; }
  get expiredCount() { return this.sideloadly().apps.filter(a => a.status === 'expired').length; }
  get expiringCount(){ return this.sideloadly().apps.filter(a => a.status === 'expiring').length; }
  get errorCount()   { return this.sideloadly().apps.filter(a => a.failuresCount > 0).length; }
}
