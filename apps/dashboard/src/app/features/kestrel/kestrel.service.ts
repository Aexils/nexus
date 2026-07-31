import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  KestrelAlert, KestrelObservation, KestrelRule, KestrelSource,
  KestrelTarget, KestrelTargetCreate,
} from '@nexus/shared-types';

// Le microservice Kestrel expose son API sous /api ; on l'atteint via le préfixe
// /kestrel/api — réécrit en /api (proxy dev → localhost:8000, HTTPRoute en prod).
// Le préfixe est distinct de la route SPA /kestrel pour éviter que le rechargement
// de la page (Ctrl+R) soit routé vers le backend au lieu du dashboard.
// Préfixe distinct de la route Angular /kestrel (sinon un refresh sur la page /kestrel
// serait capturé par la gateway et renvoyé au backend → 404). La gateway réécrit
// /kestrel-api → /api ; en dev, proxy.conf.json fait pareil.
const BASE = '/kestrel-api';

@Injectable({ providedIn: 'root' })
export class KestrelService {
  private readonly http = inject(HttpClient);

  sources(): Observable<KestrelSource[]> {
    return this.http.get<KestrelSource[]>(`${BASE}/sources`);
  }

  targets(): Observable<KestrelTarget[]> {
    return this.http.get<KestrelTarget[]>(`${BASE}/targets`);
  }

  createTarget(body: KestrelTargetCreate): Observable<KestrelTarget> {
    return this.http.post<KestrelTarget>(`${BASE}/targets`, body);
  }

  deleteTarget(id: number): Observable<unknown> {
    return this.http.delete(`${BASE}/targets/${id}`);
  }

  rules(targetId: number): Observable<KestrelRule[]> {
    return this.http.get<KestrelRule[]>(`${BASE}/targets/${targetId}/rules`);
  }

  createRule(targetId: number, body: { kind: string; config: Record<string, unknown> }): Observable<KestrelRule> {
    return this.http.post<KestrelRule>(`${BASE}/targets/${targetId}/rules`, body);
  }

  deleteRule(id: number): Observable<unknown> {
    return this.http.delete(`${BASE}/rules/${id}`);
  }

  observations(targetId: number, limit = 500): Observable<KestrelObservation[]> {
    return this.http.get<KestrelObservation[]>(`${BASE}/targets/${targetId}/observations`, {
      params: { limit },
    });
  }

  alerts(limit = 200): Observable<KestrelAlert[]> {
    return this.http.get<KestrelAlert[]>(`${BASE}/alerts`, { params: { limit } });
  }

  collect(targetId: number): Observable<unknown> {
    return this.http.post(`${BASE}/targets/${targetId}/collect`, {});
  }
}
