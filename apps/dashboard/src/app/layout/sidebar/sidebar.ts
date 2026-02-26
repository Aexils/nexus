import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import {
  LucideAngularModule, LucideIconData,
  LayoutDashboard, MonitorPlay, Headphones, Gamepad2,
} from 'lucide-angular';
import { NexusService } from '../../core/services/nexus.service';

interface NavItem {
  label: string;
  route: string;
  icon: LucideIconData;
}

@Component({
  selector: 'nxs-sidebar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, LucideAngularModule],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SidebarComponent {
  private readonly nexus = inject(NexusService);

  get kodiRunning() { return this.nexus.kodiStatus().connected; }
  get absRunning()  { return this.nexus.absStatus().connected; }
  get psnRunning()  { return this.nexus.psnStatus().connected; }

  readonly navMain: NavItem[] = [
    { label: 'Dashboard', route: '/dashboard', icon: LayoutDashboard },
  ];

  readonly navApps: NavItem[] = [
    { label: 'Kodi',           route: '/kodi',           icon: MonitorPlay },
    { label: 'Audiobookshelf', route: '/audiobookshelf', icon: Headphones  },
    { label: 'PlayStation',    route: '/playstation',    icon: Gamepad2    },
  ];
}
