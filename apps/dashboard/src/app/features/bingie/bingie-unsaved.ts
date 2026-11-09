import { Injectable, computed, signal } from '@angular/core';

/** Modifications non enregistrées, par module (clé = chemin du registre). Générique : tout module
 *  futur peut s'y déclarer ; le cadre affiche une pastille sur l'onglet et avertit avant de quitter. */
@Injectable({ providedIn: 'root' })
export class BingieUnsaved {
  private readonly modules = signal<Record<string, boolean>>({});
  readonly any = computed(() => Object.values(this.modules()).some(Boolean));

  set(path: string, dirty: boolean): void {
    if ((this.modules()[path] ?? false) !== dirty) this.modules.update(m => ({ ...m, [path]: dirty }));
  }

  has(path: string): boolean {
    return this.modules()[path] ?? false;
  }
}
