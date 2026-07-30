import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

/**
 * Marque Kestrel — faucon en piqué (la silhouette pointe vers le bas = la baisse de prix).
 * `fill=currentColor` : la couleur suit le contexte (accent du thème via `color`).
 */
@Component({
  selector: 'app-kestrel-logo',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg [attr.width]="size" [attr.height]="size" viewBox="0 0 100 100"
         role="img" aria-label="Kestrel" style="display:block">
      <path fill="currentColor" d="M50 7 C54 11 56 17 57.5 23 L89 15 C83 24 74 31 63 39
        C60.5 43 58.5 51 57 61 L50 93 L43 61 C41.5 51 39.5 43 37 39
        C26 31 17 24 11 15 L42.5 23 C44 17 46 11 50 7 Z"/>
    </svg>
  `,
})
export class KestrelLogo {
  @Input() size = 40;
}
