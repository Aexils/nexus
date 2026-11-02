import { TraktStatus } from '@nexus/shared-types';
import { traktAlerts } from './trakt-alerts';

const NOW = Date.parse('2026-11-02T12:00:00.000Z');

function status(overrides: Partial<TraktStatus> = {}): Omit<TraktStatus, 'alerts'> {
  return {
    reachable: true,
    generated_at: '2026-11-02T12:00:00.000Z',
    counts: null,
    last_watched_at: null,
    last_backup: '2026-11-02T08:30:00.000Z',
    catalog: { at: '2026-11-02T11:58:00.000Z', error: null },
    now_playing: null,
    devices: [],
    missing_routes: [],
    ...overrides,
  };
}

describe('traktAlerts', () => {
  it('ne signale rien quand tout est récent', () => {
    expect(traktAlerts(status(), NOW)).toEqual([]);
  });

  it('tolère une nuit manquée, puis alerte', () => {
    expect(traktAlerts(status({ last_backup: '2026-11-01T08:30:00.000Z' }), NOW)).toEqual([]);
    expect(traktAlerts(status({ last_backup: '2026-10-31T08:30:00.000Z' }), NOW)[0]).toContain('en retard');
  });

  it('alerte si aucune sauvegarde', () => {
    expect(traktAlerts(status({ last_backup: null }), NOW)[0]).toContain('Aucune sauvegarde');
  });

  it('remonte une erreur du catalogue', () => {
    const alerts = traktAlerts(status({ catalog: { at: '2026-11-02T11:58:00.000Z', error: 'HTTP 401' } }), NOW);
    expect(alerts).toEqual(['Catalogue TMDb en erreur : HTTP 401']);
  });

  it('détecte un catalogue arrêté', () => {
    const alerts = traktAlerts(status({ catalog: { at: '2026-11-02T10:00:00.000Z', error: null } }), NOW);
    expect(alerts[0]).toContain('à l\'arrêt');
  });
});
