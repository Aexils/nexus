import {
  Directive, ElementRef, OnInit, OnDestroy, inject, input,
  booleanAttribute, numberAttribute,
} from '@angular/core';
import autoAnimate, { AutoAnimateOptions, AnimationController } from '@formkit/auto-animate';

/**
 * Anime les ajouts, suppressions et réordonnancements des enfants directs.
 *
 *   <tbody nxsAutoAnimate>  …  </tbody>
 *   <div class="batch-strip" nxsAutoAnimate>  …  </div>
 *
 * C'est le seul endroit du projet qui parle à @formkit/auto-animate : si on
 * change un jour de librairie, il n'y a que ce fichier à toucher.
 *
 * Les durées reprennent les jetons de `styles.scss` (--t = 240 ms) pour que le
 * mouvement des listes soit cohérent avec le reste de l'interface.
 *
 * auto-animate respecte `prefers-reduced-motion` de lui-même (son option
 * `disrespectUserMotionPreference` vaut false par défaut) — on ne la touche pas.
 */
@Directive({
  selector: '[nxsAutoAnimate]',
  standalone: true,
})
export class AutoAnimateDirective implements OnInit, OnDestroy {
  private readonly host = inject(ElementRef<HTMLElement>);

  /** Durée en millisecondes. Par défaut alignée sur --t. */
  readonly duration = input(240, {
    alias: 'nxsAutoAnimateDuration', transform: numberAttribute,
  });

  /**
   * Mettre à false pour désactiver ponctuellement sans retirer la directive.
   * `booleanAttribute` fait que l'attribut nu `nxsAutoAnimate` (donc chaîne
   * vide) vaut `true`, comme un attribut HTML booléen ordinaire.
   */
  readonly enabled = input(true, {
    alias: 'nxsAutoAnimate', transform: booleanAttribute,
  });

  private controller?: AnimationController;

  ngOnInit(): void {
    const options: Partial<AutoAnimateOptions> = {
      duration: this.duration(),
      easing: 'cubic-bezier(0.4, 0, 0.2, 1)',   // = var(--ease)
    };

    this.controller = autoAnimate(this.host.nativeElement, options);
    if (!this.enabled()) this.controller.disable();
  }

  ngOnDestroy(): void {
    // auto-animate s'accroche à un MutationObserver : on le libère avec la vue.
    this.controller?.disable();
  }
}
