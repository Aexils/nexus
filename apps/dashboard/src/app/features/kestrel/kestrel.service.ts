import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  KestrelAlert, KestrelObservation, KestrelRule, KestrelSource,
  KestrelTarget, KestrelTargetCreate,
} from '@nexus/shared-types';

// Le microservice Kestrel expose son API sous /api ; on l'atteint via le préfixe /kestrel
// (réécrit par le proxy dev → localhost:8000, et par l'ingress en prod).
const BASE = '/kestrel';

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
