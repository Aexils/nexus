import { ChangeDetectionStrategy, Component, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { BINGIE_MODULES } from '../bingie-registry';
import { BingieSession } from '../bingie-session';
import { BingieUnsaved } from '../bingie-unsaved';

/** Cadre commun de Bingie : identité visuelle, navigation entre modules, session unique. */
@Component({
  selector: 'app-bingie-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './bingie-shell.html',
  styleUrl: './bingie-shell.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BingieShell implements OnInit {
  private readonly router = inject(Router);
  readonly session = inject(BingieSession);
  readonly unsaved = inject(BingieUnsaved);
  readonly modules = BINGIE_MODULES;
  readonly loginOpen = signal(false);
  readonly password = signal('');

  private readonly url = toSignal(
    this.router.events.pipe(filter(e => e instanceof NavigationEnd), map(() => this.router.url)),
    { initialValue: this.router.url },
  );
  readonly current = computed(() => {
    const segment = this.url().split('?')[0].split('/')[2] ?? '';
    return this.modules.find(m => m.path === segment) ?? null;
  });
  /** Panneau de connexion : demandé, ou ouvert par une écriture refusée. */
  readonly showLogin = computed(() => this.loginOpen() || this.session.loginNeeded());

  /** Fermeture ou rechargement avec un brouillon dans n'importe quel module : avertissement. */
  @HostListener('window:beforeunload', ['$event'])
  warnBeforeLeaving(event: BeforeUnloadEvent): void {
    if (this.unsaved.any()) event.preventDefault();
  }

  ngOnInit(): void {
    void this.session.refresh();
  }

  async login(): Promise<void> {
    if (await this.session.login(this.password())) {
      this.password.set('');
      this.loginOpen.set(false);
    }
  }

  closeLogin(): void {
    this.loginOpen.set(false);
    this.session.loginNeeded.set(false);
  }
}
