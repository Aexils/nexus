import { AggregatorPreviewRelease } from '@nexus/shared-types';
import { previewRows } from './preview-view';

const r = (release_id: string, refusal: string | null = null): AggregatorPreviewRelease => ({
  release_id, tier: 'vstream', rank: 0, explanation: '', refusal, source: null, resolution: null, hdr: null,
  languages: [], file_size_gb: null, access: null,
});

describe('aperçu : ordre d’affichage', () => {
  it('les essais de l’autoplay d’abord, dans l’ordre du backend, puis les écartées', () => {
    const rows = previewRows({ profile: 'p', rules: [], refused: {}, autoplay: ['c', 'a'],
                               releases: [r('a'), r('x', 'not_authorized'), r('c'), r('y', 'format')] });
    expect(rows.map(row => [row.release.release_id, row.attempt])).toEqual([['c', 1], ['a', 2], ['x', null], ['y', null]]);
  });
});
