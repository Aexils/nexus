import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TopbarComponent } from './topbar/topbar';
import { SidebarComponent } from './sidebar/sidebar';
import { MetricsPanelComponent } from './metrics-panel/metrics-panel';

@Component({
  selector: 'nxs-layout',
  standalone: true,
  imports: [RouterOutlet, TopbarComponent, SidebarComponent, MetricsPanelComponent],
  templateUrl: './layout.html',
  styleUrl: './layout.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LayoutComponent {}
