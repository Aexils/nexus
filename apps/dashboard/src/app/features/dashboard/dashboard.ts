import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDragPlaceholder, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
import { NexusService } from '../../core/services/nexus.service';
import { StatusBadge } from '../../shared/components/status-badge/status-badge';
import { LogLevel, LogSource } from '@nexus/shared-types';

type FilterLevel  = LogLevel | 'all';
type FilterSource = LogSource | 'all';
type SectionId = 'grid' | 'log';
type CardId    = 'kodi' | 'abs' | 'jellyfin' | 'psn' | 'sideloadly' | 'urbackup' | 'booklore';

const ALL_CARDS: CardId[]    = ['kodi', 'abs', 'booklore', 'jellyfin', 'psn', 'sideloadly', 'urbackup'];
const ALL_SECTIONS: SectionId[] = ['grid', 'log'];

function loadOrder<T>(key: string, defaults: T[]): T[] {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? '') as T[];
    if (Array.isArray(saved) && saved.length === defaults.length) return saved;
  } catch { /* use defaults */ }
  return [...defaults];
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, StatusBadge, CdkDropList, CdkDrag, CdkDragHandle, CdkDragPlaceholder],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Dashboard {
  private readonly router = inject(Router);
  readonly nexus = inject(NexusService);

  // ── DnD order ─────────────────────────────────────────────────────────────

  sectionOrder = signal<SectionId[]>(loadOrder('nexus-sections-dashboard', ALL_SECTIONS));
  cardOrder    = signal<CardId[]>(loadOrder('nexus-cards-dashboard', ALL_CARDS));

  onSectionDrop(event: CdkDragDrop<SectionId[]>): void {
    const arr = [...this.sectionOrder()];
    moveItemInArray(arr, event.previousIndex, event.currentIndex);
    this.sectionOrder.set(arr);
    localStorage.setItem('nexus-sections-dashboard', JSON.stringify(arr));
  }

  onCardDrop(event: CdkDragDrop<CardId[]>): void {
    const arr = [...this.cardOrder()];
    moveItemInArray(arr, event.previousIndex, event.currentIndex);
    this.cardOrder.set(arr);
    localStorage.setItem('nexus-cards-dashboard', JSON.stringify(arr));
  }

  // ── Status getters ────────────────────────────────────────────────────────

  get kodiConnected():  boolean { return this.nexus.kodiStatus().connected; }
  get kodiVersion():    string  { return this.nexus.kodiStatus().nowPlaying ? '' : ''; }
  get kodiLastActivity(): number | null {
    const lp = this.nexus.kodiStatus().lastPlayed;
    return lp ? Math.floor(new Date(lp.stoppedAt).getTime() / 1000) : null;
  }

  get absConnected():    boolean { return this.nexus.absStatusMap().alexis.connected || this.nexus.absStatusMap().marion.connected; }
  get absVersion(): string | undefined { return this.nexus.absStatusMap().alexis.version ?? this.nexus.absStatusMap().marion.version; }
  get absTotalSessions(): number {
    const m = this.nexus.absStatusMap();
    return m.alexis.activeSessions.length + m.marion.activeSessions.length;
  }

  get psnBothConnected(): boolean {
    const m = this.nexus.psnStatusMap();
    return m.alexis.connected && m.marion.connected;
  }
  get psnAnyConnected(): boolean {
    const m = this.nexus.psnStatusMap();
    return m.alexis.connected || m.marion.connected;
  }

  get sdlyConnected():    boolean      { return this.nexus.sideloadlyStatus().connected; }
  get sdlyVersion():      string | undefined { return this.nexus.sideloadlyStatus().version; }
  get sdlyDaemonAlive():  boolean      { return this.nexus.sideloadlyStatus().daemon.alive; }
  get sdlyAppCount():     number       { return this.nexus.sideloadlyStatus().apps.length; }
  get sdlyExpiringCount(): number      { return this.nexus.sideloadlyStatus().apps.filter(a => a.status === 'expiring' || a.status === 'expired').length; }
  get sdlyRamMB():        number | null { return this.nexus.sideloadlyStatus().daemon.ramMB; }
  get sdlyUptimeSec():    number | null { return this.nexus.sideloadlyStatus().daemon.uptimeSec; }
  get sdlyNearestMs():    number | null {
    const accs = this.nexus.sideloadlyStatus().accounts;
    if (!accs.length) return null;
    return Math.min(...accs.map(a => a.nextRenewalMs));
  }

  get urbConnected():   boolean { return this.nexus.urbackupStatus().connected; }
  get urbOnlineCount(): number  { return this.nexus.urbackupStatus().clients.filter(c => c.online).length; }
  get urbTotalClients(): number { return this.nexus.urbackupStatus().clients.length; }
  get urbIsRunning():   boolean { return this.nexus.urbackupStatus().activeProgress.length > 0; }
  get urbLastBackupTs(): number | null {
    const clients = this.nexus.urbackupStatus().clients;
    const ts = clients.flatMap(c => [c.lastFileBackup, c.lastImageBackup]).filter((t): t is number => t !== null);
    return ts.length ? Math.max(...ts) : null;
  }

  get blConnected():     boolean {
    const m = this.nexus.bookloreStatusMap();
    return m.alexis.connected || m.marion.connected;
  }
  get blTotalBooks():    number {
    const m = this.nexus.bookloreStatusMap();
    return (m.alexis.totalBooks ?? 0) + (m.marion.totalBooks ?? 0 );
  }
  get blReadingCount():  number {
    const m = this.nexus.bookloreStatusMap();
    return m.alexis.currentlyReading.length + m.marion.currentlyReading.length;
  }
  get blVersion():       string | undefined {
    const m = this.nexus.bookloreStatusMap();
    return m.alexis.version ?? m.marion.version;
  }
  get jfConnected():     boolean { return this.nexus.jellyfinStatus().connected; }
  get jfActiveSessions(): number { return this.nexus.jellyfinStatus().activeSessions.length; }
  get jfServerName():    string | undefined { return this.nexus.jellyfinStatus().serverName; }
  get jfVersion():       string | undefined { return this.nexus.jellyfinStatus().version; }

  get connectedCount(): number {
    return (this.kodiConnected ? 1 : 0) + (this.absConnected ? 1 : 0) +
           (this.blConnected ? 1 : 0) +
           (this.jfConnected ? 1 : 0) +
           (this.psnAnyConnected ? 1 : 0) + (this.sdlyConnected ? 1 : 0) + (this.urbConnected ? 1 : 0);
  }

  // ── Log filters ───────────────────────────────────────────────────────────

  filterLevel  = signal<FilterLevel>('all');
  filterSource = signal<FilterSource>('all');
  showDebug    = signal(false);

  readonly filteredLogs = computed(() => {
    const level  = this.filterLevel();
    const source = this.filterSource();
    const debug  = this.showDebug();
    return this.nexus.logs().filter(e =>
      (debug  || e.level !== 'debug') &&
      (level  === 'all' || e.level  === level) &&
      (source === 'all' || e.source === source),
    );
  });

  setFilterLevel(level: FilterLevel):  void { this.filterLevel.set(level); }
  setFilterSource(src: FilterSource):  void { this.filterSource.set(src); }
  toggleDebug():                       void { this.showDebug.update(v => !v); }
  clearLogs():                         void { this.nexus.logs.set([]); }

  logLevelClass(level: LogLevel): string {
    return level === 'ok' ? 'ok' : level === 'warn' ? 'warn' : level === 'error' ? 'error' : level === 'debug' ? 'debug' : 'info';
  }
  logLevelLabel(level: LogLevel): string {
    return level === 'ok' ? 'OK' : level === 'debug' ? 'DBG' : level.toUpperCase();
  }

  // ── Navigation ────────────────────────────────────────────────────────────

  openKodi():      void { this.router.navigate(['/kodi']); }
  openAbs():       void { this.router.navigate(['/audiobookshelf']); }
  openBooklore():  void { this.router.navigate(['/booklore']); }
  openJellyfin():  void { this.router.navigate(['/jellyfin']); }
  openPsn():       void { this.router.navigate(['/playstation']); }
  openSdly():      void { this.router.navigate(['/sideloadly']); }
  openUrb():       void { this.router.navigate(['/urbackup']); }

  // ── Formatters ────────────────────────────────────────────────────────────

  formatUptime(sec: number | null): string {
    if (sec === null) return '—';
    if (sec < 60)   return `${sec}s`;
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return h > 0 ? `${h}h ${m}min` : `${m}min`;
  }

  formatCountdownShort(ms: number | null): string {
    if (ms === null) return '—';
    if (ms < 0) return 'Expiré';
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    if (h >= 24) return `${Math.floor(h / 24)}j`;
    return h > 0 ? `${h}h ${m}min` : `${m}min`;
  }

  formatRelativeTs(unixSec: number): string {
    const diffMs   = Date.now() - unixSec * 1000;
    const diffDays = Math.floor(diffMs / 86_400_000);
    const diffH    = Math.floor(diffMs / 3_600_000);
    const diffMin  = Math.floor(diffMs / 60_000);
    if (diffMin < 1)  return "à l'instant";
    if (diffH < 1)    return `il y a ${diffMin}min`;
    if (diffH < 24)   return `il y a ${diffH}h`;
    if (diffDays < 7) return `il y a ${diffDays}j`;
    return new Date(unixSec * 1000).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  }

  formatTime(ts: number): string {
    const d = new Date(ts);
    const day   = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const time  = d.toTimeString().slice(0, 8);
    return `${day}/${month} ${time}`;
  }
}
