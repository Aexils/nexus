import { Route } from '@angular/router';
import { LayoutComponent } from './layout/layout';

export const appRoutes: Route[] = [
  {
    path: '',
    component: LayoutComponent,
    children: [
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./features/dashboard/dashboard').then(m => m.Dashboard),
      },
      {
        path: 'kodi',
        loadComponent: () =>
          import('./features/kodi/kodi-page').then(m => m.KodiPage),
      },
      {
        path: 'audiobookshelf',
        loadComponent: () =>
          import('./features/audiobookshelf/abs-page').then(m => m.AbsPage),
      },
      {
        path: 'audiobookshelf/:id',
        loadComponent: () =>
          import('./features/audiobookshelf/abs-book-detail').then(m => m.AbsBookDetail),
      },
      {
        path: 'booklore',
        loadComponent: () =>
          import('./features/booklore/booklore-page').then(m => m.BooklorePage),
      },
      {
        path: 'booklore/:id',
        loadComponent: () =>
          import('./features/booklore/booklore-book-detail').then(m => m.BookloreBookDetail),
      },
      {
        path: 'playstation',
        loadComponent: () =>
          import('./features/playstation/ps5-page').then(m => m.Ps5Page),
      },
      {
        path: 'sideloadly',
        loadComponent: () =>
          import('./features/sideloadly/sideloadly-page').then(m => m.SideloadlyPage),
      },
      {
        path: 'urbackup',
        loadComponent: () =>
          import('./features/urbackup/urbackup-page').then(m => m.UrbackupPage),
      },
      {
        path: 'jellyfin',
        loadComponent: () =>
          import('./features/jellyfin/jellyfin-page').then(m => m.JellyfinPage),
      },
      {
        path: 'maison',
        loadComponent: () =>
          import('./features/maison/maison-page').then(m => m.MaisonPage),
      },
      {
        path: 'alexis',
        loadComponent: () => import('./features/me/me-page').then(m => m.MePage),
        data: { user: 'alexis' },
      },
      {
        path: 'marion',
        loadComponent: () => import('./features/me/me-page').then(m => m.MePage),
        data: { user: 'marion' },
      },
      {
        path: 'alexis/budget',
        loadComponent: () => import('./features/budget/budget-page').then(m => m.BudgetPage),
        data: { user: 'alexis' },
      },
      {
        path: 'marion/budget',
        loadComponent: () => import('./features/budget/budget-page').then(m => m.BudgetPage),
        data: { user: 'marion' },
      },
      {
        path: 'admin',
        loadComponent: () =>
          import('./features/admin/admin-page').then(m => m.AdminPage),
      },
    ],
  },
];
