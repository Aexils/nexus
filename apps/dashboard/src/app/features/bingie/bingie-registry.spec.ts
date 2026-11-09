import { BINGIE_MODULES, bingieChildRoutes, bingieLegacyRedirects } from './bingie-registry';
import { isBingieWrite } from './bingie-session';

describe('registre Bingie', () => {
  it('une route chargée à la demande par module, et l’accueil ouvre le premier', () => {
    const routes = bingieChildRoutes();
    expect(routes[0]).toEqual({ path: '', pathMatch: 'full', redirectTo: 'ecrans' });
    expect(routes.slice(1).map(r => r.path)).toEqual(['ecrans', 'reglages', 'sources', 'services']);
    expect(routes.slice(1).every(r => typeof r.loadComponent === 'function')).toBe(true);
  });

  it('les anciennes adresses redirigent vers leur module', () => {
    expect(bingieLegacyRedirects().map(r => [r.path, r.redirectTo])).toEqual([
      ['trakt', 'bingie/ecrans'], ['trakt/reglages', 'bingie/reglages'],
      ['aggregator', 'bingie/sources'], ['trakt/service', 'bingie/services'],
    ]);
  });

  it('ajouter un service = une entrée : routes et redirections suivent', () => {
    const extra = [...BINGIE_MODULES, {
      path: 'musique', label: 'Musique', description: 'test', backend: 'kube-trakt' as const, layout: 'page' as const,
      legacy: ['musique-old'], load: async () => class {},
    }];
    expect(bingieChildRoutes(extra).map(r => r.path)).toContain('musique');
    expect(bingieLegacyRedirects(extra).at(-1)).toEqual({ path: 'musique-old', pathMatch: 'full', redirectTo: 'bingie/musique' });
  });

  // Le chargement réel de chaque module est vérifié dans Chromium (tools/ui-check), sur le vrai
  // bundle : sous Jest, les imports JSON de la page Réglages ne se résolvent pas comme à la compilation.
});

describe('écritures Bingie', () => {
  it('seules les écritures Trakt et Aggregator portent le jeton ; l’aperçu reste une lecture', () => {
    expect(isBingieWrite('PUT', '/api/aggregator/preferences')).toBe(true);
    expect(isBingieWrite('DELETE', '/api/trakt/devices/x')).toBe(true);
    expect(isBingieWrite('POST', 'http://nexus.local/api/trakt/lists?x=1')).toBe(true);
    expect(isBingieWrite('POST', '/api/aggregator/preview')).toBe(false);
    expect(isBingieWrite('GET', '/api/trakt/lists')).toBe(false);
    expect(isBingieWrite('POST', '/api/expenses')).toBe(false); // autres modules Nexus : inchangés
  });
});
