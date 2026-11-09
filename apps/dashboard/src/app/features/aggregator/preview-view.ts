import { AggregatorPreview, AggregatorPreviewRelease } from '@nexus/shared-types';

export interface PreviewRow {
  release: AggregatorPreviewRelease;
  /** Rang d'essai de l'autoplay (1 = lancée en premier), null si jamais essayée. */
  attempt: number | null;
}

/** Ordre d'affichage : d'abord les essais de l'autoplay DANS l'ordre décidé par le backend,
 *  puis les releases qu'il n'essaiera pas (écartées ou hors sources). Aucun reclassement ici. */
export function previewRows(preview: AggregatorPreview): PreviewRow[] {
  const attempts = new Map(preview.autoplay.map((id, index) => [id, index + 1]));
  const byId = new Map(preview.releases.map(r => [r.release_id, r]));
  const tried = preview.autoplay.map(id => byId.get(id)).filter((r): r is AggregatorPreviewRelease => !!r)
    .map(release => ({ release, attempt: attempts.get(release.release_id) ?? null }));
  const others = preview.releases.filter(r => !attempts.has(r.release_id)).map(release => ({ release, attempt: null }));
  return [...tried, ...others];
}
