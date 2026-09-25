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
}

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
  recent:      TytoEvent[];      // derniers déclenchements (récent → ancien)
  checkedAt:   number;           // Unix ms
}
