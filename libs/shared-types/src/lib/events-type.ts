// Noms des events WebSocket — source unique de vérité front + back
export const WS_EVENTS = {
  APPS_STATUS_UPDATE:  'apps:status:update',
  KODI_STATUS_UPDATE:  'kodi:status:update',
  ABS_STATUS_UPDATE:   'abs:status:update',
  PSN_STATUS_UPDATE:   'psn:status:update',
  SYSTEM_METRICS:      'system:metrics',
  LOG_ENTRY:                  'log:entry',
  SIDELOADLY_STATUS_UPDATE:   'sideloadly:status:update',
  URBACKUP_STATUS_UPDATE:     'urbackup:status:update',
  APP_VERSIONS:               'app:versions',
  JELLYFIN_STATUS_UPDATE:     'jellyfin:status:update',
  BOOKLORE_STATUS_UPDATE:     'booklore:status:update',
} as const;
