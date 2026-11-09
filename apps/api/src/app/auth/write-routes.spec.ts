import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { AggregatorController } from '../aggregator/aggregator.controller';
import { TraktController } from '../trakt/trakt.controller';
import { WriteGuard } from './write.guard';

// Inventaire des routes Bingie : toute écriture porte la garde (session, CSRF, Origin) ; toute
// lecture reste publique. Une route ajoutée sans garde fait échouer ce test.
const READS = new Set([RequestMethod.GET, RequestMethod.HEAD, RequestMethod.OPTIONS]);
/** POST sans effet (rien n'est enregistré) : lecture publique, déclarée ici explicitement. */
const READ_ONLY_POSTS = ['aggregator preview'];

function routes(controller: { prototype: object; name: string }) {
  const base = Reflect.getMetadata(PATH_METADATA, controller) as string;
  return Object.getOwnPropertyNames(controller.prototype)
    .map(name => (controller.prototype as Record<string, unknown>)[name])
    .filter((fn): fn is object => typeof fn === 'function' && Reflect.hasMetadata(METHOD_METADATA, fn))
    .map(fn => ({
      label: `${base} ${Reflect.getMetadata(PATH_METADATA, fn) as string}`,
      method: Reflect.getMetadata(METHOD_METADATA, fn) as RequestMethod,
      guarded: ((Reflect.getMetadata(GUARDS_METADATA, fn) ?? []) as unknown[]).includes(WriteGuard),
    }));
}

describe('routes d’écriture de Bingie', () => {
  const all = [...routes(TraktController), ...routes(AggregatorController)];

  it('toute écriture exige la session d’administration', () => {
    const writes = all.filter(r => !READS.has(r.method) && !READ_ONLY_POSTS.includes(r.label));
    expect(writes.filter(r => !r.guarded).map(r => r.label)).toEqual([]);
    expect(writes.length).toBe(19); // 18 Trakt + 1 Aggregator
  });

  it('les lectures et l’aperçu restent publics', () => {
    const reads = all.filter(r => READS.has(r.method) || READ_ONLY_POSTS.includes(r.label));
    expect(reads.filter(r => r.guarded).map(r => r.label)).toEqual([]);
    expect(reads.map(r => r.label)).toContain('aggregator preview');
    expect(reads.length).toBe(16); // 14 Trakt + préférences et aperçu Aggregator
  });
});
