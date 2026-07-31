import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { LayoutService } from '../layout.service';
import {
  LucideAngularModule, LucideIconData,
  LayoutDashboard, User, Home, Database, Smartphone, Target, TrendingDown, Plane,
} from 'lucide-angular';

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
  readonly layout = inject(LayoutService);

  readonly navMain: NavItem[] = [
    { label: 'Dashboard',        route: '/dashboard', icon: LayoutDashboard },
    { label: 'Espace Alexis',    route: '/alexis',    icon: User            },
    { label: 'Espace Marion',    route: '/marion',    icon: User            },
    { label: 'Maison',           route: '/maison',    icon: Home            },
    { label: 'Sideloop',         route: '/sideloop',  icon: Smartphone      },
    { label: 'Versions',         route: '/versions',  icon: Target          },
    { label: 'Kestrel',          route: '/kestrel',   icon: TrendingDown    },
    { label: 'Entrée Express',   route: '/immigration', icon: Plane         },
  ];

  readonly navAdmin: NavItem[] = [
    { label: 'Admin DB', route: '/admin', icon: Database },
  ];
}
