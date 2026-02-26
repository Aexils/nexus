import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Socket } from 'ngx-socket-io';
import { KodiStatus, SystemMetrics, AbsStatus, AbsLibraryItem, PsnStatus, SideloadlyStatus, WS_EVENTS, LogEntry } from '@nexus/shared-types';

const MAX_LOGS = 500;

@Injectable({ providedIn: 'root' })
export class NexusService {
  private readonly http   = inject(HttpClient);
  private readonly socket = inject(Socket);

  readonly kodiStatus = signal<KodiStatus>({ connected: false, nowPlaying: null, lastPlayed: null });
  readonly absStatus  = signal<AbsStatus>({ connected: false, activeSessions: [], lastSession: null });
  readonly psnStatus        = signal<PsnStatus>({ connected: false });
  readonly sideloadlyStatus = signal<SideloadlyStatus>({ connected: false, daemon: { alive: false, startedAt: null, uptimeSec: null, ramMB: null }, accounts: [], devices: [], apps: [] });
  readonly metrics    = signal<SystemMetrics | null>(null);
  readonly logs       = signal<LogEntry[]>([]);

  // Library cached as a root-level signal — loaded once, shared by list + detail pages
  readonly absLibrary        = signal<AbsLibraryItem[]>([]);
  readonly absLibraryLoading = signal(false);
  private  absLibraryLoaded  = false;

  constructor() {
    this.socket.on(WS_EVENTS.KODI_STATUS_UPDATE,  (data: KodiStatus)    => this.kodiStatus.set(data));
    this.socket.on(WS_EVENTS.ABS_STATUS_UPDATE,   (data: AbsStatus)     => this.absStatus.set(data));
    this.socket.on(WS_EVENTS.PSN_STATUS_UPDATE,          (data: PsnStatus)          => this.psnStatus.set(data));
    this.socket.on(WS_EVENTS.SIDELOADLY_STATUS_UPDATE,   (data: SideloadlyStatus)   => this.sideloadlyStatus.set(data));
    this.socket.on(WS_EVENTS.SYSTEM_METRICS,      (data: SystemMetrics) => this.metrics.set(data));

    // Single new log entry streamed in real time
    this.socket.on(WS_EVENTS.LOG_ENTRY, (entry: LogEntry) => {
      this.logs.update(prev => {
        const next = [entry, ...prev];
        return next.length > MAX_LOGS ? next.slice(0, MAX_LOGS) : next;
      });
    });

    // Full history sent when first connecting (or reconnecting)
    this.socket.on('log:history', (entries: LogEntry[]) => {
      this.logs.set([...entries].reverse()); // server sends oldest-first, we show newest-first
    });
  }

  loadAbsLibrary() {
    if (this.absLibraryLoaded || this.absLibraryLoading()) return;
    this.absLibraryLoading.set(true);
    this.http.get<AbsLibraryItem[]>('/api/abs/library').subscribe({
      next:  items => { this.absLibrary.set(items); this.absLibraryLoaded = true; this.absLibraryLoading.set(false); },
      error: ()    => this.absLibraryLoading.set(false),
    });
  }

  // ── Kodi REST ─────────────────────────────────────────────────────────────

  playPause()               { return this.http.post('/api/kodi/playpause', {}).subscribe(); }
  stop()                    { return this.http.post('/api/kodi/stop', {}).subscribe(); }
  seek(positionSec: number) { return this.http.post('/api/kodi/seek', { positionSec }).subscribe(); }
  setVolume(level: number)  { return this.http.post('/api/kodi/volume', { level }).subscribe(); }
}
