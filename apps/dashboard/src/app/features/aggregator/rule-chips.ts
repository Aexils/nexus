// Une règle de profil affichée en puces, et retour au texte. Simple mise en forme : la grammaire
// et le classement appartiennent au moteur commun (kube-aggregator), qui valide tout enregistrement
// et tout aperçu. Un mot non reconnu ici est gardé tel quel (puce brute) et laissé au backend.

export const RESOLUTIONS = ['480p', '720p', '1080p', '1440p', '2160p'] as const;
export const DYNAMICS = ['SDR', 'HDR', 'DV'] as const;
export const CODECS = ['h264', 'h265', 'av1'] as const;

export interface RuleChips {
  resolutions: string[];
  dynamics: string[];
  multi: boolean;
  languages: string[];
  codecs: string[];
  maxSize: number | null;
  /** Mots inconnus de l'interface, conservés sans interprétation. */
  extra: string[];
}

const RESOLUTION_ALIASES: Record<string, string> = { '4k': '2160p', uhd: '2160p', fullhd: '1080p', fhd: '1080p', hd: '720p' };
const CODEC_ALIASES: Record<string, string> = {
  h264: 'h264', 'h.264': 'h264', x264: 'h264', avc: 'h264', h265: 'h265', 'h.265': 'h265', x265: 'h265', hevc: 'h265', av1: 'av1',
};

export function emptyRule(): RuleChips {
  return { resolutions: [], dynamics: [], multi: false, languages: [], codecs: [], maxSize: null, extra: [] };
}

export function parseRule(text: string): RuleChips {
  const chips = emptyRule();
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const low = word.toLowerCase();
    const resolution = RESOLUTION_ALIASES[low] ?? low;
    if ((RESOLUTIONS as readonly string[]).includes(resolution)) chips.resolutions.push(resolution);
    else if ((DYNAMICS as readonly string[]).includes(word.toUpperCase())) chips.dynamics.push(word.toUpperCase());
    else if (low === 'multi') chips.multi = true;
    else if (/^<=\d+([.,]\d+)?$/.test(low)) chips.maxSize = Number(low.slice(2).replace(',', '.'));
    else if (CODEC_ALIASES[low]) chips.codecs.push(CODEC_ALIASES[low]);
    else if (/^[a-z]{2,3}$/.test(low)) chips.languages.push(low);
    else chips.extra.push(word);
  }
  return chips;
}

export function formatRule(chips: RuleChips): string {
  const words = [
    ...chips.resolutions.map(r => (r === '2160p' ? '4K' : r)),
    ...chips.dynamics,
    ...(chips.multi ? ['MULTI'] : []),
    ...chips.languages,
    ...chips.codecs,
    ...(chips.maxSize !== null ? [`<=${chips.maxSize}`] : []),
    ...chips.extra,
  ];
  return words.join(' ');
}

export function splitRules(rules: string): string[] {
  return rules.split(/[|>]/).map(r => r.trim()).filter(Boolean);
}

export function joinRules(rules: string[]): string {
  return rules.map(r => r.trim()).filter(Boolean).join(' | ');
}

/** Lecture humaine d'une règle (pour un lecteur d'écran ou un résumé). */
export function describeRule(chips: RuleChips): string {
  const parts = [
    chips.resolutions.map(r => (r === '2160p' ? '4K' : r)).join(' ou '),
    chips.dynamics.join(' ou '),
    chips.multi ? 'MULTi' : '',
    chips.languages.length ? `audio ${chips.languages.join('/')}` : '',
    chips.codecs.join(' ou '),
    chips.maxSize !== null ? `≤ ${chips.maxSize} Go` : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'toute release';
}
