// Tyto — écoute déclenchée par le niveau sonore (service systemd sur l'hôte pve).
// Nexus détient l'ÉTAT (le mode), Tyto va le chercher : le service tourne hors
// cluster et ce sens de flux évite d'avoir à le rendre joignable.

export type TytoMode = 'off' | 'silent' | 'armed';

export interface TytoModeState {
  mode:  TytoMode;
  /** Unix ms — échéance du désarmement temporaire ; null = permanent. */
  until: number | null;
  /** Qui a posé ce mode (dashboard, ntfy, override local…). */
  source: string;
  /** Unix ms — dernière modification. */
  changedAt: number;
  /** Réglages de détection, servis au même sondage pour éviter un aller-retour. */
  settings: TytoSettings;
}

/**
 * Réglages de détection, modifiables à chaud depuis le dashboard.
 * Tyto les tire au même sondage que le mode et les applique sans redémarrage.
 * Les bornes sont appliquées côté serveur ET côté Tyto : un delta à 0
 * enregistrerait en continu jusqu'à remplir le disque.
 */
export interface TytoSettings {
  /** Écart au-dessus du fond qui déclenche (dB). 3–40. */
  deltaDb:    number;
  /** Silence requis pour clore un événement (s). 1–60. */
  hangoverS:  number;
  /** Plafond de durée d'un fichier (s). 10–900. */
  maxEventS:  number;
  /** Son gardé AVANT le déclenchement (s). 0–30. */
  prerollS:   number;
}

export const TYTO_SETTINGS_BOUNDS: Record<keyof TytoSettings, { min: number; max: number; step: number; unit: string; label: string; hint: string }> = {
  deltaDb:   { min: 3,  max: 40,  step: 1, unit: 'dB', label: 'Seuil de déclenchement',
               hint: 'écart au-dessus du fond de la pièce' },
  hangoverS: { min: 1,  max: 60,  step: 1, unit: 's',  label: 'Silence de fin',
               hint: "temps calme avant de clore l'enregistrement" },
  maxEventS: { min: 10, max: 900, step: 10, unit: 's', label: 'Durée maximale',
               hint: 'plafond par fichier' },
  prerollS:  { min: 0,  max: 30,  step: 1, unit: 's',  label: 'Pré-roll',
               hint: 'son gardé avant le déclenchement' },
};

/** Un déclenchement, tel que Tyto le rapporte sur /events. */
export interface TytoEvent {
  ts:       number;   // Unix ms
  file:     string;   // nom du fichier opus
  day:      string;   // AAAA-MM-JJ (dossier Nextcloud)
  duration: number;   // s, hors pré-roll
  peak:     number;   // dBFS
  baseline: number;   // dBFS — fond au moment du déclenchement
  notified: boolean;
}

/**
 * Santé du service, telle que servie sur le dashboard.
 * ⚠ `baseline`/`lastDb` sont des dBFS (relatif au plein échelle numérique),
 * PAS des dB SPL : sans micro calibré il n'existe pas de décibel absolu.
 * Ne jamais afficher ces valeurs comme un niveau sonore réel.
 */
export interface TytoStatus {
  reachable:   boolean;          // Tyto répond-il sur son API locale ?
  mode:        TytoMode;
  until:       number | null;
  /** 'warmup' | 'écoute' | 'enregistrement' | 'off' | 'kodi' — état de la machine. */
  state:       string;
  baseline:    number | null;    // dBFS
  lastDb:      number | null;    // dBFS
  eventsToday: number;
  settings:    TytoSettings;     // réglages effectivement appliqués par Tyto
  recent:      TytoEvent[];      // derniers déclenchements (récent → ancien)
  checkedAt:   number;           // Unix ms
}
