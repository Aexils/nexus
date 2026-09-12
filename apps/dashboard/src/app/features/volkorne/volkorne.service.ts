import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  VolkorneCatalog, VolkorneCheckpointResponse, VolkorneEnclos, VolkorneEnclosState,
  VolkorneRefillResponse, VolkorneStock, VolkorneYieldReport,
} from '@nexus/shared-types';

// Le microservice Volkorne expose son API sous /api ; on l'atteint via /volkorne-api,
// réécrit en /api (proxy dev → localhost:8000, HTTPRoute en prod).
// Le préfixe est DISTINCT de la route Angular /volkorne, sinon un refresh (Ctrl+R) sur
// la page serait capturé par la gateway et renvoyé au backend → 404. Même piège et même
// solution que pour Kestrel.
const BASE = '/volkorne-api';

@Injectable({ providedIn: 'root' })
export class VolkorneService {
  private readonly http = inject(HttpClient);

  enclos(): Observable<VolkorneEnclos[]> {
    return this.http.get<VolkorneEnclos[]>(`${BASE}/enclos`);
  }

  state(id: number): Observable<VolkorneEnclosState> {
    return this.http.get<VolkorneEnclosState>(`${BASE}/enclos/${id}/state`);
  }

  /** Les cinq paliers de carburant, avec leurs icônes du jeu. */
  catalog(): Observable<VolkorneCatalog> {
    return this.http.get<VolkorneCatalog>(`${BASE}/inventory/catalog`);
  }

  /** « Remplir à fond » : jusqu'au plafond du carburant (40 000 pour les cinq paliers). */
  refillToMax(id: number, fuel?: string): Observable<VolkorneRefillResponse> {
    return this.http.post<VolkorneRefillResponse>(
      `${BASE}/enclos/${id}/gauge/refill`, { to_max: true, fuel });
  }

  /** `fuel` est décisif : un Petit Extrait recharge 2 000, un Gigantesque 5 000. */
  refill(id: number, extracts: number, fuel?: string): Observable<VolkorneRefillResponse> {
    return this.http.post<VolkorneRefillResponse>(
      `${BASE}/enclos/${id}/gauge/refill`, { extracts, fuel });
  }

  /**
   * Relevé manuel de jauge. Le backend refuse une valeur invraisemblable face à sa
   * simulation ; `force` confirme un verdict `review` (l'utilisateur est devant l'écran),
   * mais ne peut jamais passer outre un `reject`.
   */
  checkpoint(id: number, value: number, force = false): Observable<VolkorneCheckpointResponse> {
    return this.http.post<VolkorneCheckpointResponse>(
      `${BASE}/enclos/${id}/gauge/checkpoint`, { value, force });
  }

  markReady(mountId: number): Observable<unknown> {
    return this.http.post(`${BASE}/mounts/${mountId}/status`, { status: 'ready' });
  }

  breakMount(mountId: number, runes: Record<string, number>): Observable<unknown> {
    return this.http.post(`${BASE}/mounts/${mountId}/break`, { runes });
  }

  /**
   * Suspend ou reprend la consommation. Le backend fige la jauge à sa valeur courante
   * et ne décompte JAMAIS le temps passé en pause à la reprise.
   */
  pause(id: number, paused: boolean): Observable<VolkorneEnclosState> {
    return this.http.post<VolkorneEnclosState>(
      `${BASE}/enclos/${id}/gauge/pause`, { paused });
  }

  /** `gaPaPrice` absent = pas de bloc rentabilité : on n'invente jamais un prix. */
  yieldReport(gaPaPrice?: number): Observable<VolkorneYieldReport> {
    const q = gaPaPrice ? `?ga_pa_price=${gaPaPrice}` : '';
    return this.http.get<VolkorneYieldReport>(`${BASE}/batches/reports/yield${q}`);
  }

  stock(itemId: number): Observable<VolkorneStock> {
    return this.http.get<VolkorneStock>(`${BASE}/inventory/stock/${itemId}`);
  }
}
