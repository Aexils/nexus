import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { LayoutService } from '../layout.service';
import {
  LucideAngularModule, LucideIconData,
  LayoutDashboard, MonitorPlay, Headphones, Gamepad2, Smartphone, HardDrive, User, Tv2, Home, Database, BookOpen,
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
  readonly layout = inject(LayoutService);

  get kodiRunning() { return this.nexus.kodiStatus().connected; }
  get absRunning()  {
    const map = this.nexus.absStatusMap();
    return map.alexis.connected || map.marion.connected;
  }
  get psnRunning()  {
    const map = this.nexus.psnStatusMap();
    return map.alexis.profile?.presence === 'ingame' || map.marion.profile?.presence === 'ingame';
  }
  get sdlyRunning()      { return this.nexus.sideloadlyStatus().connected; }
  get urbRunning()       { return this.nexus.urbackupStatus().connected; }
  get jellyfinRunning()  { return this.nexus.jellyfinStatus().connected; }
  get bookloreRunning()  {
    const map = this.nexus.bookloreStatusMap();
    return map.alexis.connected || map.marion.connected;
  }

  readonly navMain: NavItem[] = [
    { label: 'Dashboard',        route: '/dashboard', icon: LayoutDashboard },
    { label: 'Espace Alexis',    route: '/alexis',    icon: User            },
    { label: 'Espace Marion',    route: '/marion',    icon: User            },
    { label: 'Maison',           route: '/maison',    icon: Home            },
  ];

  readonly navAdmin: NavItem[] = [
    { label: 'Admin DB', route: '/admin', icon: Database },
  ];

  readonly navApps: NavItem[] = [
    { label: 'Kodi',           route: '/kodi',           icon: MonitorPlay },
    { label: 'Audiobookshelf', route: '/audiobookshelf', icon: Headphones  },
    { label: 'Booklore',       route: '/booklore',       icon: BookOpen    },
    { label: 'Jellyfin',       route: '/jellyfin',       icon: Tv2         },
    { label: 'PlayStation',    route: '/playstation',    icon: Gamepad2    },
    { label: 'Sideloadly',     route: '/sideloadly',     icon: Smartphone  },
    { label: 'UrBackup',       route: '/urbackup',       icon: HardDrive   },
  ];
}
