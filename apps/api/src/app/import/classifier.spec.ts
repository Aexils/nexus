import { MerchantRule } from '@nexus/shared-types';
import { normalizeLabel, suggestPattern, classify, dedupKey } from './classifier';

function rule(partial: Partial<MerchantRule>): MerchantRule {
  return {
    id: 1, pattern: '', matchType: 'contains', enseigne: '', category: '',
    subcategory: '', destination: 'maison', priority: 0, hits: 0,
    origin: 'seed', createdAt: '', lastUsedAt: null,
    ...partial,
  };
}

describe('normalizeLabel', () => {
  it('met en majuscules, retire les accents et la ponctuation', () => {
    expect(normalizeLabel('Première Moisson')).toBe('PREMIERE MOISSON');
    expect(normalizeLabel('WAL-MART #3106')).toBe('WAL MART 3106');
    expect(normalizeLabel('  Crèmerie  -18°  ')).toBe('CREMERIE 18');
  });
});

describe('suggestPattern', () => {
  it('retire le bruit bancaire et le numéro de succursale', () => {
    expect(suggestPattern('ACHAT WAL-MART #3106 MONTREAL QC')).toBe('WAL MART');
    expect(suggestPattern('PAIEMENT PREAUTORISE BELL CANADA')).toBe('BELL CANADA');
    expect(suggestPattern('RETRAIT TPV METRO PLUS 0452 MONTREAL QC')).toBe('METRO PLUS');
  });

  it('produit le même motif pour deux succursales du même commerce', () => {
    // C'est la propriété qui fait converger le système : une règle apprise sur
    // une succursale doit couvrir les autres.
    expect(suggestPattern('ACHAT WAL-MART #3106 MONTREAL QC'))
      .toBe(suggestPattern('ACHAT WAL-MART #2201 LAVAL QC'));
  });

  it('ne rend pas un motif vide quand tout est du bruit', () => {
    expect(suggestPattern('PAIEMENT PREAUTORISE')).not.toBe('');
  });
});

describe('classify', () => {
  const rules = [
    rule({ id: 1, pattern: 'SUPER', enseigne: 'Supermarché générique' }),
    rule({ id: 2, pattern: 'SUPER C', enseigne: 'Super C' }),
    rule({ id: 3, pattern: 'TIM HORTONS', enseigne: 'Tim Hortons' }),
  ];

  it('préfère le motif le plus spécifique', () => {
    expect(classify('ACHAT SUPER C 0231 MONTREAL QC', rules)?.enseigne).toBe('Super C');
  });

  it('respecte la priorité avant la longueur du motif', () => {
    const withPriority = [...rules, rule({ id: 4, pattern: 'SUPER', enseigne: 'Prioritaire', priority: 10 })];
    expect(classify('ACHAT SUPER C MONTREAL', withPriority)?.enseigne).toBe('Prioritaire');
  });

  it('ignore les accents du libellé entrant', () => {
    expect(classify('achat tim hortons #421', rules)?.enseigne).toBe('Tim Hortons');
  });

  it("rattrape l'apostrophe que la banque supprime", () => {
    // L'historique saisi à la main donne le motif « HARVEY S » ; le relevé
    // écrit « HARVEYS ». Sans repli, ce commerce récurrent resterait inconnu.
    const apostrophes = [
      rule({ id: 10, pattern: 'HARVEY S', enseigne: "Harvey's" }),
      rule({ id: 11, pattern: 'MCDONALD S', enseigne: "Mcdonald's" }),
      rule({ id: 12, pattern: 'L OLYMPIA', enseigne: "L'Olympia" }),
    ];
    expect(classify('RETRAIT TPV HARVEYS LONGUEUIL QC', apostrophes)?.enseigne).toBe("Harvey's");
    expect(classify('ACHAT MCDONALDS #4821 MONTREAL QC', apostrophes)?.enseigne).toBe("Mcdonald's");
    expect(classify('ACHAT LOLYMPIA 7401 LONGUEUIL QC', apostrophes)?.enseigne).toBe("L'Olympia");
  });

  it('ne colle pas les mots des motifs trop courts', () => {
    // « A W » deviendrait « AW » et matcherait SHAW, LAWN, etc.
    const court = [rule({ id: 13, pattern: 'A W', enseigne: 'A&W' })];
    expect(classify('ACHAT SHAWINIGAN MARCHE', court)).toBeNull();
    // Mais la correspondance normale continue de marcher.
    expect(classify('ACHAT A W #221 LAVAL QC', court)?.enseigne).toBe('A&W');
  });

  it('rend null quand rien ne correspond', () => {
    expect(classify('RESTO JAMAIS VU', rules)).toBeNull();
  });

  it("ne tombe pas sur une regex invalide saisie à la main", () => {
    const broken = [rule({ id: 9, pattern: '[invalide(', matchType: 'regex' })];
    expect(() => classify('PEU IMPORTE', broken)).not.toThrow();
    expect(classify('PEU IMPORTE', broken)).toBeNull();
  });
});

describe('dedupKey', () => {
  it('utilise le FITID quand la banque en fournit un', () => {
    expect(dedupKey('marion', 'ABC123', '2026-10-15', 45.67, 'PEU IMPORTE'))
      .toBe('marion:fit:ABC123');
  });

  it('reconstruit une clé stable sans FITID', () => {
    const a = dedupKey('marion', '', '2026-10-15', 45.67, 'ACHAT  METRO');
    const b = dedupKey('marion', '', '2026-10-15', 45.67, 'achat métro');
    expect(a).toBe(b);
  });

  it('sépare les titulaires', () => {
    expect(dedupKey('alexis', '', '2026-10-15', 45.67, 'METRO'))
      .not.toBe(dedupKey('marion', '', '2026-10-15', 45.67, 'METRO'));
  });
});
