// État publié par l'app sideloop (GET /api/status), consommé par Nexus.
// ⚠ snake_case : reflète TEL QUEL le JSON de l'API FastAPI (pas de mapping).
// Remplace l'ancien sideloadly-types.ts (produit Sideloadly Windows, retiré).

// Durée de vie du profil de provisioning (compte Apple gratuit) = 7 jours.
// Doit rester cohérent avec PROFILE_TTL_DAYS côté sideloop (Python).
export const PROFILE_TTL_SEC = 7 * 24 * 3600;

export type SideloopAppState = 'ok' | 'expiring' | 'expired' | 'never';

export interface SideloopDeviceStatus {
  udid: string;
  name: string;                     // DeviceName iOS (ex. "iPhone") ; "" si inconnu
  last_install_at: string | null;   // ISO
  last_ok: boolean | null;          // null = jamais tenté
  failures: number;
}

export interface SideloopAppStatus {
  name: string;
  bundle_id: string;
  original_bundle_id: string;
  last_signed: string | null;       // ISO
  expires_at: string | null;        // ISO (last_signed + 7 j)
  expires_in_sec: number | null;    // négatif = expiré
  status: SideloopAppState;
  last_error: string;
  installs: SideloopDeviceStatus[];  // état d'install par device pour CETTE app
}

export interface SideloopAccountStatus {
  apple_id: string;
  team_id: string;
  app_slots_used: number;
  app_slots_limit: number;          // compte gratuit : 3
}

export interface SideloopRunAppResult {
  name: string;
  bundle_id: string;
  ok: boolean;
  error: string;
}

export interface SideloopRunRecord {
  at: string;                       // ISO
  login_ok: boolean;
  results: SideloopRunAppResult[];
}

export interface SideloopStatus {
  generated_at: string;             // ISO
  account: SideloopAccountStatus;
  devices: SideloopDeviceStatus[];
  apps: SideloopAppStatus[];
  last_refresh_at: string | null;
  last_refresh_ok: boolean | null;
  recent_runs: SideloopRunRecord[];
  alerts: string[];

  // ── Ajouté par Nexus (santé du poll, absent de l'API sideloop) ──
  reachable: boolean;               // false si le dernier GET /api/status a échoué
}
