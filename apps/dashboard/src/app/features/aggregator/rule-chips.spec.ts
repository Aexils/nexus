import { describeRule, formatRule, joinRules, parseRule, splitRules } from './rule-chips';

describe('règles en puces', () => {
  it('lit les mots du moteur et les réécrit sans perte', () => {
    const chips = parseRule('4K SDR MULTI fr h265 <=20');
    expect(chips).toEqual({ resolutions: ['2160p'], dynamics: ['SDR'], multi: true, languages: ['fr'], codecs: ['h265'], maxSize: 20, extra: [] });
    expect(formatRule(chips)).toBe('4K SDR MULTI fr h265 <=20');
    expect(describeRule(chips)).toBe('4K · SDR · MULTi · audio fr · h265 · ≤ 20 Go');
  });

  it('garde tel quel un mot inconnu, laissé à la validation du backend', () => {
    const chips = parseRule('1080p SDRR');
    expect(chips.extra).toEqual(['SDRR']);
    expect(formatRule(chips)).toBe('1080p SDRR');
  });

  it('découpe et recompose les règles ordonnées', () => {
    expect(splitRules('4K SDR MULTI | 4K HDR MULTI > 1080p')).toEqual(['4K SDR MULTI', '4K HDR MULTI', '1080p']);
    expect(joinRules([' 4K ', '', '1080p'])).toBe('4K | 1080p');
  });
});
