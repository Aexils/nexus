import { Component, Input, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { LucideAngularModule, ChevronLeft, LucideIconData } from 'lucide-angular';

/**
 * En-tête « hero » unifié pour toutes les pages.
 *
 *   <nxs-page-header icon="..." title="Maison" subtitle="Suivi des dépenses">
 *     <!-- actions projetées à droite -->
 *   </nxs-page-header>
 *
 * - `icon`     : icône lucide (tuile teintée à l'accent)
 * - `avatar`   : initiale dans une pastille (alternative à l'icône)
 * - `back`     : routerLink d'un bouton retour
 * - `title` + `accent` : "title <span>accent</span>" (accent coloré)
 * - `subtitle` : ligne secondaire
 */
@Component({
  selector: 'nxs-page-header',
  standalone: true,
  imports: [CommonModule, RouterModule, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="ph">
      <div class="ph__left">
        @if (back) {
          <a class="ph__back" [routerLink]="back" aria-label="Retour">
            <lucide-icon [img]="chevronLeft" [size]="16"></lucide-icon>
          </a>
        }
        @if (avatar) {
          <div class="ph__avatar" [class]="avatarClass">{{ avatar }}</div>
        } @else if (icon) {
          <div class="ph__icon">
            <lucide-icon [img]="icon" [size]="20"></lucide-icon>
          </div>
        }
        <div class="ph__titles">
          <h1 class="ph__title">{{ title }}@if (accent) {<span> {{ accent }}</span>}</h1>
          @if (subtitle) { <p class="ph__sub">{{ subtitle }}</p> }
        </div>
      </div>
      <div class="ph__actions"><ng-content></ng-content></div>
    </header>
  `,
  styles: [`
    .ph {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      margin-bottom: 1.75rem;
      flex-wrap: wrap;
      animation: nxsFadeUp 0.4s var(--ease, ease) both;
    }
    .ph__left { display: flex; align-items: center; gap: 0.9rem; min-width: 0; }

    .ph__back {
      display: flex; align-items: center; justify-content: center;
      width: 34px; height: 34px; flex-shrink: 0;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border);
      color: var(--text2);
      transition: all var(--t-fast);
    }
    .ph__back:hover { color: var(--text); border-color: var(--border2); background: color-mix(in srgb, var(--text) 4%, transparent); }

    .ph__icon {
      display: flex; align-items: center; justify-content: center;
      width: 42px; height: 42px; flex-shrink: 0;
      border-radius: var(--radius);
      color: var(--accent);
      background: color-mix(in srgb, var(--accent) 14%, transparent);
      border: 1px solid color-mix(in srgb, var(--accent) 22%, transparent);
    }

    .ph__avatar {
      display: flex; align-items: center; justify-content: center;
      width: 42px; height: 42px; flex-shrink: 0;
      border-radius: var(--radius-full);
      font-weight: 700; font-size: 1rem; color: #fff;
      background: linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 60%, #000));
      box-shadow: var(--shadow-sm);
    }
    .ph__avatar.avatar-alexis { background: linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 55%, #000)); }
    .ph__avatar.avatar-marion { background: linear-gradient(135deg, var(--accent2, var(--accent)), color-mix(in srgb, var(--accent2, var(--accent)) 55%, #000)); }

    .ph__titles { min-width: 0; }
    .ph__title {
      font-family: var(--font-display);
      font-weight: 800;
      font-size: 1.6rem;
      line-height: 1.1;
      letter-spacing: -0.02em;
      color: var(--text);
    }
    .ph__title span { color: var(--accent); }
    .ph__sub {
      margin-top: 0.2rem;
      font-size: 0.82rem;
      color: var(--text2);
    }

    .ph__actions { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; }

    @media (max-width: 640px) {
      .ph__title { font-size: 1.35rem; }
    }
  `],
})
export class PageHeaderComponent {
  @Input() icon: LucideIconData | null = null;
  @Input() avatar: string | null = null;
  @Input() avatarClass = '';
  @Input() back: string | null = null;
  @Input() title = '';
  @Input() accent: string | null = null;
  @Input() subtitle: string | null = null;

  protected readonly chevronLeft = ChevronLeft;
}
