import {
  Component, inject, OnInit,
  ChangeDetectionStrategy, ChangeDetectorRef,
} from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { LucideAngularModule, Palette, Bell, Menu, Activity } from 'lucide-angular';
import { ThemeService, THEMES } from '../../core/services/theme';
import { LayoutService } from '../layout.service';

@Component({
  selector: 'nxs-topbar',
  standalone: true,
  imports: [CommonModule, DatePipe, LucideAngularModule],
  templateUrl: './topbar.html',
  styleUrl: './topbar.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TopbarComponent implements OnInit {
  protected themeService  = inject(ThemeService);
  protected layoutService = inject(LayoutService);
  protected themes = THEMES;
  protected themePickerOpen = false;
  protected currentTime = new Date();
  private cdr = inject(ChangeDetectorRef);

  readonly icons = { Palette, Bell, Menu, Activity };

  ngOnInit() {
    setInterval(() => {
      this.currentTime = new Date();
      this.cdr.markForCheck();
    }, 1000);
  }

  toggleThemePicker() { this.themePickerOpen = !this.themePickerOpen; }
  selectTheme(id: any) { this.themeService.setTheme(id); this.themePickerOpen = false; }
}
