import { Component, Input, ChangeDetectionStrategy } from '@angular/core';

export type BadgeStatus = 'playing' | 'paused' | 'running' | 'stopped' | 'error' | 'starting';

@Component({
  selector: 'app-status-badge',
  standalone: true,
  imports: [],
  templateUrl: './status-badge.html',
  styleUrl: './status-badge.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatusBadge {
  @Input() status: BadgeStatus = 'stopped';

  get label(): string {
    const labels: Record<BadgeStatus, string> = {
      playing:  'En lecture',
      paused:   'En pause',
      running:  'En cours',
      stopped:  'Arrêté',
      error:    'Erreur',
      starting: 'Démarrage',
    };
    return labels[this.status] ?? this.status;
  }
}
