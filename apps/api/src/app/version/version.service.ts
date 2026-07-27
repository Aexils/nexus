import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { KubeConfig, AppsV1Api, CoreV1Api } from '@kubernetes/client-node';
import { NexusGateway } from '../gateway/nexus.gateway';
import { VersionCategory, VersionItem, VersionsReport } from '@nexus/shared-types';

const NODE_EXPORTER_URL = process.env['NODE_EXPORTER_URL'] ?? 'http://10.10.10.1:9100/metrics';

/** Une entrée k8s : où lire la version courante (image d'un workload) + repo amont. */
interface K8sEntry {
  name: string;
  category: VersionCategory;
  ns: string;
  workload: string;         // nom du Deployment ou DaemonSet
  github?: string;          // repo pour la dernière version
  own?: boolean;            // app maison (pas d'amont)
  detail?: string;
}

const REGISTRY: K8sEntry[] = [
  // ── Applications (ce qu'on utilise) ──
  { name: 'Nextcloud', category: 'application', ns: 'nextcloud', workload: 'nextcloud', github: 'nextcloud/server' },
  { name: 'Jellyfin',  category: 'application', ns: 'jellyfin',  workload: 'jellyfin',  github: 'jellyfin/jellyfin' },
  { name: 'Audiobookshelf', category: 'application', ns: 'audiobookshelf', workload: 'audiobookshelf', github: 'advplyr/audiobookshelf' },
  { name: 'Calibre-Web',    category: 'application', ns: 'calibre-web',    workload: 'calibre-web',    github: 'crocodilestick/Calibre-Web-Automated' },
  { name: 'Sideloop',  category: 'application', ns: 'sideloop',  workload: 'sideloop',  own: true, detail: 'app maison' },
  { name: 'Nexus',     category: 'application', ns: 'nexus',     workload: 'api',       own: true, detail: 'app maison' },
  // ── Composants (la plomberie du cluster) ──
  { name: 'Argo CD',        category: 'component', ns: 'argocd',                workload: 'argocd-server',                                 github: 'argoproj/argo-cd' },
  { name: 'Image Updater',  category: 'component', ns: 'argocd',                workload: 'image-updater-argocd-image-updater-controller', github: 'argoproj-labs/argocd-image-updater' },
  { name: 'Calico',         category: 'component', ns: 'calico-system',        workload: 'calico-node',                                   github: 'projectcalico/calico' },
  { name: 'Tigera Operator',category: 'component', ns: 'tigera-operator',      workload: 'tigera-operator',                               github: 'tigera/operator' },
  { name: 'MetalLB',        category: 'component', ns: 'metallb-system',       workload: 'controller',                                    github: 'metallb/metallb' },
  { name: 'Envoy Gateway',  category: 'component', ns: 'envoy-gateway-system', workload: 'envoy-gateway',                                 github: 'envoyproxy/gateway' },
  { name: 'Sealed Secrets', category: 'component', ns: 'sealed-secrets',       workload: 'sealed-secrets-controller',                     github: 'bitnami-labs/sealed-secrets' },
  { name: 'metrics-server', category: 'component', ns: 'kube-system',          workload: 'metrics-server',                                github: 'kubernetes-sigs/metrics-server' },
  { name: 'local-path',     category: 'component', ns: 'local-path-storage',   workload: 'local-path-provisioner',                        github: 'rancher/local-path-provisioner' },
  { name: 'ntfy',           category: 'component', ns: 'ntfy',                 workload: 'ntfy',                                          github: 'binwiederhier/ntfy' },
];

// Cluster : github pour la dernière version amont.
const CLUSTER_REPOS = {
  kubernetes: 'kubernetes/kubernetes',
  containerd: 'containerd/containerd',
  etcd:       'etcd-io/etcd',
} as const;

@Injectable()
export class VersionService implements OnModuleInit {
  private readonly logger = new Logger(VersionService.name);
  private apps!: AppsV1Api;
  private core!: CoreV1Api;
  private available = false;
  private latestCache: Record<string, string> = {};   // repo → dernière version

  constructor(private readonly gateway: NexusGateway) {}

  onModuleInit(): void {
    try {
      const kc = new KubeConfig();
      kc.loadFromCluster();
      this.apps = kc.makeApiClient(AppsV1Api);
      this.core = kc.makeApiClient(CoreV1Api);
      this.available = true;
    } catch (e) {
      this.logger.warn(`Pas de config in-cluster (dev ?) : ${(e as Error).message}`);
    }
    setTimeout(() => this.refresh(), 6000);
  }

  @Interval(6 * 60 * 60 * 1000) // toutes les 6 h : re-fetch amont + recalcul
  async scheduled(): Promise<void> { await this.refresh(); }

  // Recalcul plus fréquent des versions COURANTES (les tags k8s bougent via Image
  // Updater), sans re-taper GitHub (on garde le cache amont).
  @Interval(60 * 1000)
  async quick(): Promise<void> { await this.refresh(false); }

  private async refresh(fetchLatest = true): Promise<void> {
    if (fetchLatest) await this.fetchAllLatest();

    const currents = await this.readK8sImages();
    const nodeInfo = await this.readNodeInfo();
    const host = await this.readHostMetrics();

    const items: VersionItem[] = [];

    // ── Applications + composants (k8s) ──
    for (const e of REGISTRY) {
      const current = currents[`${e.ns}/${e.workload}`] ?? null;
      const latest = e.github ? this.latestCache[e.github] ?? null : null;
      items.push(this.compare({
        name: e.name, category: e.category, current, latest,
        repo: e.github, own: e.own, detail: e.detail,
      }));
    }

    // ── Cluster ──
    if (nodeInfo) {
      items.push(this.compare({
        name: 'Kubernetes', category: 'cluster', current: nodeInfo.k8s,
        latest: this.latestCache[CLUSTER_REPOS.kubernetes] ?? null,
        repo: CLUSTER_REPOS.kubernetes,
        detail: '1 mineure derrière volontairement (drill CKA)',
      }));
      items.push(this.compare({
        name: 'containerd', category: 'cluster', current: nodeInfo.containerd,
        latest: this.latestCache[CLUSTER_REPOS.containerd] ?? null, repo: CLUSTER_REPOS.containerd,
      }));
      if (nodeInfo.etcd) {
        items.push(this.compare({
          name: 'etcd', category: 'cluster', current: nodeInfo.etcd,
          latest: this.latestCache[CLUSTER_REPOS.etcd] ?? null, repo: CLUSTER_REPOS.etcd,
        }));
      }
    }

    // ── Système ──
    if (host) {
      items.push({
        name: 'Proxmox VE (hôte)', category: 'system',
        current: host.osPretty, latest: null,
        upToDate: host.aptPending === 0,
        detail: host.aptPending > 0 ? `${host.aptPending} paquets à mettre à jour` : 'à jour',
      });
    }
    if (nodeInfo) {
      items.push({
        name: 'VMs (nœuds K8s)', category: 'system',
        current: nodeInfo.os, latest: null, upToDate: null,
        detail: `noyau ${nodeInfo.kernel}`,
      });
    }

    const report: VersionsReport = { items, generatedAt: Date.now() };
    this.gateway.emitVersions(report);
  }

  // ── Versions COURANTES : tags d'image des workloads k8s ─────────────────────

  private async readK8sImages(): Promise<Record<string, string>> {
    if (!this.available) return {};
    const out: Record<string, string> = {};
    try {
      const [deps, dss] = await Promise.all([
        this.apps.listDeploymentForAllNamespaces(),
        this.apps.listDaemonSetForAllNamespaces(),
      ]);
      for (const d of [...deps.items, ...dss.items]) {
        const ns = d.metadata?.namespace ?? '';
        const name = d.metadata?.name ?? '';
        const image = d.spec?.template?.spec?.containers?.[0]?.image ?? '';
        const tag = this.tagFromImage(image);
        if (tag) out[`${ns}/${name}`] = tag;
      }
    } catch (e) {
      this.logger.warn(`Lecture images k8s échouée : ${(e as Error).message}`);
    }
    return out;
  }

  /** "quay.io/argoproj/argocd:v3.4.5" → "v3.4.5" ; SHA 40 hex → "git". */
  private tagFromImage(image: string): string | null {
    const tag = image.includes(':') ? image.split(':').at(-1) ?? '' : '';
    if (!tag || tag === 'latest') return 'latest';
    if (/^[0-9a-f]{40}$/.test(tag)) return 'git';
    return tag;
  }

  // ── Infos nœuds (cluster + OS des VMs) ──────────────────────────────────────

  private async readNodeInfo(): Promise<{ k8s: string; containerd: string; os: string; kernel: string; etcd: string } | null> {
    if (!this.available) return null;
    try {
      const nodes = await this.core.listNode();
      const info = nodes.items[0]?.status?.nodeInfo;
      if (!info) return null;
      let etcd = '';
      try {
        const pods = await this.core.listNamespacedPod({ namespace: 'kube-system', labelSelector: 'component=etcd' });
        etcd = this.tagFromImage(pods.items[0]?.spec?.containers?.[0]?.image ?? '') ?? '';
      } catch { /* etcd introuvable : on laisse vide */ }
      return {
        k8s: info.kubeletVersion,
        containerd: (info.containerRuntimeVersion || '').replace('containerd://', ''),
        os: info.osImage,
        kernel: info.kernelVersion,
        etcd,
      };
    } catch (e) {
      this.logger.warn(`Lecture nœuds échouée : ${(e as Error).message}`);
      return null;
    }
  }

  // ── Hôte pve : OS + paquets apt en attente (via node_exporter) ──────────────

  private async readHostMetrics(): Promise<{ osPretty: string; aptPending: number } | null> {
    try {
      const res = await fetch(NODE_EXPORTER_URL, { signal: AbortSignal.timeout(2500) });
      const raw = await res.text();
      const osPretty = raw.match(/node_os_info\{[^}]*pretty_name="([^"]+)"/)?.[1] ?? 'Debian';
      let aptPending = 0;
      for (const line of raw.split('\n')) {
        if (line.startsWith('apt_upgrades_pending{')) {
          aptPending += parseFloat(line.split(' ').at(-1) ?? '0') || 0;
        }
      }
      return { osPretty, aptPending: Math.round(aptPending) };
    } catch {
      return null;
    }
  }

  // ── Dernières versions amont (GitHub) ───────────────────────────────────────

  private async fetchAllLatest(): Promise<void> {
    const repos = new Set<string>([
      ...REGISTRY.filter(e => e.github).map(e => e.github as string),
      ...Object.values(CLUSTER_REPOS),
    ]);
    await Promise.allSettled([...repos].map(async repo => {
      try {
        this.latestCache[repo] = await this.fetchGitHubLatest(repo);
      } catch (e) {
        this.logger.debug(`Version amont ${repo} échouée : ${(e as Error).message}`);
      }
    }));
  }

  private async fetchGitHubLatest(repo: string): Promise<string> {
    const headers: Record<string, string> = {
      'User-Agent': 'nexus-dashboard/1.0',
      'Accept': 'application/vnd.github.v3+json',
    };
    // Token optionnel (env GITHUB_TOKEN) : passe la limite 60→5000 req/h. Non requis
    // en pratique (~15 repos / 6 h), mais utile si l'API redémarre souvent.
    const token = process.env['GITHUB_TOKEN'];
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers, signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      const data = await res.json() as { tag_name: string };
      return data.tag_name;
    }
    if (res.status === 404) {
      const tagsRes = await fetch(`https://api.github.com/repos/${repo}/tags?per_page=1`, {
        headers, signal: AbortSignal.timeout(10_000),
      });
      if (!tagsRes.ok) throw new Error(`tags ${tagsRes.status}`);
      const tags = await tagsRes.json() as { name: string }[];
      if (!tags.length) throw new Error('aucun tag');
      return tags[0].name;
    }
    throw new Error(`GitHub ${res.status}`);
  }

  // ── Comparaison ─────────────────────────────────────────────────────────────

  private compare(p: {
    name: string; category: VersionCategory; current: string | null; latest: string | null;
    repo?: string; own?: boolean; detail?: string;
  }): VersionItem {
    let upToDate: boolean | null = null;
    if (!p.own && p.current && p.current !== 'git' && p.current !== 'latest' && p.latest) {
      upToDate = this.semverCompare(p.current, p.latest) >= 0;
    }
    return {
      name: p.name, category: p.category,
      current: p.current, latest: p.latest, upToDate,
      repo: p.repo, detail: p.detail,
    };
  }

  private norm(v: string): number[] {
    const clean = v.replace(/^v/i, '').split(/[-+_ ]/)[0];
    return clean.split('.').map(n => parseInt(n, 10) || 0);
  }

  /** -1 si a<b, 0 si égal, 1 si a>b (sémantique semver). */
  private semverCompare(a: string, b: string): number {
    const pa = this.norm(a), pb = this.norm(b);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
      const x = pa[i] ?? 0, y = pb[i] ?? 0;
      if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
  }
}
