import { Injectable, signal, inject } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';

export type Theme = 'zinc' | 'dark' | 'neon' | 'matrix' | 'amber';

export interface ThemeOption {
  id: Theme;
  label: string;
  accent: string;
  accent2: string;
}

export const THEMES: ThemeOption[] = [
  { id: 'zinc',   label: 'Zinc',      accent: '#f4f4f5', accent2: '#71717a' },
  { id: 'dark',   label: 'Midnight',  accent: '#38d0ff', accent2: '#ff7043' },
  { id: 'neon',   label: 'Synthwave', accent: '#c453fb', accent2: '#ff2d9b' },
  { id: 'matrix', label: 'Terminal',  accent: '#00e040', accent2: '#00ff9d' },
  { id: 'amber',  label: 'Retro CRT', accent: '#ff9800', accent2: '#ff4d00' },
];

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly router = inject(Router);

  /** User's chosen base theme (persisted) */
  readonly activeTheme = signal<Theme>('zinc');

  /** Non-null while on a service detail route — overrides base theme */
  readonly serviceTheme = signal<'kodi' | 'abs' | 'ps5' | null>(null);

  constructor() {
    const saved = (localStorage.getItem('nexus-theme') as Theme | null) ?? 'zinc';
    this.activeTheme.set(saved);
    this.apply(saved);

    // Auto-switch theme when navigating to/from service pages
    this.router.events
      .pipe(filter(e => e instanceof NavigationEnd))
      .subscribe((e: any) => {
        const url: string = e.urlAfterRedirects;
        if (url.startsWith('/kodi')) {
          this.serviceTheme.set('kodi');
          this.apply('kodi');
        } else if (url.startsWith('/audiobookshelf')) {
          this.serviceTheme.set('abs');
          this.apply('abs');
        } else if (url.startsWith('/playstation')) {
          this.serviceTheme.set('ps5');
          this.apply('ps5');
        } else {
          this.serviceTheme.set(null);
          this.apply(this.activeTheme());
        }
      });
  }

  setTheme(theme: Theme): void {
    localStorage.setItem('nexus-theme', theme);
    this.activeTheme.set(theme);
    // Only take effect visually if we're not on a service page
    if (!this.serviceTheme()) {
      this.apply(theme);
    }
  }

  getThemes(): ThemeOption[] { return THEMES; }

  private apply(theme: string): void {
    document.documentElement.setAttribute('data-theme', theme);
  }
}
