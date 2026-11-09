import { Route } from '@angular/router';
import { bingieChildRoutes } from './bingie-registry';

export const BINGIE_ROUTES: Route[] = [
  {
    path: '',
    loadComponent: () => import('./shell/bingie-shell').then(m => m.BingieShell),
    children: bingieChildRoutes(),
  },
];
