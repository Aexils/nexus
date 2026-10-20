import { MerchantRule } from '@nexus/shared-types';

/**
 * Moteur de classement déterministe.
 *
 * Aucun modèle, aucun appel réseau : un libellé bancaire entre, une règle en
 * sort. Tout l'enjeu est que la table de règles se remplisse toute seule —
 * d'où `suggestPattern()`, qui transforme un libellé ponctuel en motif
 * réutilisable au moment où l'utilisateur corrige une ligne.
 */

/** Majuscules, sans accents, ponctuation réduite à des espaces. */
export function normalizeLabel(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

/**
 * Mots que les banques collent autour du vrai nom du commerce. Les retirer
 * évite d'apprendre « ACHAT » comme motif et de tout faire correspondre.
 */
const NOISE_TOKENS = new Set([
  'ACHAT', 'ACH', 'PAIEMENT', 'PAIEMENTS', 'PREAUTORISE', 'PREAUTORISES',
  'FACTURE', 'RETRAIT', 'DEPOT', 'VIREMENT', 'TRANSFERT', 'INTERAC',
  'POS', 'TPV', 'DEBIT', 'CREDIT', 'INTERNET', 'MOBILE', 'GUICHET',
  'TRANSACTION', 'FRAIS', 'FACT', 'FOURNISSEUR', 'FOURNISSEURS', 'FOURN',
  'PURCHASE', 'PAYMENT', 'WITHDRAWAL', 'DEPOSIT', 'TRANSFER',
  'CAN', 'CA', 'QC', 'ON', 'NB', 'NS', 'BC', 'AB', 'MB', 'SK', 'PE', 'NL',
  'INC', 'LTEE', 'LTD', 'LTE', 'ENR', 'SENC', 'CO', 'CORP', 'SARL',
]);

/** Un jeton qui contient un chiffre est un numéro de succursale ou de référence. */
function isNoise(token: string): boolean {
  if (!token) return true;
  if (/\d/.test(token)) return true;
  if (token.length <= 1) return true;
  return NOISE_TOKENS.has(token);
}

/**
 * Déduit un motif réutilisable depuis un libellé ponctuel.
 *
 *   `ACHAT WAL-MART #3106 MONTREAL QC` → `WAL MART`
 *   `PAIEMENT PREAUTORISE BELL CANADA` → `BELL CANADA`
 *
 * On garde au plus deux jetons utiles : un seul attrape trop large
 * (« MARCHE » matcherait n'importe quel marché), trois sont presque toujours
 * trop spécifiques pour survivre au changement de succursale.
 *
 * C'est une proposition — l'écran de révision l'affiche et laisse corriger.
 */
export function suggestPattern(rawLabel: string): string {
  const tokens = normalizeLabel(rawLabel).split(' ');
  const useful = tokens.filter(t => !isNoise(t));

  if (!useful.length) {
    // Que du bruit : on retombe sur les deux premiers jetons bruts, faute de mieux.
    return tokens.slice(0, 2).join(' ').trim();
  }

  return useful.slice(0, 2).join(' ');
}

/**
 * Longueur minimale d'un motif pour autoriser le repli sans espaces.
 * En dessous, coller les mots crée des correspondances fortuites
 * (« A W » → « AW » se retrouverait dans SHAW, LAWN…).
 */
const MIN_SPACELESS_PATTERN = 5;

const stripSpaces = (s: string) => s.replace(/ /g, '');

/** Une règle correspond-elle à ce libellé déjà normalisé ? */
function ruleMatches(rule: MerchantRule, normalized: string): boolean {
  switch (rule.matchType) {
    case 'exact':
      return normalized === rule.pattern;
    case 'regex':
      try {
        return new RegExp(rule.pattern, 'i').test(normalized);
      } catch {
        // Un motif invalide saisi à la main ne doit pas faire tomber l'import.
        return false;
      }
    case 'contains':
    default: {
      if (normalized.includes(rule.pattern)) return true;

      // Repli : on recompare en ayant collé les mots des deux côtés.
      //
      // Les banques suppriment les apostrophes — « Harvey's » devient
      // « HARVEYS » — alors que la normalisation d'un nom saisi à la main en
      // fait « HARVEY S ». Sans ce repli, cinq commerces récurrents du foyer
      // (Harvey's, Mcdonald's, Marshall's, O'Tacos, L'Olympia) ne seraient
      // jamais reconnus. Ça rattrape aussi les libellés tronqués par la banque
      // au milieu d'un mot.
      const pattern = stripSpaces(rule.pattern);
      if (pattern.length < MIN_SPACELESS_PATTERN) return false;
      return stripSpaces(normalized).includes(pattern);
    }
  }
}

/**
 * Meilleure règle pour un libellé, ou null.
 *
 * Départage : priorité décroissante, puis motif le plus long. Un motif long
 * est plus spécifique, donc `SUPER C` doit l'emporter sur `SUPER` si les deux
 * existent.
 */
export function classify(rawLabel: string, rules: MerchantRule[]): MerchantRule | null {
  const normalized = normalizeLabel(rawLabel);
  if (!normalized) return null;

  let best: MerchantRule | null = null;

  for (const rule of rules) {
    if (!ruleMatches(rule, normalized)) continue;
    if (
      !best ||
      rule.priority > best.priority ||
      (rule.priority === best.priority && rule.pattern.length > best.pattern.length)
    ) {
      best = rule;
    }
  }

  return best;
}

/**
 * Clé de déduplication.
 *
 * En OFX le FITID de la banque suffit et est exact. En CSV on reconstruit à
 * partir de (titulaire, date, montant, libellé normalisé) — deux achats
 * réellement identiques le même jour collisionnent, et c'est voulu : ils
 * remontent dans l'écran de révision plutôt que d'entrer en double en silence.
 */
export function dedupKey(
  accountOwner: string,
  fitid: string,
  date: string,
  amount: number,
  rawLabel: string,
): string {
  if (fitid) return `${accountOwner}:fit:${fitid}`;
  return `${accountOwner}:syn:${date}:${amount.toFixed(2)}:${normalizeLabel(rawLabel)}`;
}
