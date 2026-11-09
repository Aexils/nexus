import {
  Baby, BookOpen, Bookmark, Clapperboard, Drama, Film, Flame, Gamepad2, Ghost, Globe, Heart, Home,
  LucideIconData, Music, Popcorn, Rocket, Sparkles, Star, Trophy, Tv,
} from 'lucide-angular';

const SIMPLE_ICONS_VERSION = '16.36.0';
const SIMPLE_ICONS = `https://cdn.jsdelivr.net/npm/simple-icons@${SIMPLE_ICONS_VERSION}`;
const ICON_SIZE = 128;

export interface BrandIcon {
  title: string;
  slug: string;
}

/** Icônes générales, pour un écran qui n'a pas de marque. */
export const GENERAL_ICONS: { name: string; data: LucideIconData }[] = [
  { name: 'Maison', data: Home }, { name: 'Film', data: Film }, { name: 'Clap', data: Clapperboard },
  { name: 'Télé', data: Tv }, { name: 'Popcorn', data: Popcorn }, { name: 'Étoile', data: Star },
  { name: 'Coeur', data: Heart }, { name: 'Signet', data: Bookmark }, { name: 'Tendance', data: Flame },
  { name: 'Nouveau', data: Sparkles }, { name: 'Trophée', data: Trophy }, { name: 'Enfants', data: Baby },
  { name: 'Horreur', data: Ghost }, { name: 'Théâtre', data: Drama }, { name: 'Musique', data: Music },
  { name: 'Jeux', data: Gamepad2 }, { name: 'Science-fiction', data: Rocket }, { name: 'Lecture', data: BookOpen },
  { name: 'Monde', data: Globe },
];

/** Marques mises en avant tant que rien n'est cherché. */
export const SUGGESTED_BRANDS = ['Netflix', 'YouTube', 'Apple TV', 'Paramount+', 'Max', 'HBO', 'Twitch', 'Plex', 'Jellyfin', 'Crunchyroll', 'Tubi', 'Spotify'];

// Même règle que Simple Icons pour passer du nom au fichier.
function slugOf(title: string): string {
  return title
    .replace(/\+/g, 'plus').replace(/\./g, 'dot').replace(/&/g, 'and')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

export async function loadBrands(): Promise<BrandIcon[]> {
  const res = await fetch(`${SIMPLE_ICONS}/data/simple-icons.json`);
  const data = (await res.json()) as { title: string; slug?: string }[];
  return data.map(i => ({ title: i.title, slug: i.slug ?? slugOf(i.title) }));
}

export function brandUrl(slug: string): string {
  return `${SIMPLE_ICONS}/icons/${slug}.svg`;
}

export function generalSvg(data: LucideIconData): string {
  const body = data
    .map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ')}/>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

export async function brandSvg(slug: string): Promise<string> {
  const svg = await (await fetch(brandUrl(slug))).text();
  return svg.replace('<svg ', '<svg fill="#fff" ');
}

function draw(source: CanvasImageSource, width: number, height: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = ICON_SIZE;
  const scale = Math.min(ICON_SIZE / width, ICON_SIZE / height);
  const w = width * scale;
  const h = height * scale;
  canvas.getContext('2d')?.drawImage(source, (ICON_SIZE - w) / 2, (ICON_SIZE - h) / 2, w, h);
  return canvas.toDataURL('image/png').split(',')[1];
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('image'));
    image.src = url;
  });
}

/** Kodi n'affiche pas le SVG : le logo part en PNG, en base64. */
export async function svgToPng(svg: string): Promise<string> {
  const sized = svg.replace('<svg ', `<svg width="${ICON_SIZE}" height="${ICON_SIZE}" `);
  const url = URL.createObjectURL(new Blob([sized], { type: 'image/svg+xml' }));
  try {
    return draw(await loadImage(url), ICON_SIZE, ICON_SIZE);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function fileToPng(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    return draw(image, image.naturalWidth, image.naturalHeight);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Le navigateur ne peut pas joindre api.trakt.tv du rpi5 : il passe par Nexus. */
export function iconForBrowser(icon: string): string {
  return icon.replace('https://api.trakt.tv/assets/', '/api/trakt/assets/');
}
