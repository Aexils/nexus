import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { NexusGateway } from '../gateway/nexus.gateway';
import { AppLatestVersions } from '@nexus/shared-types';

const GITHUB_REPOS = {
  kodi:      'xbmc/xbmc',
  abs:       'advplyr/audiobookshelf',
  jellyfin:  'jellyfin/jellyfin',
  booklore:  'booklore-app/booklore',
} as const;

@Injectable()
export class VersionService implements OnModuleInit {
  private readonly logger = new Logger(VersionService.name);
  private cached: AppLatestVersions = {};

  constructor(private readonly gateway: NexusGateway) {}

  async onModuleInit(): Promise<void> {
    // Short delay so other services initialize first
    setTimeout(() => this.checkVersions(), 5000);
  }

  @Interval(6 * 60 * 60 * 1000) // every 6 hours
  async checkVersions(): Promise<void> {
    const ghKeys = Object.keys(GITHUB_REPOS) as (keyof typeof GITHUB_REPOS)[];

    const [ghResults, urbackupResult, sdlyResult, dockerResult] = await Promise.all([
      Promise.allSettled(ghKeys.map(async key => ({
        key,
        version: await this.fetchGitHubLatest(GITHUB_REPOS[key]),
      }))),
      this.fetchUrBackupLatest().catch(() => undefined),
      this.fetchSideloadlyLatest().catch(() => undefined),
      this.fetchDockerDesktopLatest().catch(() => undefined),
    ]);

    const next: AppLatestVersions = {};
    for (const r of ghResults) {
      if (r.status === 'fulfilled') next[r.value.key] = r.value.version;
      else this.logger.warn(`Version check failed: ${(r as PromiseRejectedResult).reason?.message ?? r}`);
    }
    if (urbackupResult) next.urbackup    = urbackupResult;
    if (sdlyResult)     next.sideloadly  = sdlyResult;
    if (dockerResult)   next.dockerDesktop = dockerResult;

    this.cached = { ...this.cached, ...next };
    this.gateway.emitVersions(this.cached);
    this.logger.log(
      `Versions latest — Kodi: ${this.cached.kodi ?? '?'}, ABS: ${this.cached.abs ?? '?'}, ` +
      `UrBackup: ${this.cached.urbackup ?? '?'}, Jellyfin: ${this.cached.jellyfin ?? '?'}, ` +
      `Sideloadly: ${this.cached.sideloadly ?? '?'}, Docker Desktop: ${this.cached.dockerDesktop ?? '?'}, Booklore: ${this.cached.booklore ?? '?'}`,
    );
  }

  private async fetchGitHubLatest(repo: string): Promise<string> {
    const headers = {
      'User-Agent': 'nexus-dashboard/1.0',
      'Accept':     'application/vnd.github.v3+json',
    };
    const normalize = (tag: string) => tag.replace(/^v/, '').split('-')[0];

    const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers,
      signal: AbortSignal.timeout(10_000),
    });

    if (res.ok) {
      const data = await res.json() as { tag_name: string };
      return normalize(data.tag_name);
    }

    // 404 = no stable release — fall back to latest tag
    if (res.status === 404) {
      this.logger.debug(`No stable release for ${repo}, falling back to tags`);
      const tagsRes = await fetch(`https://api.github.com/repos/${repo}/tags?per_page=1`, {
        headers,
        signal: AbortSignal.timeout(10_000),
      });
      if (!tagsRes.ok) throw new Error(`GitHub tags API ${tagsRes.status} for ${repo}`);
      const tags = await tagsRes.json() as { name: string }[];
      if (!tags.length) throw new Error(`No tags found for ${repo}`);
      return normalize(tags[0].name);
    }

    throw new Error(`GitHub API ${res.status} for ${repo}`);
  }

  // Scrapes the official UrBackup changelog — first <h2> is always the latest version
  // e.g. "2.5.35 (2026-01-11)" → "2.5.35"
  private async fetchUrBackupLatest(): Promise<string> {
    const res = await fetch('https://www.urbackup.org/server_changelog.html', {
      headers: { 'User-Agent': 'nexus-dashboard/1.0' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`urbackup.org changelog ${res.status}`);
    const html = await res.text();
    const m = html.match(/<h2[^>]*>(\d+\.\d+(?:\.\d+)?)/i);
    if (!m) throw new Error('UrBackup version not found in changelog');
    return m[1];
  }

  // Scrapes Docker Desktop's Windows Appcast feed — first shortVersionString is the latest stable
  // e.g. sparkle:shortVersionString="4.38.0" → "4.38.0"
  private async fetchDockerDesktopLatest(): Promise<string> {
    const res = await fetch('https://desktop.docker.com/win/main/amd64/appcast.xml', {
      headers: { 'User-Agent': 'nexus-dashboard/1.0' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Docker appcast ${res.status}`);
    const xml = await res.text();
    const m = xml.match(/sparkle:shortVersionString="([\d.]+)"/);
    if (!m) throw new Error('Docker Desktop version not found in appcast');
    return m[1];
  }

  private async fetchSideloadlyLatest(): Promise<string> {
    const res = await fetch('https://sideloadly.io/', {
      headers: { 'User-Agent': 'nexus-dashboard/1.0' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`sideloadly.io ${res.status}`);
    const html = await res.text();
    // Changelog lists newest version first — match first occurrence of "0.XX.X" or "0.XX"
    const m = html.match(/\b(0\.\d{2,}(?:\.\d+)?)\b/);
    if (!m) throw new Error('Version not found on sideloadly.io');
    return m[1];
  }
}
