import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TopbarComponent } from './topbar/topbar';
import { SidebarComponent } from './sidebar/sidebar';
import { MetricsPanelComponent } from './metrics-panel/metrics-panel';
import { LayoutService } from './layout.service';
import { LucideAngularModule, ChevronLeft, ChevronRight } from 'lucide-angular';

@Component({
  selector: 'nxs-layout',
  standalone: true,
  imports: [RouterOutlet, TopbarComponent, SidebarComponent, MetricsPanelComponent, LucideAngularModule],
  templateUrl: './layout.html',
  styleUrl: './layout.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LayoutComponent {
  readonly layout = inject(LayoutService);
  readonly icons  = { ChevronLeft, ChevronRight };
}
