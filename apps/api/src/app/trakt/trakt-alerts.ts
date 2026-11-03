import { TraktStatus } from '@nexus/shared-types';

// Sauvegarde nocturne : on tolère un passage manqué (rpi5 éteint) avant d'alerter.
const BACKUP_MAX_AGE_MS = 36 * 3600 * 1000;
// Le fil de fond tourne toutes les 5 min.
const CATALOG_MAX_AGE_MS = 30 * 60 * 1000;

export function traktAlerts(status: Omit<TraktStatus, 'alerts'>, now = Date.now()): string[] {
  const alerts: string[] = [];
  if (!status.last_backup) {
    alerts.push('Aucune sauvegarde depuis le démarrage du suivi');
  } else if (now - Date.parse(status.last_backup) > BACKUP_MAX_AGE_MS) {
    alerts.push('Sauvegarde en retard : plus de 36 h sans copie vers le rpi5');
  }
  if (status.catalog?.error) {
    alerts.push(`Catalogue TMDb en erreur : ${status.catalog.error}`);
  } else if (!status.catalog || now - Date.parse(status.catalog.at) > CATALOG_MAX_AGE_MS) {
    alerts.push('Catalogue TMDb à l\'arrêt : aucun passage depuis 30 min');
  }
  if (status.jellyfin?.error) {
    alerts.push(`Synchro Jellyfin en erreur : ${status.jellyfin.error}`);
  }
  return alerts;
}
