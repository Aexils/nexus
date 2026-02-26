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
        path: 'playstation',
        loadComponent: () =>
          import('./features/playstation/ps5-page').then(m => m.Ps5Page),
      },
      {
        path: 'sideloadly',
        loadComponent: () =>
          import('./features/sideloadly/sideloadly-page').then(m => m.SideloadlyPage),
      },
    ],
  },
];
