import {
  Directive, ElementRef, inject, input, effect, OnDestroy, NgZone,
  numberAttribute,
} from '@angular/core';

type CountUpFormat = 'number' | 'currency' | 'percent';

/**
 * Fait défiler un nombre jusqu'à sa nouvelle valeur.
 *
 *   <span [nxsCountUp]="totalMaison()" countUpFormat="currency"></span>
 *
 * On anime ici un vrai changement d'état — un total qui bouge parce que
 * l'utilisateur vient de reclasser une ligne — et jamais l'affichage initial
 * d'un chiffre figé : au premier rendu la valeur est écrite directement.
 *
 * Durée par défaut 420 ms, au-dessus des 150-300 ms du reste de l'interface :
 * en dessous de ~350 ms l'œil ne lit pas le défilement, il ne perçoit qu'un
 * scintillement. C'est l'exception assumée à l'échelle de durées.
 */
@Directive({
  selector: '[nxsCountUp]',
  standalone: true,
})
export class CountUpDirective implements OnDestroy {
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly zone = inject(NgZone);

  /** Seul alias conservé : il porte le nom du sélecteur, c'est la forme
   *  attendue pour une directive dont l'attribut transporte la valeur. */
  readonly value = input.required<number>({ alias: 'nxsCountUp' });

  // Les autres entrées portent directement leur nom public — un alias ici ne
  // ferait que masquer le nom réel de la propriété (@angular-eslint/no-input-rename).
  readonly countUpFormat = input<CountUpFormat>('number');

  // `numberAttribute` accepte aussi bien countUpDecimals="0" que [countUpDecimals]="0".
  readonly countUpDecimals = input(2,   { transform: numberAttribute });
  readonly countUpDuration = input(420, { transform: numberAttribute });

  private frame = 0;
  private current = 0;
  private primed = false;

  constructor() {
    effect(() => {
      const target = this.value();
      if (!Number.isFinite(target)) return;

      // Premier rendu : on écrit la valeur, sans animation.
      if (!this.primed) {
        this.primed = true;
        this.current = target;
        this.render(target);
        return;
      }

      if (target === this.current) return;
      this.animateTo(target);
    });
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.frame);
  }

  private animateTo(target: number): void {
    cancelAnimationFrame(this.frame);

    // Respecte le réglage système « réduire les animations ».
    if (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      this.current = target;
      this.render(target);
      return;
    }

    const from = this.current;
    const delta = target - from;
    const duration = this.countUpDuration();
    const start = performance.now();

    // Hors zone Angular : ~25 frames qui ne doivent déclencher aucune
    // détection de changement. Seul le textContent est touché.
    this.zone.runOutsideAngular(() => {
      const step = (now: number) => {
        const t = Math.min((now - start) / duration, 1);
        // easeOutCubic : démarre vite, se pose en douceur.
        const eased = 1 - Math.pow(1 - t, 3);
        this.current = from + delta * eased;
        this.render(this.current);

        if (t < 1) this.frame = requestAnimationFrame(step);
        else {
          this.current = target;
          this.render(target);
        }
      };
      this.frame = requestAnimationFrame(step);
    });
  }

  private render(n: number): void {
    this.host.nativeElement.textContent = this.formatValue(n);
  }

  private formatValue(n: number): string {
    switch (this.countUpFormat()) {
      case 'currency':
        return n.toLocaleString('fr-CA', {
          style: 'currency', currency: 'CAD',
          minimumFractionDigits: this.countUpDecimals(), maximumFractionDigits: this.countUpDecimals(),
        });
      case 'percent':
        return `${n.toLocaleString('fr-CA', {
          minimumFractionDigits: 0, maximumFractionDigits: 0,
        })} %`;
      default:
        return n.toLocaleString('fr-CA', {
          minimumFractionDigits: 0, maximumFractionDigits: this.countUpDecimals(),
        });
    }
  }
}
