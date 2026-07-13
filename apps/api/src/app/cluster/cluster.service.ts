import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { KubeConfig, CoreV1Api, Metrics } from '@kubernetes/client-node';
import { NexusGateway } from '../gateway/nexus.gateway';
import { NodeMetrics, WorkloadMetric, PodMetric } from '@nexus/shared-types';

// Namespaces d'infra (le reste = workload). Nexus est exclu de rien ici : on le montre.
const INFRA_NS = new Set([
  'kube-system', 'kube-node-lease', 'kube-public', 'argocd', 'calico-system',
  'calico-apiserver', 'tigera-operator', 'metallb-system', 'envoy-gateway-system',
  'sealed-secrets', 'local-path-storage',
]);

// Quantités Kubernetes → nombres. CPU : "123m" ou "1" ; mémoire : "123456Ki"/"1Gi"...
function cpuToMillicores(q: string): number {
  if (q.endsWith('n')) return parseInt(q, 10) / 1e6;   // nanocores
  if (q.endsWith('u')) return parseInt(q, 10) / 1e3;   // microcores
  if (q.endsWith('m')) return parseInt(q, 10);          // millicores
  return parseFloat(q) * 1000;                          // cores
}
function memToBytes(q: string): number {
  const units: Record<string, number> = {
    Ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3, Ti: 1024 ** 4,
    K: 1e3, M: 1e6, G: 1e9, T: 1e12,
  };
  const m = q.match(/^(\d+(?:\.\d+)?)([A-Za-z]+)?$/);
  if (!m) return 0;
  const [, num, unit] = m;
  return parseFloat(num) * (unit ? units[unit] ?? 1 : 1);
}

@Injectable()
export class ClusterService implements OnModuleInit {
  private readonly logger = new Logger(ClusterService.name);
  private kc!: KubeConfig;
  private core!: CoreV1Api;
  private metrics!: Metrics;
  private available = false;

  constructor(private readonly gateway: NexusGateway) {}

  onModuleInit() {
    try {
      this.kc = new KubeConfig();
      this.kc.loadFromCluster();          // token + CA du ServiceAccount montés dans le pod
      this.core = this.kc.makeApiClient(CoreV1Api);
      this.metrics = new Metrics(this.kc);
      this.available = true;
      this.logger.log('Kubernetes in-cluster config chargée');
      this.gateway.addLog('debug', 'system', 'Accès API Kubernetes prêt (in-cluster)');
    } catch (e) {
      this.logger.warn(`Pas de config in-cluster (dev ?) : ${(e as Error).message}`);
      this.gateway.addLog('warn', 'system', 'API Kubernetes indisponible (hors cluster)');
    }
  }

  @Interval(10_000)
  async collectNodes() {
    if (!this.available) return;
    try {
      const [nodesRes, metricsRes] = await Promise.all([
        this.core.listNode(),
        this.metrics.getNodeMetrics(),
      ]);

      const usage = new Map<string, { cpu: string; memory: string }>();
      for (const item of metricsRes.items ?? []) {
        usage.set(item.metadata.name, item.usage);
      }

      const result: NodeMetrics[] = [];
      for (const node of nodesRes.items) {
        const name = node.metadata?.name ?? '';
        const alloc = node.status?.allocatable ?? {};
        const u = usage.get(name);
        const cpuAlloc = cpuToMillicores(String(alloc['cpu'] ?? '0'));
        const memAlloc = memToBytes(String(alloc['memory'] ?? '0'));
        const cpuUsed = u ? cpuToMillicores(u.cpu) : 0;
        const memUsed = u ? memToBytes(u.memory) : 0;
        const labels = node.metadata?.labels ?? {};
        const isCp = 'node-role.kubernetes.io/control-plane' in labels || 'node-role.kubernetes.io/master' in labels;
        const ready = (node.status?.conditions ?? []).some(c => c.type === 'Ready' && c.status === 'True');

        result.push({
          name,
          role: isCp ? 'control-plane' : 'worker',
          cpuMillicores: Math.round(cpuUsed),
          cpuPercent: cpuAlloc > 0 ? Math.round((cpuUsed / cpuAlloc) * 100) : 0,
          ramBytes: memUsed,
          ramPercent: memAlloc > 0 ? Math.round((memUsed / memAlloc) * 100) : 0,
          ready,
        });
      }

      result.sort((a, b) => a.role === b.role ? a.name.localeCompare(b.name) : (a.role === 'control-plane' ? -1 : 1));
      this.gateway.emitNodeMetrics(result);
    } catch (e) {
      this.logger.warn(`Échec collecte métriques nœuds : ${(e as Error).message}`);
    }
  }

  @Interval(10_000)
  async collectPods() {
    if (!this.available) return;
    try {
      const [podsRes, metricsRes] = await Promise.all([
        this.core.listPodForAllNamespaces(),
        this.metrics.getPodMetrics(),
      ]);

      // Conso par pod (somme des conteneurs), clé "namespace/pod"
      const usage = new Map<string, { cpu: number; mem: number }>();
      for (const item of metricsRes.items ?? []) {
        const key = `${item.metadata.namespace}/${item.metadata.name}`;
        let cpu = 0, mem = 0;
        for (const c of item.containers ?? []) {
          cpu += cpuToMillicores(c.usage.cpu);
          mem += memToBytes(c.usage.memory);
        }
        usage.set(key, { cpu, mem });
      }

      // Regroupe les pods par namespace
      const byNs = new Map<string, WorkloadMetric>();
      for (const pod of podsRes.items) {
        const ns = pod.metadata?.namespace ?? '';
        const name = pod.metadata?.name ?? '';
        const u = usage.get(`${ns}/${name}`) ?? { cpu: 0, mem: 0 };
        const restarts = (pod.status?.containerStatuses ?? []).reduce((s, c) => s + (c.restartCount ?? 0), 0);
        const ready = (pod.status?.conditions ?? []).some(c => c.type === 'Ready' && c.status === 'True');
        const podMetric: PodMetric = {
          name,
          cpuMillicores: Math.round(u.cpu),
          ramBytes: u.mem,
          node: pod.spec?.nodeName ?? '',
          restarts,
          ready,
          phase: pod.status?.phase ?? 'Unknown',
        };
        if (!byNs.has(ns)) {
          byNs.set(ns, {
            namespace: ns,
            kind: INFRA_NS.has(ns) ? 'infra' : 'workload',
            cpuMillicores: 0, ramBytes: 0, podCount: 0, readyCount: 0, pods: [],
          });
        }
        const w = byNs.get(ns)!;
        w.pods.push(podMetric);
        w.cpuMillicores += podMetric.cpuMillicores;
        w.ramBytes += podMetric.ramBytes;
        w.podCount += 1;
        if (ready) w.readyCount += 1;
      }

      const result = [...byNs.values()].sort((a, b) => b.ramBytes - a.ramBytes);
      result.forEach(w => w.pods.sort((a, b) => b.ramBytes - a.ramBytes));
      this.gateway.emitWorkloadMetrics(result);
    } catch (e) {
      this.logger.warn(`Échec collecte métriques pods : ${(e as Error).message}`);
    }
  }
}
