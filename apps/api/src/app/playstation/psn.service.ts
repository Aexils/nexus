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
} from 'psn-api';

import { NexusGateway } from '../gateway/nexus.gateway';
import { PsnStatus, PsnGame } from '@nexus/shared-types';

const PSN_NPSSO     = process.env['PSN_NPSSO']     ?? '';
const PSN_ONLINE_ID = process.env['PSN_ONLINE_ID'] ?? '';


@Injectable()
export class PsnService implements OnModuleInit {
  private readonly logger = new Logger(PsnService.name);

  private accessToken = '';
  private refreshToken = '';
  private tokenExpiresAt = 0;
  private onlineId = PSN_ONLINE_ID;
  private ready = false;
  private warnFetchEmitted = false;

  private currentStatus: PsnStatus = { connected: false };
  // Cached last-good data — preserved across transient fetch failures
  private cachedProfile:      PsnStatus['profile']       = undefined;
  private cachedRecentGames:  PsnStatus['recentGames']   = undefined;
  private cachedTrophySummary: PsnStatus['trophySummary'] = undefined;

  constructor(private readonly gateway: NexusGateway) {}

  async onModuleInit() {
    if (!PSN_NPSSO) {
      this.logger.warn('PSN_NPSSO not set — PlayStation integration disabled');
      this.gateway.addLog('warn', 'psn', 'PSN_NPSSO non défini — intégration PlayStation désactivée');
      return;
    }

    try {
      await this.initTokens();
      this.ready = true;

      this.logger.log(`PSN authenticated as ${this.onlineId}`);
      this.gateway.addLog('ok', 'psn', `PSN connecté — ${this.onlineId}`);
    } catch (err: any) {
      this.logger.error(`PSN auth failed: ${err?.message ?? err}`);
      this.gateway.addLog('error', 'psn', 'PSN auth échouée');
    }
  }

  // ───────────────── AUTH ─────────────────

  private async initTokens(): Promise<void> {
    const code = await exchangeNpssoForCode(PSN_NPSSO);
    const tokens = await exchangeCodeForAccessToken(code);
    this.storeTokens(tokens);
  }

  private storeTokens(tokens: {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  }) {
    this.accessToken = tokens.accessToken;
    this.refreshToken = tokens.refreshToken;
    this.tokenExpiresAt = Date.now() + tokens.expiresIn * 1000;
  }

  private async getAuth(): Promise<{ accessToken: string }> {
    if (Date.now() > this.tokenExpiresAt - 60_000) {
      try {
        const tokens = await exchangeRefreshTokenForAuthTokens(this.refreshToken);
        this.storeTokens(tokens);
      } catch {
        await this.initTokens();
      }
    }

    return { accessToken: this.accessToken };
  }

  // ───────────────── POLLING ─────────────────

  @Interval(60_000)
  async poll(): Promise<void> {
    if (!this.ready) return;

    const status = await this.fetchStatus();
    this.currentStatus = status;
    this.gateway.emitPsnStatus(status);
  }

  // ───────────────── FETCH ─────────────────

  private async fetchStatus(): Promise<PsnStatus> {
    try {
      const auth = await this.getAuth();

      const [profileRes, titlesRes, trophyRes] = await Promise.allSettled([
        getProfileFromUserName(auth, this.onlineId),
        getUserPlayedGames(auth, 'me', { limit: 8, offset: 0 }),
        getUserTrophyProfileSummary(auth, 'me'),
      ]);

      const profileData =
        profileRes.status === 'fulfilled' ? (profileRes.value as any)?.profile : null;

      // getProfileFromUserName returns { profile: { avatarUrls: [{ avatarUrl }] } }
      const avatarUrl = profileData?.avatarUrls?.[0]?.avatarUrl;

      // presence → nécessite onlineId réel
      const presenceRes = await getBasicPresence(auth, this.onlineId);

      const basicPresence = (presenceRes as any)?.basicPresence;
      const availability = basicPresence?.availability ?? 'availabilityOffline';

      const gameList = basicPresence?.gameTitleInfoList ?? [];
      const isIngame = Array.isArray(gameList) && gameList.length > 0;

      const psnPresence =
        availability === 'availabilityOffline'
          ? 'offline'
          : isIngame
            ? 'ingame'
            : 'online';

      let currentGame: PsnGame | undefined;

      if (isIngame) {
        const g = gameList[0];

        currentGame = {
          titleId: g.npTitleId ?? '',
          name: g.titleName ?? 'Unknown',
          imageUrl: g.conceptIconUrl ?? undefined,
          platform: g.launchPlatform ?? undefined,
        };
      }

      const titlesData =
        titlesRes.status === 'fulfilled' ? titlesRes.value : null;

      const rawTitles = (titlesData as any)?.titles ?? [];

      const recentGames: PsnGame[] = rawTitles.slice(0, 6).map((t: any) => ({
        titleId:      t.titleId,
        name:         t.name         ?? 'Unknown',
        imageUrl:     t.imageUrl     ?? undefined,
        platform:     t.category     ?? undefined,
        playCount:    t.playCount    ?? undefined,
        playDuration: t.playDuration ?? undefined,
        lastPlayedAt: t.lastPlayedDateTime ?? undefined,
      }));

      const trophyData =
        trophyRes.status === 'fulfilled'
          ? (trophyRes.value as any)
          : null;

      const trophySummary = trophyData?.trophySummary
        ? {
          level: trophyData.trophySummary.level ?? 0,
          progress: trophyData.trophySummary.progress ?? 0,
          platinum:
            trophyData.trophySummary.earnedTrophies?.platinum ?? 0,
          gold:
            trophyData.trophySummary.earnedTrophies?.gold ?? 0,
          silver:
            trophyData.trophySummary.earnedTrophies?.silver ?? 0,
          bronze:
            trophyData.trophySummary.earnedTrophies?.bronze ?? 0,
        }
        : undefined;

      this.warnFetchEmitted = false;
      this.cachedProfile      = { onlineId: this.onlineId, avatarUrl, presence: psnPresence as any };
      this.cachedRecentGames  = recentGames.length ? recentGames : undefined;
      this.cachedTrophySummary = trophySummary;
      return {
        connected:     true,
        profile:       this.cachedProfile,
        currentGame,
        recentGames:   this.cachedRecentGames,
        trophySummary: this.cachedTrophySummary,
      };
    } catch (err: any) {
      this.logger.warn(`PSN fetch failed: ${err?.message ?? err}`);
      if (!this.warnFetchEmitted) {
        this.warnFetchEmitted = true;
        this.gateway.addLog('warn', 'psn', `Récupération PSN échouée — ${err?.message ?? err}`);
      }
      // Return stale cached data so the UI doesn't blank out on transient failures
      return {
        connected:     false,
        profile:       this.cachedProfile,
        recentGames:   this.cachedRecentGames,
        trophySummary: this.cachedTrophySummary,
      };
    }
  }

  getStatus(): PsnStatus {
    return this.currentStatus;
  }
}
