/** Suivi des versions : apps k8s, composants, cluster, système. */

export type VersionCategory = 'application' | 'component' | 'cluster' | 'system';

export interface VersionItem {
  name: string;                    // "Jellyfin", "Argo CD", "Kubernetes"…
  category: VersionCategory;
  current: string | null;          // version installée ("10.11.8", "v1.35.6"…)
  latest: string | null;           // dernière connue en amont (null = inconnu / app maison)
  upToDate: boolean | null;        // true/false ; null = indéterminé (app maison, source manquante)
  detail?: string;                 // note libre : "app maison", "1 mineure derrière (drill CKA)", "32 paquets"…
  repo?: string;                   // "jellyfin/jellyfin" (pour lien GitHub)
}

export interface VersionsReport {
  items: VersionItem[];
  generatedAt: number;             // Date.now()
}

/** @deprecated ancien format plat — remplacé par VersionsReport. */
export interface AppLatestVersions {
  [key: string]: string | undefined;
}
