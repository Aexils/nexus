// Santé de la connexion Internet (sonde depuis le pod api : joignabilité de la
// passerelle Home Hub + du WAN). Sert à dater les coupures — surtout celles où
// le Hub lui-même disparaît (hubDown = signature d'un reboot du boîtier Bell).

export interface LinkOutage {
  start:       number;         // Unix ms — début de la coupure
  end:         number | null;  // Unix ms — fin ; null = coupure en cours
  durationSec: number;         // durée (s) ; pour une coupure en cours : écoulé jusqu'ici
  hubDown:     boolean;        // true = passerelle 192.168.2.1 injoignable = Home Hub tombé (reboot)
}

export interface LinkStatus {
  online:        boolean;   // WAN joignable maintenant (point de vue « j'ai Internet »)
  gatewayUp:     boolean;   // Home Hub (passerelle) joignable maintenant
  wanUp:         boolean;   // Internet joignable maintenant
  checkedAt:     number;    // Unix ms — dernière sonde
  stateSinceMs:  number;    // ms passées dans l'état courant (online/offline)
  uptime24hPct:  number;    // % de disponibilité sur 24 h
  outages24h:    number;    // nombre de coupures sur 24 h
  lastOutage:    LinkOutage | null;
  recentOutages: LinkOutage[];   // dernières coupures (récent → ancien), coupure en cours incluse
}
