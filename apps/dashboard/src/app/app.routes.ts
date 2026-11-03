import { Route } from '@angular/router';
import { LayoutComponent } from './layout/layout';

export const appRoutes: Route[] = [
  {
    // Plein écran, hors de la mise en page : c'est la télé qu'on édite.
    path: 'trakt',
    pathMatch: 'full',
    loadComponent: () =>
      import('./features/trakt/studio/trakt-studio').then(m => m.TraktStudio),
  },
  {
    path: 'trakt/reglages',
    loadComponent: () =>
      import('./features/trakt/settings/trakt-settings').then(m => m.TraktSettingsPage),
  },
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
        path: 'maison',
        loadComponent: () =>
          import('./features/maison/maison-page').then(m => m.MaisonPage),
      },
      {
        path: 'import',
        loadComponent: () =>
          import('./features/import/import-page').then(m => m.ImportPage),
      },
      {
        path: 'sideloop',
        loadComponent: () =>
          import('./features/sideloop/sideloop-page').then(m => m.SideloopPage),
      },
      {
        path: 'trakt/service',
        loadComponent: () =>
          import('./features/trakt/trakt-page').then(m => m.TraktPage),
      },
      {
        path: 'tyto',
        loadComponent: () =>
          import('./features/tyto/tyto-page').then(m => m.TytoPage),
      },
      {
        path: 'versions',
        loadComponent: () =>
          import('./features/versions/versions-page').then(m => m.VersionsPage),
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
