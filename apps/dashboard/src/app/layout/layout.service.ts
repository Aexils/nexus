import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class LayoutService {
  readonly sidebarOpen      = signal(false);
  readonly sidebarCollapsed = signal(localStorage.getItem('nxs-sidebar-collapsed') === '1');
  readonly metricsCollapsed = signal(localStorage.getItem('nxs-metrics-collapsed') === '1');

  toggleSidebar(): void { this.sidebarOpen.update(v => !v); }
  closeSidebar():  void { this.sidebarOpen.set(false); }

  toggleSidebarCollapse(): void {
    this.sidebarCollapsed.update(v => !v);
    localStorage.setItem('nxs-sidebar-collapsed', this.sidebarCollapsed() ? '1' : '0');
  }

  toggleMetricsCollapse(): void {
    this.metricsCollapsed.update(v => !v);
    localStorage.setItem('nxs-metrics-collapsed', this.metricsCollapsed() ? '1' : '0');
  }
}
