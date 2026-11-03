import { toTitle } from './trakt.service';

describe('toTitle', () => {
  it('garde un film ou une série avec son identifiant TMDb', () => {
    const show = { title: 'The Simpsons', year: 1989, ids: { tmdb: 456, slug: 'the-simpsons' } };
    expect(toTitle({ type: 'show', show })).toEqual({
      kind: 'show',
      title: 'The Simpsons',
      year: 1989,
      tmdb: 456,
      slug: 'the-simpsons',
    });
  });

  it('écarte un titre sans identifiant TMDb et les autres types', () => {
    expect(toTitle({ type: 'movie', movie: { title: 'X', year: null, ids: { slug: 'x' } } })).toBeNull();
    expect(toTitle({ type: 'season' })).toBeNull();
  });
});
