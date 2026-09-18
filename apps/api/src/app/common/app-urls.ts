/**
 * UIs web des applications du homelab — source unique, consommée par le tableau
 * du dashboard (cluster.service) et par la page Versions (version.service).
 */

// Domaine du Gateway Envoy : toutes les UIs sont routées en <app>.<HOMELAB_DOMAIN>.
// En http — le certificat du gateway est auto-signé, https ferait crier le navigateur.
export const HOMELAB_DOMAIN = process.env['HOMELAB_DOMAIN'] ?? '10.10.10.210.nip.io';
export const ui = (sub: string) => `http://${sub}.${HOMELAB_DOMAIN}`;

// Argo CD est exposé par son propre service MetalLB, hors du gateway, en https.
export const ARGOCD_URL = process.env['ARGOCD_URL'] ?? 'https://10.10.10.200';

/**
 * Namespace k8s → UI. Un namespace absent de cette table n'a pas d'interface
 * (Calico, MetalLB, sealed-secrets…) et n'affichera donc pas de bouton.
 * `nexus` est volontairement absent : ce serait un lien vers l'app courante.
 */
export const UI_BY_NAMESPACE: Readonly<Record<string, string>> = {
  nextcloud: ui('nextcloud'),
  jellyfin: ui('jellyfin'),
  audiobookshelf: ui('audiobookshelf'),
  'calibre-web': ui('calibre'),
  qbittorrent: ui('qbittorrent'),
  sideloop: ui('sideloop'),
  ntfy: ui('ntfy'),
  argocd: ARGOCD_URL,
};
