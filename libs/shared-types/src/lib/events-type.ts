// Noms des events WebSocket — source unique de vérité front + back
export const WS_EVENTS = {
  SYSTEM_METRICS: 'system:metrics',   // métriques globales du mini-PC (node_exporter)
  NODE_METRICS:     'node:metrics',       // métriques par nœud K8s (metrics-server)
  WORKLOAD_METRICS: 'workload:metrics',   // métriques par app/namespace (pods, k9s-like)
  APP_VERSIONS:   'app:versions',     // versions infra/workload
  SIDELOOP_STATUS: 'sideloop:status', // état sideloop (apps re-signées, expiration, devices)
  NEXTCLOUD_STATUS: 'nextcloud:status', // santé Nextcloud (serverinfo : espace, fichiers, actifs)
  LOG_ENTRY:      'log:entry',
} as const;
