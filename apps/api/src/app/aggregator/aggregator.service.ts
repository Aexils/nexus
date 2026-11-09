import { HttpException, Injectable, Logger } from '@nestjs/common';
import {
  AggregatorError,
  AggregatorPreferences,
  AggregatorPreferencesState,
  AggregatorPreview,
  AggregatorPreviewRequest,
} from '@nexus/shared-types';
import { KaggTransport, httpsTransport, kaggConfig } from './kagg-client';

export const KAGG_TRANSPORT = 'KAGG_TRANSPORT';

/** Relais fidèle vers kube-aggregator : aucune règle évaluée ici, aucun document journalisé. */
@Injectable()
export class AggregatorService {
  private readonly logger = new Logger(AggregatorService.name);
  private transport: KaggTransport | null | undefined;

  constructor(transport?: KaggTransport | null) {
    this.transport = transport;
  }

  private send(): KaggTransport {
    if (this.transport === undefined) {
      const config = kaggConfig();
      this.transport = config ? httpsTransport(config) : null;
    }
    if (!this.transport) throw this.failure(503, { status: 'unavailable', error: 'kube-aggregator non configuré' });
    return this.transport;
  }

  private failure(status: number, body: AggregatorError): HttpException {
    return new HttpException(body, status);
  }

  private async call<T>(method: 'GET' | 'PUT' | 'POST', path: string, body?: unknown): Promise<T> {
    let reply;
    try {
      reply = await this.send()(method, path, body);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.warn(`kube-aggregator injoignable (${(error as Error).message})`);
      throw this.failure(503, { status: 'unavailable', error: 'kube-aggregator injoignable' });
    }
    const data = (reply.body ?? {}) as Record<string, unknown>;
    if (reply.status === 200) return data as T;
    if (reply.status === 403) throw this.failure(403, { status: 'forbidden', error: 'Nexus n’est pas autorisé à écrire (certificat)' });
    if (reply.status === 409) throw this.failure(409, { status: 'conflict', version: Number(data['version']) });
    if (reply.status === 422) throw this.failure(422, { status: 'invalid', error: String(data['error'] ?? 'document invalide') });
    throw this.failure(503, { status: 'unavailable', error: `kube-aggregator : HTTP ${reply.status}` });
  }

  get(): Promise<AggregatorPreferencesState> {
    return this.call('GET', '/v1/preferences');
  }

  async save(version: number, preferences: AggregatorPreferences): Promise<AggregatorPreferencesState> {
    const state = await this.call<AggregatorPreferencesState>('PUT', '/v1/preferences', { version, preferences });
    this.logger.log(`préférences Aggregator enregistrées, version ${state.version}`);
    return state;
  }

  preview(request: AggregatorPreviewRequest): Promise<AggregatorPreview> {
    return this.call('POST', '/v1/preferences/preview', request);
  }
}
