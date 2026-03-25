import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import {
  exchangeNpssoForCode,
  exchangeCodeForAccessToken,
  exchangeRefreshTokenForAuthTokens,
  getProfileFromUserName,
  getBasicPresence,
  getUserPlayedGames,
  getUserTrophyProfileSummary,
  getUserTitles,
} from 'psn-api';

import { NexusGateway } from '../gateway/nexus.gateway';
import { PsnStatus, PsnGame, PsnTrophyTitle, NexusUser } from '@nexus/shared-types';

const USER_CONFIGS: { userId: NexusUser; npsso: string; onlineId: string }[] = [
  {
    userId:   'alexis',
    npsso:    process.env['PSN_NPSSO_ALEXIS']     ?? process.env['PSN_NPSSO']     ?? '',
    onlineId: process.env['PSN_ONLINE_ID_ALEXIS'] ?? process.env['PSN_ONLINE_ID'] ?? '',
  },
  {
    userId:   'marion',
    npsso:    process.env['PSN_NPSSO_MARION']     ?? '',
    onlineId: process.env['PSN_ONLINE_ID_MARION'] ?? '',
  },
];

interface UserPsnState {
  accessToken:         string;
  refreshToken:        string;
  tokenExpiresAt:      number;
  ready:               boolean;
  warnFetchEmitted:    boolean;
  currentStatus:       PsnStatus;
  cachedProfile:       PsnStatus['profile'];
  cachedRecentGames:   PsnStatus['recentGames'];
  cachedTrophy:        PsnStatus['trophySummary'];
  cachedTrophyTitles:  PsnStatus['trophyTitles'];
}

@Injectable()
export class PsnService implements OnModuleInit {
  private readonly logger = new Logger(PsnService.name);
  private readonly userStates = new Map<NexusUser, UserPsnState>();

  constructor(private readonly gateway: NexusGateway) {
    for (const cfg of USER_CONFIGS) {
      this.userStates.set(cfg.userId, {
        accessToken: '', refreshToken: '', tokenExpiresAt: 0,
        ready: false, warnFetchEmitted: false,
        currentStatus: { connected: false },
        cachedProfile: undefined, cachedRecentGames: undefined,
        cachedTrophy: undefined, cachedTrophyTitles: undefined,
      });
    }
  }

  async onModuleInit() {
    for (const cfg of USER_CONFIGS) {
      if (!cfg.npsso) {
        this.logger.warn(`PSN_NPSSO_${cfg.userId.toUpperCase()} not set — ${cfg.userId} PSN disabled`);
        this.gateway.addLog('warn', 'psn', `PSN non configuré pour ${cfg.userId}`);
        continue;
      }
      try {
        await this.initTokens(cfg.userId, cfg.npsso);
        const state = this.userStates.get(cfg.userId)!;
        state.ready = true;
        this.logger.log(`PSN authenticated: ${cfg.userId} (${cfg.onlineId})`);
        this.gateway.addLog('ok', 'psn', `PSN connecté — ${cfg.userId} (${cfg.onlineId})`);
      } catch (err: any) {
        this.logger.error(`PSN auth failed for ${cfg.userId}: ${err?.message ?? err}`);
        this.gateway.addLog('error', 'psn', `PSN auth échouée — ${cfg.userId}`);
      }
    }
  }

  // ── Auth ─────────────────────────────────────────────────────────────────

  private async initTokens(userId: NexusUser, npsso: string): Promise<void> {
    const state = this.userStates.get(userId)!;
    const code   = await exchangeNpssoForCode(npsso);
    const tokens = await exchangeCodeForAccessToken(code);
    state.accessToken    = tokens.accessToken;
    state.refreshToken   = tokens.refreshToken;
    state.tokenExpiresAt = Date.now() + tokens.expiresIn * 1000;
  }

  private async getAuth(userId: NexusUser): Promise<{ accessToken: string }> {
    const state = this.userStates.get(userId)!;
    const cfg   = USER_CONFIGS.find(c => c.userId === userId)!;
    if (Date.now() > state.tokenExpiresAt - 60_000) {
      try {
        const tokens = await exchangeRefreshTokenForAuthTokens(state.refreshToken);
        state.accessToken    = tokens.accessToken;
        state.refreshToken   = tokens.refreshToken;
        state.tokenExpiresAt = Date.now() + tokens.expiresIn * 1000;
      } catch {
        await this.initTokens(userId, cfg.npsso);
      }
    }
    return { accessToken: state.accessToken };
  }

  // ── Polling ───────────────────────────────────────────────────────────────

  @Interval(60_000)
  async poll(): Promise<void> {
    for (const cfg of USER_CONFIGS) {
      const state = this.userStates.get(cfg.userId)!;
      if (!state.ready) continue;
      const status = await this.fetchStatus(cfg.userId, cfg.onlineId);
      state.currentStatus = status;
      this.gateway.emitPsnStatus(cfg.userId, status);
    }
  }

  // ── Fetch ─────────────────────────────────────────────────────────────────

  private async fetchStatus(userId: NexusUser, onlineId: string): Promise<PsnStatus> {
    const state = this.userStates.get(userId)!;
    try {
      const auth = await this.getAuth(userId);

      const [profileRes, titlesRes, trophyRes, trophyTitlesRes] = await Promise.allSettled([
        getProfileFromUserName(auth, onlineId),
        getUserPlayedGames(auth, 'me', { limit: 50, offset: 0 }),
        getUserTrophyProfileSummary(auth, 'me'),
        getUserTitles(auth, 'me', { limit: 30 }),
      ]);

      const profileData = profileRes.status === 'fulfilled' ? (profileRes.value as any)?.profile : null;
      const avatarUrl   = profileData?.avatarUrls?.[0]?.avatarUrl;

      const presenceRes   = await getBasicPresence(auth, 'me');
      const basicPresence = (presenceRes as any)?.basicPresence;
      const availability  = basicPresence?.availability ?? 'availabilityOffline';
      const gameList      = basicPresence?.gameTitleInfoList ?? [];
      const isIngame      = Array.isArray(gameList) && gameList.length > 0;
      const lastOnline: string | undefined =
        basicPresence?.primaryPlatformInfo?.lastOnlineDate ??
        basicPresence?.lastAvailableDate ?? undefined;

      // Only treat as online when PSN explicitly says so — any other value = offline
      const isOnline    = availability === 'availabilityOnline';
      const psnPresence = !isOnline ? 'offline' : isIngame ? 'ingame' : 'online';

      let currentGame: PsnGame | undefined;
      if (isIngame) {
        const g = gameList[0];
        currentGame = {
          titleId:  g.npTitleId    ?? '',
          name:     g.titleName    ?? 'Unknown',
          imageUrl: g.conceptIconUrl ?? undefined,
          platform: g.launchPlatform ?? undefined,
        };
      }

      const rawTitles = titlesRes.status === 'fulfilled' ? (titlesRes.value as any)?.titles ?? [] : [];
      const recentGames: PsnGame[] = rawTitles.slice(0, 6).map((t: any) => ({
        titleId:      t.titleId,
        name:         t.name              ?? 'Unknown',
        imageUrl:     t.imageUrl          ?? undefined,
        platform:     t.category          ?? undefined,
        playCount:    t.playCount         ?? undefined,
        playDuration: t.playDuration      ?? undefined,
        lastPlayedAt: t.lastPlayedDateTime ?? undefined,
      }));

      const trophyData = trophyRes.status === 'fulfilled' ? (trophyRes.value as any) : null;
      const trophySummary = trophyData?.trophySummary ? {
        level:    trophyData.trophySummary.level    ?? 0,
        progress: trophyData.trophySummary.progress ?? 0,
        platinum: trophyData.trophySummary.earnedTrophies?.platinum ?? 0,
        gold:     trophyData.trophySummary.earnedTrophies?.gold     ?? 0,
        silver:   trophyData.trophySummary.earnedTrophies?.silver   ?? 0,
        bronze:   trophyData.trophySummary.earnedTrophies?.bronze   ?? 0,
      } : undefined;

      const rawTrophyTitles = trophyTitlesRes.status === 'fulfilled'
        ? (trophyTitlesRes.value as any)?.trophyTitles ?? []
        : [];
      const trophyTitles: PsnTrophyTitle[] = rawTrophyTitles
        .filter((t: any) => t.progress > 0)
        .map((t: any) => ({
          npCommunicationId:   t.npCommunicationId,
          trophyTitleName:     t.trophyTitleName     ?? 'Unknown',
          trophyTitleIconUrl:  t.trophyTitleIconUrl  ?? undefined,
          trophyTitlePlatform: t.trophyTitlePlatform ?? '',
          progress:            t.progress            ?? 0,
          earnedTrophies: {
            bronze:   t.earnedTrophies?.bronze   ?? 0,
            silver:   t.earnedTrophies?.silver   ?? 0,
            gold:     t.earnedTrophies?.gold     ?? 0,
            platinum: t.earnedTrophies?.platinum ?? 0,
          },
          definedTrophies: {
            bronze:   t.definedTrophies?.bronze   ?? 0,
            silver:   t.definedTrophies?.silver   ?? 0,
            gold:     t.definedTrophies?.gold     ?? 0,
            platinum: t.definedTrophies?.platinum ?? 0,
          },
          lastUpdatedDateTime: t.lastUpdatedDateTime ?? undefined,
        }));

      state.warnFetchEmitted    = false;
      state.cachedProfile       = { onlineId, avatarUrl, presence: psnPresence as any, lastOnline };
      state.cachedRecentGames   = recentGames.length ? recentGames : undefined;
      state.cachedTrophy        = trophySummary;
      state.cachedTrophyTitles  = trophyTitles.length ? trophyTitles : undefined;

      return {
        connected:      true,
        profile:        state.cachedProfile,
        currentGame,
        recentGames:    state.cachedRecentGames,
        trophySummary:  state.cachedTrophy,
        trophyTitles:   state.cachedTrophyTitles,
      };
    } catch (err: any) {
      this.logger.warn(`PSN fetch failed for ${userId}: ${err?.message ?? err}`);
      if (!state.warnFetchEmitted) {
        state.warnFetchEmitted = true;
        this.gateway.addLog('warn', 'psn', `PSN ${userId} — récupération échouée`);
      }
      return {
        connected:     false,
        profile:       state.cachedProfile,
        recentGames:   state.cachedRecentGames,
        trophySummary: state.cachedTrophy,
        trophyTitles:  state.cachedTrophyTitles,
      };
    }
  }

  getStatus(userId: NexusUser): PsnStatus {
    return this.userStates.get(userId)?.currentStatus ?? { connected: false };
  }
}
