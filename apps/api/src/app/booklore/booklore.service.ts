import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { NexusGateway } from '../gateway/nexus.gateway';
import {
  BookloreStatus, BookloreCurrentBook, BookloreBook, NexusUser,
} from '@nexus/shared-types';

const BOOKLORE_URL = process.env['BOOKLORE_URL'] ?? 'http://localhost:6060';

// Per-user credentials
const USER_CONFIGS: { userId: NexusUser; username: string; password: string }[] = [
  {
    userId:   'alexis',
    username: process.env['BOOKLORE_USERNAME_ALEXIS'] ?? '',
    password: process.env['BOOKLORE_PASSWORD_ALEXIS'] ?? '',
  },
  {
    userId:   'marion',
    username: process.env['BOOKLORE_USERNAME_MARION'] ?? '',
    password: process.env['BOOKLORE_PASSWORD_MARION'] ?? '',
  },
];

// Refresh token before it expires (JWT default is 24h in Booklore)
const TOKEN_REFRESH_MS = 60 * 60 * 1000; // refresh 1h before expiry

interface UserBookloreState {
  token:          string | null;
  tokenExpiresAt: number;   // unix ms
  prevConnected:  boolean;
  warnEmitted:    boolean;
}

@Injectable()
export class BookloreService implements OnModuleInit {
  private readonly logger = new Logger(BookloreService.name);

  private readonly userStates = new Map<NexusUser, UserBookloreState>();
  private bookloreVersion: string | undefined;

  constructor(private readonly gateway: NexusGateway) {
    this.logger.log(`Booklore endpoint: ${BOOKLORE_URL}`);
    for (const cfg of USER_CONFIGS) {
      this.userStates.set(cfg.userId, {
        token: null, tokenExpiresAt: 0,
        prevConnected: false, warnEmitted: false,
      });
      if (!cfg.username || !cfg.password) {
        this.logger.warn(`BOOKLORE_USERNAME/PASSWORD_${cfg.userId.toUpperCase()} not set — ${cfg.userId} disabled`);
      }
    }
  }

  onModuleInit() {
    setTimeout(() => this.poll(), 3000);
  }

  // ── Poll every 30 s ────────────────────────────────────────────────────────

  @Interval(30_000)
  async poll(): Promise<void> {
    for (const cfg of USER_CONFIGS) {
      if (!cfg.username || !cfg.password) continue;
      const state  = this.userStates.get(cfg.userId)!;
      const status = await this.fetchStatus(cfg, state);

      if (!state.prevConnected && status.connected) {
        this.gateway.addLog('ok', 'booklore', `Booklore connecté (${cfg.userId})`);
        state.warnEmitted = false;
      } else if (state.prevConnected && !status.connected && !state.warnEmitted) {
        this.gateway.addLog('warn', 'booklore', `Booklore déconnecté (${cfg.userId})`);
        state.warnEmitted = true;
      }
      state.prevConnected = status.connected;

      this.gateway.emitBookloreStatus(cfg.userId, status);
    }
  }

  // ── Auth ──────────────────────────────────────────────────────────────────

  private async ensureToken(
    cfg:   { username: string; password: string },
    state: UserBookloreState,
  ): Promise<string | null> {
    const now = Date.now();
    if (state.token && state.tokenExpiresAt - now > TOKEN_REFRESH_MS) {
      return state.token;
    }

    try {
      const res = await fetch(`${BOOKLORE_URL}/api/v1/auth/login`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ username: cfg.username, password: cfg.password }),
        signal:  AbortSignal.timeout(5_000),
      });
      if (!res.ok) {
        this.logger.warn(`Booklore auth failed: HTTP ${res.status}`);
        return null;
      }

      // Response: { accessToken: "...", refreshToken: "...", isDefaultPassword: "..." }
      const data = await res.json() as { accessToken?: string };
      if (!data.accessToken) return null;

      state.token          = data.accessToken;
      state.tokenExpiresAt = now + 23 * 60 * 60 * 1000; // assume 23h (Booklore default is 24h)
      return state.token;
    } catch (err) {
      this.logger.warn(`Booklore auth error: ${err}`);
      state.token          = null;
      state.tokenExpiresAt = 0;
      return null;
    }
  }

  // ── Get version (once after first successful auth) ─────────────────────────

  private async fetchVersion(token: string): Promise<void> {
    if (this.bookloreVersion) return;
    try {
      const res = await fetch(`${BOOKLORE_URL}/api/v1/version`, {
        headers: { Authorization: `Bearer ${token}` },
        signal:  AbortSignal.timeout(4_000),
      });
      if (!res.ok) return;
      const data = await res.json() as { current?: string };
      if (data.current) this.bookloreVersion = data.current;
    } catch { /* ignore */ }
  }

  // ── Fetch status for one user ─────────────────────────────────────────────

  private async fetchStatus(
    cfg:   { userId: NexusUser; username: string; password: string },
    state: UserBookloreState,
  ): Promise<BookloreStatus> {
    // 1 — Health check
    try {
      const hRes = await fetch(`${BOOKLORE_URL}/api/v1/healthcheck`, {
        signal: AbortSignal.timeout(4_000),
      });
      if (!hRes.ok) return { connected: false, currentlyReading: [] };
    } catch {
      return { connected: false, currentlyReading: [] };
    }

    // 2 — Authenticate
    const token = await this.ensureToken(cfg, state);
    if (!token) {
      return { connected: true, version: this.bookloreVersion, currentlyReading: [] };
    }

    // 3 — Fetch version (once)
    await this.fetchVersion(token);

    // 4 — Fetch books (plain array, not paginated)
    try {
      const bRes = await fetch(`${BOOKLORE_URL}/api/v1/books`, {
        headers: { Authorization: `Bearer ${token}` },
        signal:  AbortSignal.timeout(10_000),
      });
      if (!bRes.ok) {
        if (bRes.status === 401) state.token = null;
        return { connected: true, version: this.bookloreVersion, currentlyReading: [] };
      }

      const rawBooks: any[] = await bRes.json();
      if (!Array.isArray(rawBooks)) {
        return { connected: true, version: this.bookloreVersion, currentlyReading: [] };
      }

      const currentlyReading: BookloreCurrentBook[] = rawBooks
        .map((b: any): BookloreCurrentBook | null => {
          const pct = this.extractProgress(b);
          if (pct === undefined || pct <= 0 || pct >= 100) return null;
          if (b.readStatus === 'READ') return null;
          return {
            id:         b.id,
            title:      b.title ?? b.metadata?.title ?? '?',
            authors:    this.extractAuthors(b),
            progress:   pct,
            seriesName: b.metadata?.seriesName ?? undefined,
          };
        })
        .filter((b): b is BookloreCurrentBook => b !== null)
        .sort((a, b) => b.progress - a.progress)
        .slice(0, 5);

      return {
        connected:       true,
        version:         this.bookloreVersion,
        totalBooks:      rawBooks.length,
        currentlyReading,
      };
    } catch (err) {
      this.logger.warn(`Booklore books fetch error: ${err}`);
      return { connected: true, version: this.bookloreVersion, currentlyReading: [] };
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private extractProgress(b: any): number | undefined {
    // Percentage is a Java Float — could be 0.0–1.0 or 0–100 depending on reader
    const pct = b.epubProgress?.percentage ?? b.pdfProgress?.percentage
              ?? b.cbxProgress?.percentage ?? b.audiobookProgress?.percentage;
    if (pct === undefined || pct === null) return undefined;
    const normalized = pct > 1 ? Math.round(pct) : Math.round(pct * 100);
    return normalized;
  }

  private extractAuthors(b: any): string[] {
    const authors = b.metadata?.authors;
    if (Array.isArray(authors)) return authors.map(String);
    if (authors instanceof Set) return [...authors].map(String);
    return [];
  }

  // ── REST: library (full book list for a user) ─────────────────────────────

  async getLibrary(userId: NexusUser): Promise<BookloreBook[]> {
    const cfg   = USER_CONFIGS.find(c => c.userId === userId);
    const state = this.userStates.get(userId);
    if (!cfg || !state || !cfg.username || !cfg.password) return [];

    const token = await this.ensureToken(cfg, state);
    if (!token) return [];

    try {
      const res = await fetch(`${BOOKLORE_URL}/api/v1/books?withDescription=true`, {
        headers: { Authorization: `Bearer ${token}` },
        signal:  AbortSignal.timeout(15_000),
      });
      if (!res.ok) return [];

      const raw: any[] = await res.json();
      if (!Array.isArray(raw)) return [];

      return raw.map((b: any): BookloreBook => {
        const m = b.metadata ?? {};
        return {
          id:            b.id,
          title:         b.title ?? m.title ?? 'Unknown',
          authors:       this.extractAuthors(b),
          categories:    Array.isArray(m.categories)
                           ? m.categories.map(String)
                           : m.categories ? [...m.categories].map(String) : [],
          description:   m.description
                           ? String(m.description).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
                           : undefined,
          publisher:     m.publisher   || undefined,
          publishedYear: m.publishedDate ? String(m.publishedDate).slice(0, 4) : undefined,
          language:      m.language    || undefined,
          seriesName:    m.seriesName  || undefined,
          seriesIndex:   m.seriesNumber != null ? String(m.seriesNumber) : undefined,
          libraryName:   b.libraryName || undefined,
          progress:      this.extractProgress(b),
          isRead:        b.readStatus === 'READ',
          pageCount:     m.pageCount   ?? undefined,
        };
      });
    } catch (err) {
      this.logger.warn(`Booklore library fetch error: ${err}`);
      return [];
    }
  }

  // ── REST: cover proxy (requires auth) ─────────────────────────────────────

  async getCover(bookId: number): Promise<{ buffer: Buffer; contentType: string } | null> {
    // Use first available token
    let token: string | null = null;
    for (const cfg of USER_CONFIGS) {
      if (!cfg.username || !cfg.password) continue;
      const state = this.userStates.get(cfg.userId)!;
      token = await this.ensureToken(cfg, state);
      if (token) break;
    }

    try {
      const res = await fetch(`${BOOKLORE_URL}/api/v1/media/book/${bookId}/cover`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal:  AbortSignal.timeout(6_000),
      });
      if (!res.ok) return null;
      const contentType = res.headers.get('content-type') ?? 'image/jpeg';
      const buffer      = Buffer.from(await res.arrayBuffer());
      return { buffer, contentType };
    } catch {
      return null;
    }
  }
}
