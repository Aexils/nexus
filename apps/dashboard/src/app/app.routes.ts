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
