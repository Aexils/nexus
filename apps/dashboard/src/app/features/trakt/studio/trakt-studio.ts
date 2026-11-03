import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDragPlaceholder, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
import { firstValueFrom } from 'rxjs';

import { TraktList, TraktNewList, TraktPreview, TraktRowItem } from '@nexus/shared-types';

// Identifiants TMDb, mêmes valeurs que PROVIDERS côté kube-trakt.
const PROVIDERS = [
  { id: 8, name: 'Netflix' },
  { id: 119, name: 'Prime Video' },
  { id: 337, name: 'Disney+' },
  { id: 350, name: 'Apple TV' },
  { id: 230, name: 'Crave' },
  { id: 531, name: 'Paramount+' },
];

// Mots-clés anglais de TMDb, vérifiés un par un sur son API. `value` vide : le plus populaire.
const THEMES = [
  { value: '', label: 'Popular', fr: 'Populaire' },
  { value: 'halloween', label: 'Halloween', fr: 'Halloween' },
  { value: 'christmas', label: 'Christmas', fr: 'Noël' },
  { value: "valentine's day", label: "Valentine's", fr: 'Saint-Valentin' },
  { value: 'thanksgiving', label: 'Thanksgiving', fr: 'Action de grâce' },
  { value: 'zombie', label: 'Zombies', fr: 'Zombies' },
  { value: 'vampire', label: 'Vampires', fr: 'Vampires' },
  { value: 'witch', label: 'Witches', fr: 'Sorcières' },
  { value: 'superhero', label: 'Superheroes', fr: 'Super-héros' },
];

/** Écrans de Bingie : mêmes noms et même ordre que sur la télé. */
const SCREENS = [
  { id: 'home', name: 'Home', hasNextEpisodes: true, after: 'Les rangées de Bingie (tendances, populaires, classiques) suivent sur la télé.' },
  { id: 'new', name: 'New & Popular', hasNextEpisodes: false, after: 'Les rangées de nouveautés de Bingie suivent sur la télé.' },
  { id: 'shows', name: 'Shows', hasNextEpisodes: false, after: 'Les rangées de séries de Bingie suivent sur la télé.' },
  { id: 'movies', name: 'Movies', hasNextEpisodes: false, after: 'Les rangées de films de Bingie suivent sur la télé.' },
] as const;

type ScreenId = (typeof SCREENS)[number]['id'];

const NEXT_EPISODES = 'next_episodes';
const REFRESH_MS = 5000;
const SEARCH_DELAY_MS = 300;
const MESSAGE_MS = 6000;

/** Ce qu'on peut glisser sur la télé : une liste existante ou une liste à créer. */
type Droppable =
  | { kind: 'list'; list: TraktList }
  | { kind: 'suggestion'; name: string; source: NonNullable<TraktNewList['source']> };

/** Ce que montre la grande image en haut, quelle que soit l'origine du titre. */
interface Spotlight {
  title: string;
  subtitle: string | null;
  year: number | null;
  rating: number;
  runtime: number;
  genres: string[];
  plot: string;
  backdrop: string | null;
  logo: string | null;
}

function fromRow(item: TraktRowItem): Spotlight {
  return {
    title: item.kind === 'episode' ? (item.showtitle ?? item.title) : item.title,
    subtitle: item.kind === 'episode' ? `Saison ${item.season}, épisode ${item.episode} : ${item.title}` : null,
    year: item.year || null,
    rating: item.rating,
    runtime: item.runtime,
    genres: item.genres,
    plot: item.plot,
    backdrop: item.art.fanart ?? item.art.landscape ?? item.art.thumb ?? null,
    logo: item.art.clearlogo ?? null,
  };
}

function fromPreview(item: TraktPreview): Spotlight {
  return {
    title: item.title,
    subtitle: null,
    year: item.year,
    rating: item.rating,
    runtime: 0,
    genres: [],
    plot: item.plot,
    backdrop: item.backdrop ?? item.poster,
    logo: null,
  };
}

@Component({
  selector: 'app-trakt-studio',
  standalone: true,
  imports: [RouterLink, CdkDropList, CdkDrag, CdkDragHandle, CdkDragPlaceholder],
  templateUrl: './trakt-studio.html',
  styleUrl: './trakt-studio.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TraktStudio implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private refreshTimer?: ReturnType<typeof setInterval>;
  private searchTimer?: ReturnType<typeof setTimeout>;
  private messageTimer?: ReturnType<typeof setTimeout>;

  readonly screens = SCREENS;
  readonly screen = signal<ScreenId>('home');
  readonly screenInfo = computed(() => SCREENS.find(s => s.id === this.screen()) ?? SCREENS[0]);
  readonly providers = PROVIDERS;
  readonly themes = THEMES;

  readonly lists = signal<TraktList[]>([]);
  readonly homeIds = signal<number[]>([]);
  readonly homeSlots = signal(5);
  readonly rows = signal<Record<string, TraktRowItem[]>>({});
  readonly spotlight = signal<Spotlight | null>(null);

  readonly tab = signal<'mine' | 'discover'>('mine');
  readonly query = signal('');
  readonly results = signal<TraktPreview[] | null>(null);
  readonly searching = signal(false);

  readonly provider = signal(8);
  readonly theme = signal('');
  readonly preview = signal<TraktPreview[] | null>(null);

  readonly detail = signal<TraktList | null>(null);
  readonly confirmingDelete = signal(false);
  readonly newListName = signal('');
  readonly message = signal<string | null>(null);
  readonly failure = signal<string | null>(null);

  readonly next = computed(() => this.rows()[NEXT_EPISODES] ?? []);
  readonly homeLists = computed(() =>
    this.homeIds()
      .map(id => this.lists().find(l => l.ids.trakt === id))
      .filter((l): l is TraktList => !!l),
  );
  readonly libraryLists = computed(() => {
    const wanted = this.query().trim().toLocaleLowerCase();
    return this.lists().filter(l => !wanted || l.name.toLocaleLowerCase().includes(wanted));
  });
  readonly detailItems = computed(() => {
    const list = this.detail();
    return list ? this.itemsOf(list) : [];
  });
  readonly suggestion = computed<Droppable>(() => {
    const provider = PROVIDERS.find(p => p.id === this.provider());
    const theme = THEMES.find(t => t.value === this.theme());
    const name = `${theme?.label ?? ''} on ${provider?.name ?? ''}`.trim();
    const source: NonNullable<TraktNewList['source']> = { type: 'provider', provider: this.provider() };
    if (this.theme()) source.theme = this.theme();
    return { kind: 'suggestion', name, source };
  });
  readonly top10: Droppable = { kind: 'suggestion', name: 'Top 10 on Netflix', source: { type: 'netflix_top10' } };

  ngOnInit(): void {
    void this.refresh();
    void this.loadPreview();
    this.refreshTimer = setInterval(() => void this.refresh(), REFRESH_MS);
  }

  ngOnDestroy(): void {
    clearInterval(this.refreshTimer);
    clearTimeout(this.searchTimer);
    clearTimeout(this.messageTimer);
  }

  // --- Données ---

  private async refresh(): Promise<void> {
    try {
      const screen = this.screen();
      const [lists, home] = await Promise.all([
        firstValueFrom(this.http.get<TraktList[]>('/api/trakt/lists')),
        firstValueFrom(this.http.get<{ lists: number[]; slots: number }>(`/api/trakt/screens/${screen}`)),
      ]);
      this.lists.set(lists);
      // Une réponse pour l'écran qu'on vient de quitter ne doit pas remplacer le nouveau.
      if (screen === this.screen()) this.homeIds.set(home.lists);
      this.homeSlots.set(home.slots);
      const open = this.detail();
      if (open) this.detail.set(lists.find(l => l.ids.trakt === open.ids.trakt) ?? null);
      await this.loadRows(lists);
      this.failure.set(null);
    } catch {
      this.failure.set('Le suivi de visionnage ne répond pas. Les changements ne seront pas enregistrés.');
    }
  }

  private async loadRows(lists: TraktList[]): Promise<void> {
    const names = [NEXT_EPISODES, ...lists.map(l => `list_${l.ids.trakt}`)];
    const loaded = await Promise.all(
      names.map(async name => {
        try {
          return [name, await firstValueFrom(this.http.get<TraktRowItem[]>(`/api/trakt/rows/${name}`))] as const;
        } catch {
          // Une liste qui vient d'être créée n'a pas encore de rangée.
          return [name, this.rows()[name] ?? []] as const;
        }
      }),
    );
    this.rows.set(Object.fromEntries(loaded));
    if (!this.spotlight()) this.showFirstTitle();
  }

  /** La bannière montre le premier titre de l'écran, comme la télé à l'ouverture. */
  private showFirstTitle(): void {
    const first = this.screenInfo().hasNextEpisodes ? this.next()[0] : undefined;
    const item = first ?? this.homeLists().map(l => this.itemsOf(l)[0]).find(Boolean);
    this.spotlight.set(item ? fromRow(item) : null);
  }

  async goTo(screen: ScreenId): Promise<void> {
    if (screen === this.screen()) return;
    this.screen.set(screen);
    this.homeIds.set([]);
    this.spotlight.set(null);
    this.message.set(null);
    await this.refresh();
    this.showFirstTitle();
  }

  itemsOf(list: TraktList): TraktRowItem[] {
    return this.rows()[`list_${list.ids.trakt}`] ?? [];
  }

  isFilling(list: TraktList): boolean {
    return !!list.source && !list.source_status && !this.itemsOf(list).length;
  }

  focusSearch(input: HTMLInputElement): void {
    input.focus();
  }

  // --- Spotlight ---

  focusRow(item: TraktRowItem): void {
    this.spotlight.set(fromRow(item));
  }

  focusPreview(item: TraktPreview): void {
    this.spotlight.set(fromPreview(item));
  }

  tileImage(item: TraktRowItem): string | null {
    return item.art.thumb && item.kind === 'episode'
      ? item.art.thumb
      : (item.art.landscape ?? item.art.fanart ?? item.art.poster ?? null);
  }

  duration(seconds: number): string | null {
    if (!seconds) return null;
    const minutes = Math.round(seconds / 60);
    return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
  }

  // --- Accueil ---

  isOnHome(list: TraktList): boolean {
    return this.homeIds().includes(list.ids.trakt);
  }

  private async saveHome(ids: number[], message: string): Promise<void> {
    const previous = this.homeIds();
    this.homeIds.set(ids);
    try {
      await firstValueFrom(this.http.put(`/api/trakt/screens/${this.screen()}`, { lists: ids }));
      this.say(message);
    } catch {
      this.homeIds.set(previous);
      this.failure.set("Le changement n'a pas été enregistré. Réessaie dans un instant.");
    }
  }

  private say(message: string): void {
    this.failure.set(null);
    this.message.set(message);
    clearTimeout(this.messageTimer);
    this.messageTimer = setTimeout(() => this.message.set(null), MESSAGE_MS);
  }

  async drop(event: CdkDragDrop<unknown, unknown, unknown>): Promise<void> {
    if (event.previousContainer === event.container) {
      if (event.previousIndex === event.currentIndex) return;
      const ids = [...this.homeIds()];
      moveItemInArray(ids, event.previousIndex, event.currentIndex);
      await this.saveHome(ids, 'Nouvel ordre envoyé à la télé.');
      return;
    }
    await this.place(event.item.data as Droppable, event.currentIndex);
  }

  /** Place une liste sur la télé, en la créant d'abord si c'est une suggestion. */
  async place(entry: Droppable, index = this.homeIds().length): Promise<void> {
    if (entry.kind === 'list' && this.isOnHome(entry.list)) {
      this.say(`${entry.list.name} est déjà sur ${this.screenInfo().name}.`);
      return;
    }
    if (this.homeIds().length >= this.homeSlots()) {
      this.failure.set(`${this.screenInfo().name} affiche ${this.homeSlots()} listes au maximum. Retires-en une pour faire de la place.`);
      return;
    }
    try {
      const list = entry.kind === 'list' ? entry.list : await this.createFrom(entry);
      const ids = [...this.homeIds()];
      ids.splice(index, 0, list.ids.trakt);
      await this.saveHome(ids, `${list.name} arrive sur ${this.screenInfo().name} dans quelques secondes.`);
      await this.refresh();
    } catch {
      this.failure.set("La liste n'a pas pu être ajoutée. Réessaie dans un instant.");
    }
  }

  private async createFrom(entry: Extract<Droppable, { kind: 'suggestion' }>): Promise<TraktList> {
    const existing = this.lists().find(l => l.name === entry.name);
    if (existing) return existing;
    return firstValueFrom(this.http.post<TraktList>('/api/trakt/lists', { name: entry.name, source: entry.source }));
  }

  async removeFromHome(list: TraktList): Promise<void> {
    await this.saveHome(
      this.homeIds().filter(id => id !== list.ids.trakt),
      `${list.name} retirée de ${this.screenInfo().name}.`,
    );
  }

  async move(index: number, delta: number): Promise<void> {
    const target = index + delta;
    if (target < 0 || target >= this.homeIds().length) return;
    const ids = [...this.homeIds()];
    moveItemInArray(ids, index, target);
    await this.saveHome(ids, 'Nouvel ordre envoyé à la télé.');
  }

  // --- Bibliothèque ---

  /** Suit le nombre de titres : « 7 titres choisis à la main ». */
  /** Suit le nombre de titres : « 7 titres choisis à la main ». */
  describe(list: TraktList): string {
    const source = list.source;
    if (!source) return 'choisis à la main';
    if (source.type === 'netflix_top10') return 'du classement Netflix de la semaine';
    const provider = PROVIDERS.find(p => p.id === source.provider)?.name ?? 'la plateforme';
    const theme = THEMES.find(t => t.value === source.theme);
    return theme?.value ? `sur ${provider}, thème ${theme.fr}` : `parmi les plus populaires sur ${provider}`;
  }

  listFor(list: TraktList): Droppable {
    return { kind: 'list', list };
  }

  onQuery(value: string): void {
    this.query.set(value);
    clearTimeout(this.searchTimer);
    if (!value.trim()) {
      this.results.set(null);
      this.searching.set(false);
      return;
    }
    this.searching.set(true);
    this.searchTimer = setTimeout(() => void this.search(value.trim()), SEARCH_DELAY_MS);
  }

  private async search(query: string): Promise<void> {
    try {
      const found = await firstValueFrom(
        this.http.get<TraktPreview[]>('/api/trakt/titles', { params: { q: query } }),
      );
      if (this.query().trim() === query) this.results.set(found);
    } catch {
      this.failure.set('La recherche ne répond pas pour le moment.');
    } finally {
      this.searching.set(false);
    }
  }

  async choose(provider: number, theme: string): Promise<void> {
    this.provider.set(provider);
    this.theme.set(theme);
    await this.loadPreview();
  }

  private async loadPreview(): Promise<void> {
    const provider = this.provider();
    const theme = this.theme();
    this.preview.set(null);
    try {
      const found = await firstValueFrom(
        this.http.get<TraktPreview[]>('/api/trakt/sources/preview', {
          params: { provider, theme, kinds: 'movie,show' },
        }),
      );
      if (provider === this.provider() && theme === this.theme()) this.preview.set(found);
    } catch {
      this.preview.set([]);
    }
  }

  async createList(): Promise<void> {
    const name = this.newListName().trim();
    if (!name) return;
    try {
      const list = await firstValueFrom(this.http.post<TraktList>('/api/trakt/lists', { name }));
      this.newListName.set('');
      await this.refresh();
      this.detail.set(list);
      this.say(`${name} créée. Cherche des titres pour la remplir.`);
    } catch {
      this.failure.set("La liste n'a pas pu être créée.");
    }
  }

  // --- Fiche d'une liste ---

  open(list: TraktList): void {
    this.confirmingDelete.set(false);
    this.detail.set(list);
    const first = this.itemsOf(list)[0];
    if (first) this.focusRow(first);
  }

  close(): void {
    this.detail.set(null);
  }

  async addToDetail(title: TraktPreview): Promise<void> {
    const list = this.detail();
    if (!list) return;
    try {
      await firstValueFrom(this.http.post(`/api/trakt/lists/${list.ids.trakt}/titles`, title));
      this.say(`${title.title} ajouté à ${list.name}.`);
      await this.refresh();
    } catch {
      this.failure.set(`${title.title} n'a pas pu être ajouté.`);
    }
  }

  async removeFromDetail(item: TraktRowItem): Promise<void> {
    const list = this.detail();
    if (!list || item.kind === 'episode') return;
    try {
      await firstValueFrom(this.http.delete(`/api/trakt/lists/${list.ids.trakt}/items/${item.kind}/${item.tmdb}`));
      this.say(`${item.title} retiré de ${list.name}.`);
      await this.refresh();
    } catch {
      this.failure.set(`${item.title} n'a pas pu être retiré.`);
    }
  }

  isInDetail(title: TraktPreview): boolean {
    return this.detailItems().some(i => i.tmdb === title.tmdb && i.kind === title.kind);
  }

  async deleteDetail(): Promise<void> {
    const list = this.detail();
    if (!list) return;
    try {
      await firstValueFrom(this.http.delete(`/api/trakt/lists/${list.ids.trakt}`));
      this.detail.set(null);
      this.confirmingDelete.set(false);
      this.say(`${list.name} supprimée.`);
      await this.refresh();
    } catch {
      this.failure.set(`${list.name} n'a pas pu être supprimée.`);
    }
  }
}
