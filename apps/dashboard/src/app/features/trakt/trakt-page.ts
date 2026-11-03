import { Component, ChangeDetectionStrategy, OnInit, inject, computed, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { NexusService } from '../../core/services/nexus.service';
import { PageHeaderComponent } from '../../shared/page-header/page-header';
import { TraktDevice, TraktList, TraktMediaKind, TraktNewList, TraktTitle } from '@nexus/shared-types';

// Sans ces jetons, Nexus perdrait son accès ou les sauvegardes s'arrêteraient.
const PROTECTED_DEVICES = ['nexus', 'sauvegarde-rpi5'];

// Identifiants TMDb, mêmes valeurs que PROVIDERS côté kube-trakt.
const PROVIDERS = [
  { id: 8, name: 'Netflix' },
  { id: 119, name: 'Prime Video' },
  { id: 337, name: 'Disney+' },
  { id: 350, name: 'Apple TV' },
  { id: 230, name: 'Crave' },
  { id: 531, name: 'Paramount+' },
];

// Mots-clés anglais de TMDb, vérifiés un par un sur son API.
const THEMES = [
  { value: 'halloween', label: 'Halloween' },
  { value: 'christmas', label: 'Noël' },
  { value: "valentine's day", label: 'Saint-Valentin' },
  { value: 'thanksgiving', label: 'Action de grâce' },
  { value: 'zombie', label: 'Zombies' },
  { value: 'vampire', label: 'Vampires' },
  { value: 'witch', label: 'Sorcières' },
  { value: 'superhero', label: 'Super-héros' },
];

type NewListType = 'manual' | 'provider' | 'netflix_top10';

@Component({
  selector: 'app-trakt-page',
  standalone: true,
  imports: [PageHeaderComponent],
  templateUrl: './trakt-page.html',
  styleUrl: './trakt-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TraktPage implements OnInit {
  private readonly http = inject(HttpClient);
  readonly nexus = inject(NexusService);
  readonly status = this.nexus.trakt;

  readonly reachable = computed(() => this.status()?.reachable ?? false);
  readonly alerts    = computed(() => this.status()?.alerts ?? []);
  readonly devices   = computed(() => this.status()?.devices ?? []);
  readonly missing   = computed(() => this.status()?.missing_routes ?? []);
  readonly confirming = signal<string | null>(null);
  readonly error      = signal<string | null>(null);

  readonly jellyfin  = computed(() => this.status()?.jellyfin ?? null);
  readonly loopShows = computed(() => this.status()?.loop_shows ?? []);
  readonly isLoop    = (slug: string) => this.loopShows().some(s => s.slug === slug);

  readonly providers = PROVIDERS;
  readonly themes = THEMES;

  readonly lists = signal<TraktList[]>([]);
  readonly openList = signal<TraktList | null>(null);
  readonly items = signal<TraktTitle[]>([]);
  readonly confirmingList = signal<number | null>(null);

  readonly newType = signal<NewListType>('manual');
  readonly newName = signal('');
  readonly newProvider = signal(8);
  readonly newKinds = signal<'both' | TraktMediaKind>('both');
  readonly newTheme = signal('');

  readonly query = signal('');
  readonly results = signal<TraktTitle[] | null>(null);
  readonly hidden = signal<TraktTitle[]>([]);
  readonly isHidden = (tmdb: number) => this.hidden().some(s => s.tmdb === tmdb);

  ngOnInit(): void {
    void this.loadLists();
    void this.loadHidden();
  }

  // --- Listes ---

  sourceLabel(list: TraktList): string {
    const source = list.source;
    if (!source) return 'Liste manuelle';
    if (source.type === 'netflix_top10') return `Top 10 Netflix · ${source.country}`;
    const provider = PROVIDERS.find(p => p.id === source.provider)?.name ?? `Plateforme ${source.provider}`;
    const theme = THEMES.find(t => t.value === source.theme)?.label ?? source.theme;
    return [provider, source.country, theme].filter(Boolean).join(' · ');
  }

  async loadLists(): Promise<void> {
    await this.attempt('Listes indisponibles', async () => {
      this.lists.set(await firstValueFrom(this.http.get<TraktList[]>('/api/trakt/lists')));
    });
  }

  async createList(): Promise<void> {
    const name = this.newName().trim();
    if (!name) return;
    const body: TraktNewList = { name };
    const type = this.newType();
    if (type !== 'manual') {
      const kinds = this.newKinds();
      body.source = { type, kinds: kinds === 'both' ? ['movie', 'show'] : [kinds] };
      if (type === 'provider') {
        body.source.provider = this.newProvider();
        if (this.newTheme()) body.source.theme = this.newTheme();
      }
    }
    await this.attempt(`Impossible de créer ${name}`, async () => {
      await firstValueFrom(this.http.post('/api/trakt/lists', body));
      this.newName.set('');
      await this.loadLists();
    });
  }

  async deleteList(list: TraktList): Promise<void> {
    await this.attempt(`Impossible de supprimer ${list.name}`, async () => {
      await firstValueFrom(this.http.delete(`/api/trakt/lists/${list.ids.trakt}`));
      this.confirmingList.set(null);
      if (this.openList()?.ids.trakt === list.ids.trakt) this.openList.set(null);
      await this.loadLists();
    });
  }

  async toggleList(list: TraktList): Promise<void> {
    if (this.openList()?.ids.trakt === list.ids.trakt) {
      this.openList.set(null);
      return;
    }
    this.openList.set(list);
    this.items.set([]);
    await this.loadItems(list);
  }

  private async loadItems(list: TraktList): Promise<void> {
    await this.attempt(`Impossible de lire ${list.name}`, async () => {
      this.items.set(await firstValueFrom(this.http.get<TraktTitle[]>(`/api/trakt/lists/${list.ids.trakt}/items`)));
    });
  }

  /** Une liste automatique est réécrite à chaque rafraîchissement : on n'y ajoute rien à la main. */
  canEditOpenList(): boolean {
    const list = this.openList();
    return !!list && !list.source;
  }

  async addToOpenList(title: TraktTitle): Promise<void> {
    const list = this.openList();
    if (!list) return;
    await this.attempt(`Impossible d'ajouter ${title.title}`, async () => {
      await firstValueFrom(this.http.post(`/api/trakt/lists/${list.ids.trakt}/items/${title.kind}/${title.tmdb}`, {}));
      await Promise.all([this.loadItems(list), this.loadLists()]);
    });
  }

  async removeFromOpenList(title: TraktTitle): Promise<void> {
    const list = this.openList();
    if (!list) return;
    await this.attempt(`Impossible de retirer ${title.title}`, async () => {
      await firstValueFrom(this.http.delete(`/api/trakt/lists/${list.ids.trakt}/items/${title.kind}/${title.tmdb}`));
      await Promise.all([this.loadItems(list), this.loadLists()]);
    });
  }

  // --- Recherche, boucle, masquage ---

  async search(): Promise<void> {
    const query = this.query().trim();
    if (!query) return;
    await this.attempt('Recherche impossible', async () => {
      const params = { q: query };
      this.results.set(await firstValueFrom(this.http.get<TraktTitle[]>('/api/trakt/search', { params })));
    });
  }

  async setLoop(slug: string, loop: boolean): Promise<void> {
    const url = `/api/trakt/shows/${encodeURIComponent(slug)}/loop`;
    await this.attempt('Mode boucle impossible à changer', async () => {
      await firstValueFrom(loop ? this.http.put(url, {}) : this.http.delete(url));
    });
  }

  private async loadHidden(): Promise<void> {
    await this.attempt('Séries masquées indisponibles', async () => {
      this.hidden.set(await firstValueFrom(this.http.get<TraktTitle[]>('/api/trakt/hidden')));
    });
  }

  async setHidden(tmdb: number, hide: boolean): Promise<void> {
    await this.attempt('Masquage impossible à changer', async () => {
      const url = `/api/trakt/hidden/${tmdb}`;
      await firstValueFrom(hide ? this.http.put(url, {}) : this.http.delete(url));
      await this.loadHidden();
    });
  }

  private async attempt(message: string, action: () => Promise<void>): Promise<void> {
    this.error.set(null);
    try {
      await action();
    } catch {
      this.error.set(message);
    }
  }

  isProtected(device: TraktDevice): boolean {
    return PROTECTED_DEVICES.includes(device.device);
  }

  async revoke(device: string): Promise<void> {
    this.error.set(null);
    try {
      await firstValueFrom(this.http.delete(`/api/trakt/devices/${encodeURIComponent(device)}`));
      this.confirming.set(null);
    } catch {
      this.error.set(`Impossible de révoquer ${device}`);
    }
  }

  /** "à l'instant" / "12 min" / "3 h" / "2 j". */
  ago(iso: string | null): string {
    if (!iso) return 'jamais';
    const sec = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
    if (sec < 60) return 'à l\'instant';
    if (sec < 3600) return `il y a ${Math.floor(sec / 60)} min`;
    if (sec < 86400) return `il y a ${Math.floor(sec / 3600)} h`;
    return `il y a ${Math.floor(sec / 86400)} j`;
  }
}
