// Noms des events WebSocket — source unique de vérité front + back
export const WS_EVENTS = {
  SYSTEM_METRICS: 'system:metrics',   // métriques globales du mini-PC (node_exporter)
  NODE_METRICS:   'node:metrics',     // métriques par nœud K8s (metrics-server)
  APP_VERSIONS:   'app:versions',     // versions infra/workload
  LOG_ENTRY:      'log:entry',
} as const;
