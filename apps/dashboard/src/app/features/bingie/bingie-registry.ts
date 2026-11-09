import { Route } from '@angular/router';
import { Type } from '@angular/core';

/** Un service multimédia de Bingie. Ajouter un service = une entrée ici, rien d'autre à restructurer. */
export interface BingieModule {
  /** Segment d'URL : /bingie/<path>. */
  path: string;
  label: string;
  /** Libellé court, sur téléphone (les onglets doivent tous tenir à l'écran). */
  short?: string;
  description: string;
  /** Backend joint par l'API Nexus (un module NestJS par backend, aucun couplage entre eux). */
  backend: 'kube-trakt' | 'kube-aggregator';
  /** « screen » : occupe tout l'espace sous la barre Bingie (écran de télé) ; « page » : défile. */
  layout: 'screen' | 'page';
  /** Chargement différé : le code d'un module n'est téléchargé qu'à sa première ouverture. */
  load: () => Promise<Type<unknown>>;
  /** Anciennes adresses, redirigées ici (marque-pages et liens existants). */
  legacy: string[];
}

export const BINGIE_MODULES: BingieModule[] = [
  {
    path: 'ecrans', label: 'Écrans', description: 'Écrans de la télé, rangées et listes',
    backend: 'kube-trakt', layout: 'screen', legacy: ['trakt'],
    load: () => import('./modules/trakt/studio/trakt-studio').then(m => m.TraktStudio),
  },
  {
    path: 'reglages', label: 'Réglages', description: 'Réglages de Kodi et du skin',
    backend: 'kube-trakt', layout: 'screen', legacy: ['trakt/reglages'],
    load: () => import('./modules/trakt/settings/trakt-settings').then(m => m.TraktSettingsPage),
  },
  {
    path: 'sources', label: 'Sources et qualité', short: 'Sources', description: 'Profils de qualité et priorités partagés avec Kodi',
    backend: 'kube-aggregator', layout: 'page', legacy: ['aggregator'],
    load: () => import('./modules/aggregator/aggregator-page').then(m => m.AggregatorPage),
  },
  {
    path: 'services', label: 'Services', description: 'État du suivi, appareils et réglages par série',
    backend: 'kube-trakt', layout: 'page', legacy: ['trakt/service'],
    load: () => import('./modules/trakt/trakt-page').then(m => m.TraktPage),
  },
];

/** Routes enfants du cadre Bingie, générées depuis le registre. */
export function bingieChildRoutes(modules = BINGIE_MODULES): Route[] {
  return [
    { path: '', pathMatch: 'full', redirectTo: modules[0].path },
    ...modules.map(m => ({ path: m.path, loadComponent: m.load, data: { bingie: m.path, layout: m.layout }, title: `Bingie · ${m.label}` })),
  ];
}

/** Redirections permanentes des anciennes adresses (avant la mise en page Nexus). */
export function bingieLegacyRedirects(modules = BINGIE_MODULES): Route[] {
  return modules.flatMap(m => m.legacy.map(old => ({ path: old, pathMatch: 'full' as const, redirectTo: `bingie/${m.path}` })));
}
