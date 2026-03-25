import { Injectable, signal, computed, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Socket } from 'ngx-socket-io';
import {
  KodiStatus, SystemMetrics, AbsStatus, AbsLibraryItem, AbsStatusMap,
  PsnStatus, PsnStatusMap, SideloadlyStatus, UrbackupStatus, JellyfinStatus, JellyfinLibraryItem,
  BookloreStatus, BookloreStatusMap, BookloreBook,
  WS_EVENTS, LogEntry, NexusUser, AppLatestVersions,
} from '@nexus/shared-types';
import { UserService } from './user.service';

const MAX_LOGS = 500;

const DEFAULT_ABS:      AbsStatus      = { connected: false, activeSessions: [], lastSession: null };
const DEFAULT_PSN:      PsnStatus      = { connected: false };
const DEFAULT_BOOKLORE: BookloreStatus = { connected: false, currentlyReading: [] };

@Injectable({ providedIn: 'root' })
export class NexusService {
  private readonly http    = inject(HttpClient);
  private readonly socket  = inject(Socket);
  private readonly userSvc = inject(UserService);

  // ── Shared signals ────────────────────────────────────────────────────────

  readonly kodiStatus = signal<KodiStatus>({ connected: false, nowPlaying: null, lastPlayed: null });

  readonly absStatusMap      = signal<AbsStatusMap>({ alexis: DEFAULT_ABS, marion: DEFAULT_ABS });
  readonly psnStatusMap      = signal<PsnStatusMap>({ alexis: DEFAULT_PSN, marion: DEFAULT_PSN });
  readonly bookloreStatusMap = signal<BookloreStatusMap>({ alexis: DEFAULT_BOOKLORE, marion: DEFAULT_BOOKLORE });

  readonly sideloadlyStatus = signal<SideloadlyStatus>({
    connected: false,
    daemon: { alive: false, startedAt: null, uptimeSec: null, ramMB: null },
    accounts: [], devices: [], apps: [],
  });
  readonly urbackupStatus = signal<UrbackupStatus>({
    connected: false, serverVersion: '', clients: [], recentActivities: [], activeProgress: [],
  });
  readonly jellyfinStatus     = signal<JellyfinStatus>({ connected: false, activeSessions: [] });
  readonly metrics            = signal<SystemMetrics | null>(null);
  readonly logs               = signal<LogEntry[]>([]);
  readonly appLatestVersions  = signal<AppLatestVersions>({});

  // ── Per-user computed ─────────────────────────────────────────────────────

  /** ABS status for the currently selected user */
  readonly absStatus = computed<AbsStatus>(() =>
    this.absStatusMap()[this.userSvc.currentUser()],
  );

  /** PSN status for the currently selected user */
  readonly psnStatus = computed<PsnStatus>(() =>
    this.psnStatusMap()[this.userSvc.currentUser()],
  );

  /** Booklore status for the currently selected user */
  readonly bookloreStatus = computed<BookloreStatus>(() =>
    this.bookloreStatusMap()[this.userSvc.currentUser()],
  );

  // ── Library (per-user, lazy-loaded) ──────────────────────────────────────

  readonly absLibrary        = signal<AbsLibraryItem[]>([]);
  readonly absLibraryLoading = signal(false);
  private  absLibraryUser: NexusUser | null = null;

  readonly jellyfinLibrary        = signal<JellyfinLibraryItem[]>([]);
  readonly jellyfinLibraryLoading = signal(false);
  private  jellyfinLibraryLoaded  = false;

  readonly bookloreLibrary        = signal<BookloreBook[]>([]);
  readonly bookloreLibraryLoading = signal(false);
  private  bookloreLibraryUser: NexusUser | null = null;

  // ── Constructor ───────────────────────────────────────────────────────────

  constructor() {
    this.socket.on(WS_EVENTS.KODI_STATUS_UPDATE, (data: KodiStatus) => this.kodiStatus.set(data));

    // ABS — payload includes userId
    this.socket.on(WS_EVENTS.ABS_STATUS_UPDATE, (data: { userId: NexusUser } & AbsStatus) => {
      const { userId, ...status } = data;
      this.absStatusMap.update(map => ({ ...map, [userId]: status }));
    });

    // PSN — payload includes userId
    this.socket.on(WS_EVENTS.PSN_STATUS_UPDATE, (data: { userId: NexusUser } & PsnStatus) => {
      const { userId, ...status } = data;
      this.psnStatusMap.update(map => ({ ...map, [userId]: status }));
    });

    this.socket.on(WS_EVENTS.SIDELOADLY_STATUS_UPDATE,  (data: SideloadlyStatus)   => this.sideloadlyStatus.set(data));
    this.socket.on(WS_EVENTS.URBACKUP_STATUS_UPDATE,    (data: UrbackupStatus)     => this.urbackupStatus.set(data));
    this.socket.on(WS_EVENTS.JELLYFIN_STATUS_UPDATE,    (data: JellyfinStatus)     => this.jellyfinStatus.set(data));

    // Booklore — payload includes userId
    this.socket.on(WS_EVENTS.BOOKLORE_STATUS_UPDATE, (data: { userId: NexusUser } & BookloreStatus) => {
      const { userId, ...status } = data;
      this.bookloreStatusMap.update(map => ({ ...map, [userId]: status }));
    });
    this.socket.on(WS_EVENTS.SYSTEM_METRICS,            (data: SystemMetrics)      => this.metrics.set(data));
    this.socket.on(WS_EVENTS.APP_VERSIONS,              (data: AppLatestVersions)  => this.appLatestVersions.set(data));

    this.socket.on(WS_EVENTS.LOG_ENTRY, (entry: LogEntry) => {
      this.logs.update(prev => {
        const next = [entry, ...prev];
        return next.length > MAX_LOGS ? next.slice(0, MAX_LOGS) : next;
      });
    });

    this.socket.on('log:history', (entries: LogEntry[]) => {
      this.logs.set([...entries].reverse());
    });
  }

  // ── Library ───────────────────────────────────────────────────────────────

  loadAbsLibrary(user?: NexusUser) {
    const userId = user ?? this.userSvc.currentUser();
    if (this.absLibraryLoading() || this.absLibraryUser === userId) return;
    this.absLibraryUser = userId;
    this.absLibraryLoading.set(true);
    this.absLibrary.set([]);
    this.http.get<AbsLibraryItem[]>(`/api/abs/library?userId=${userId}`).subscribe({
      next:  items => { this.absLibrary.set(items); this.absLibraryLoading.set(false); },
      error: ()    => this.absLibraryLoading.set(false),
    });
  }

  loadBookloreLibrary(user?: NexusUser) {
    const userId = user ?? this.userSvc.currentUser();
    if (this.bookloreLibraryLoading() || this.bookloreLibraryUser === userId) return;
    this.bookloreLibraryUser = userId;
    this.bookloreLibraryLoading.set(true);
    this.bookloreLibrary.set([]);
    this.http.get<BookloreBook[]>(`/api/booklore/library?userId=${userId}`).subscribe({
      next:  items => { this.bookloreLibrary.set(items); this.bookloreLibraryLoading.set(false); },
      error: ()    => this.bookloreLibraryLoading.set(false),
    });
  }

  loadJellyfinLibrary() {
    if (this.jellyfinLibraryLoading() || this.jellyfinLibraryLoaded) return;
    this.jellyfinLibraryLoaded = true;
    this.jellyfinLibraryLoading.set(true);
    this.http.get<JellyfinLibraryItem[]>('/api/jellyfin/library').subscribe({
      next:  items => { this.jellyfinLibrary.set(items); this.jellyfinLibraryLoading.set(false); },
      error: ()    => { this.jellyfinLibraryLoaded = false; this.jellyfinLibraryLoading.set(false); },
    });
  }

  // ── Kodi REST ─────────────────────────────────────────────────────────────

  playPause()               { return this.http.post('/api/kodi/playpause', {}).subscribe(); }
  stop()                    { return this.http.post('/api/kodi/stop', {}).subscribe(); }
  seek(positionSec: number) { return this.http.post('/api/kodi/seek', { positionSec }).subscribe(); }
  setVolume(level: number)  { return this.http.post('/api/kodi/volume', { level }).subscribe(); }
}
