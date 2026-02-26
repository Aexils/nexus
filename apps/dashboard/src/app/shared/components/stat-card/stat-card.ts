import { Component, Input, ChangeDetectionStrategy } from '@angular/core';

@Component({
  selector: 'app-stat-card',
  standalone: true,
  imports: [],
  templateUrl: './stat-card.html',
  styleUrl: './stat-card.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatCard {
  @Input() label = '';
  @Input() value = '';
  @Input() change = '';
  /** CSS color value for the top accent bar, e.g. 'var(--accent)' */
  @Input() topAccent = 'var(--accent)';
  /** CSS class applied to the value element */
  @Input() valueColor: 'accent' | 'green' | 'orange' | 'kodi' | 'red' | '' = '';
}
