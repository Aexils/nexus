import { Component, ChangeDetectionStrategy, inject, computed } from '@angular/core';

import { LucideAngularModule, Boxes, Puzzle, Hexagon, Server, CheckCircle2, ArrowUpCircle, Minus } from 'lucide-angular';
import { NexusService } from '../../core/services/nexus.service';
import { PageHeaderComponent } from '../../shared/page-header/page-header';
import { VersionCategory, VersionItem } from '@nexus/shared-types';

interface Section {
  key: VersionCategory;
  label: string;
  sub: string;
  icon: typeof Boxes;
  items: VersionItem[];
}

@Component({
  selector: 'app-versions-page',
  standalone: true,
  imports: [LucideAngularModule, PageHeaderComponent],
  templateUrl: './versions-page.html',
  styleUrl: './versions-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VersionsPage {
  readonly nexus = inject(NexusService);

  readonly icons = { CheckCircle2, ArrowUpCircle, Minus };

  readonly report = this.nexus.versions;

  private readonly META: Record<VersionCategory, { label: string; sub: string; icon: typeof Boxes }> = {
    application: { label: 'Applications', sub: 'les services que tu utilises', icon: Boxes },
    component:   { label: 'Composants',   sub: 'la plomberie du cluster',      icon: Puzzle },
    cluster:     { label: 'Cluster',      sub: 'Kubernetes & runtime',         icon: Hexagon },
    system:      { label: 'Système',      sub: 'hôte Proxmox & VMs',           icon: Server },
  };
  private readonly ORDER: VersionCategory[] = ['application', 'component', 'cluster', 'system'];

  readonly sections = computed<Section[]>(() => {
    const items = this.report()?.items ?? [];
    return this.ORDER.map(key => ({
      key,
      label: this.META[key].label,
      sub: this.META[key].sub,
      icon: this.META[key].icon,
      items: items.filter(i => i.category === key),
    })).filter(s => s.items.length > 0);
  });

  /** Nombre d'items avec une MAJ dispo (pour l'en-tête). */
  readonly outdatedCount = computed(() =>
    (this.report()?.items ?? []).filter(i => i.upToDate === false).length);

  state(i: VersionItem): 'ok' | 'update' | 'unknown' {
    return i.upToDate === true ? 'ok' : i.upToDate === false ? 'update' : 'unknown';
  }
}
