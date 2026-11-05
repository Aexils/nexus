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

import {
  TraktChart,
  TraktCustomScreen,
  TraktCustomScreens,
  TraktList,
  TraktNavEntry,
  TraktNewList,
  TraktPreview,
  TraktProviderLogo,
  TraktRowItem,
  TraktScreenRow,
  TraktSnapshotItem,
} from '@nexus/shared-types';
import {
  BrandIcon,
  GENERAL_ICONS,
  SUGGESTED_BRANDS,
  brandSvg,
  brandUrl,
  fileToPng,
  generalSvg,
  iconForBrowser,
  loadBrands,
  svgToPng,
} from './logos';

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

const BRAND_RESULTS = 48;
const NEXT_EPISODES = 'next_episodes';
const REFRESH_MS = 5000;
const CHART_LABELS: Record<TraktChart, string> = {
  trending: 'parmi les tendances de la semaine',
  popular: 'parmi les plus populaires',
  favorited: 'parmi les mieux notés',
  watched: 'parmi les tendances du jour',
  streaming: 'parmi les nouveautés',
};

const SEARCH_DELAY_MS = 300;
const MESSAGE_MS = 6000;

/** Ce qu'on peut glisser sur la télé : une liste existante ou une liste à créer. */
type Droppable =
  | { kind: 'list'; list: TraktList }
  | { kind: 'suggestion'; name: string; source: NonNullable<TraktNewList['source']> }
  | { kind: 'next' }
  | { kind: 'addon'; title: string; path: string };

/** Une rangée telle qu'elle apparaît sur l'écran affiché. */
type Entry =
  | { kind: 'list'; list: TraktList }
  | { kind: 'next' }
  | { kind: 'addon'; title: string; path: string };

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
  private saving = false;
  private messageTimer?: ReturnType<typeof setTimeout>;

  readonly catalog = signal<{ title: string; path: string }[]>([]);
  readonly snapshots = signal<Record<string, TraktSnapshotItem[]>>({});
  readonly builtinScreens = signal<TraktCustomScreen[]>([]);
  readonly maxBuiltinRows = signal(15);
  readonly nextEntry: Droppable = { kind: 'next' };
  readonly screen = signal<string>('home');
  readonly nav = signal<TraktNavEntry[]>([]);
  readonly navVisible = computed(() => this.nav().filter(e => !e.hidden));
  readonly navHidden = computed(() => this.nav().filter(e => e.hidden));
  readonly editingEntry = signal<TraktNavEntry | null>(null);
  readonly customScreens = signal<TraktCustomScreen[]>([]);
  readonly maxScreens = signal(6);
  readonly maxRows = signal(10);
  readonly customScreen = computed(() => this.customScreens().find(s => s.id === this.screen()) ?? null);
  readonly currentScreen = computed(
    () => this.customScreen() ?? this.builtinScreens().find(s => s.id === this.screen()) ?? null,
  );
  readonly screenInfo = computed(() => ({ name: this.currentScreen()?.name ?? '' }));
  readonly iconForBrowser = iconForBrowser;

  // Fenêtre de création et de modification d'un écran.
  readonly editing = signal<'new' | 'edit' | null>(null);
  readonly draftName = signal('');
  readonly draftIcon = signal('');
  readonly logoTab = signal<'brands' | 'platforms' | 'general' | 'mine'>('brands');
  readonly logoQuery = signal('');
  readonly brands = signal<BrandIcon[]>([]);
  readonly platforms = signal<TraktProviderLogo[]>([]);
  readonly confirmingScreenDelete = signal(false);
  readonly generalIcons = GENERAL_ICONS;
  readonly brandUrl = brandUrl;
  readonly generalSvgUrl = (name: string) => {
    const icon = GENERAL_ICONS.find(i => i.name === name);
    return icon ? `data:image/svg+xml;utf8,${encodeURIComponent(generalSvg(icon.data))}` : '';
  };
  readonly brandResults = computed(() => {
    const wanted = this.logoQuery().trim().toLocaleLowerCase();
    if (wanted) return this.brands().filter(b => b.title.toLocaleLowerCase().includes(wanted)).slice(0, BRAND_RESULTS);
    return SUGGESTED_BRANDS.map(t => this.brands().find(b => b.title === t)).filter((b): b is BrandIcon => !!b);
  });
  readonly platformResults = computed(() => {
    const wanted = this.logoQuery().trim().toLocaleLowerCase();
    return this.platforms().filter(p => !wanted || p.name.toLocaleLowerCase().includes(wanted)).slice(0, BRAND_RESULTS);
  });
  readonly providers = PROVIDERS;
  readonly themes = THEMES;

  readonly lists = signal<TraktList[]>([]);
  readonly rows = signal<Record<string, TraktRowItem[]>>({});
  readonly spotlight = signal<Spotlight | null>(null);

  readonly tab = signal<'mine' | 'discover' | 'apps'>('mine');
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
  readonly entries = computed<Entry[]>(() =>
    (this.currentScreen()?.rows ?? []).flatMap((row): Entry[] => {
      if (row.kind !== 'list') return [row];
      const list = this.lists().find(l => l.ids.trakt === row.list);
      return list ? [{ kind: 'list', list }] : [];
    }),
  );
  readonly rowLimit = computed(() =>
    this.customScreen() ? this.maxRows() : (this.currentScreen()?.max_rows ?? this.maxBuiltinRows()),
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
      const [lists, custom, snapshots, nav] = await Promise.all([
        firstValueFrom(this.http.get<TraktList[]>('/api/trakt/lists')),
        firstValueFrom(this.http.get<TraktCustomScreens>('/api/trakt/custom-screens')),
        firstValueFrom(this.http.get<Record<string, TraktSnapshotItem[]>>('/api/trakt/row-snapshots')),
        firstValueFrom(this.http.get<TraktNavEntry[]>('/api/trakt/nav')),
      ]);
      this.lists.set(lists);
      // Un enregistrement en cours garde son affichage : le serveur n'a pas encore la nouvelle version.
      if (!this.saving) {
        this.customScreens.set(custom.screens);
        this.builtinScreens.set(custom.builtin);
        this.nav.set(nav);
      }
      this.maxScreens.set(custom.max_screens);
      this.maxRows.set(custom.max_rows);
      this.maxBuiltinRows.set(custom.max_builtin_rows);
      this.catalog.set(custom.catalog);
      this.snapshots.set(snapshots);
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
    const item = this.entries().map(e => this.entryItems(e)[0]).find(Boolean);
    this.spotlight.set(item ? fromRow(item) : null);
  }

  async goTo(screen: string): Promise<void> {
    if (screen === this.screen()) return;
    this.screen.set(screen);
    this.spotlight.set(null);
    this.message.set(null);
    this.showFirstTitle();
    await this.refresh();
  }

  entryItems(entry: Entry): TraktRowItem[] {
    if (entry.kind === 'next') return this.next();
    if (entry.kind === 'list') return this.itemsOf(entry.list);
    return (this.snapshots()[entry.path] ?? []).map((item, index) => ({
      kind: 'movie',
      label: item.label,
      title: item.title,
      plot: item.plot,
      runtime: item.runtime,
      rating: item.rating,
      year: item.year,
      genres: item.genres,
      tmdb: index,
      art: item.art,
    }));
  }

  hasSnapshot(entry: Entry): boolean {
    return entry.kind === 'addon' && entry.path in this.snapshots();
  }

  catalogFor(row: { title: string; path: string }): Droppable {
    return { kind: 'addon', title: row.title, path: row.path };
  }

  /** Nom court de l'addon qui fournit une rangée. */
  addonName(path: string): string {
    if (path.includes('plugin.video.youtube')) return 'YouTube';
    if (path.includes('themoviedb.helper')) return 'TMDb Helper';
    return path.replace('plugin://', '').split('/')[0].replace('plugin.video.', '');
  }

  entryTitle(entry: Entry): string {
    if (entry.kind === 'next') return 'Your Next Episodes';
    return entry.kind === 'list' ? entry.list.name : entry.title;
  }

  entryKey(entry: Entry): string {
    if (entry.kind === 'next') return 'next';
    return entry.kind === 'list' ? `list-${entry.list.ids.trakt}` : `addon-${entry.path}`;
  }

  /** Rend à Droppable ce qu'on déplace, pour que le glisser garde son type. */
  entryDroppable(entry: Entry): Droppable {
    return entry;
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
    return this.entries().some(e => e.kind === 'list' && e.list.ids.trakt === list.ids.trakt);
  }

  /** Enregistre les rangées de l'écran affiché : l'affichage change tout de suite. */
  private async saveEntries(entries: Entry[], message: string): Promise<void> {
    const screen = this.currentScreen();
    if (!screen) return;
    const rows: TraktScreenRow[] = entries.map(e => (e.kind === 'list' ? { kind: 'list', list: e.list.ids.trakt } : e));
    const apply = (list: TraktCustomScreen[]) => list.map(s => (s.id === screen.id ? { ...s, rows } : s));
    const custom = this.customScreens();
    const builtin = this.builtinScreens();
    this.customScreens.set(apply(custom));
    this.builtinScreens.set(apply(builtin));
    this.saving = true;
    try {
      await firstValueFrom(this.http.put(`/api/trakt/custom-screens/${screen.id}`, { rows }));
      this.say(message);
    } catch {
      this.customScreens.set(custom);
      this.builtinScreens.set(builtin);
      this.failure.set("Le changement n'a pas été enregistré. Réessaie dans un instant.");
    } finally {
      this.saving = false;
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
      const entries = [...this.entries()];
      moveItemInArray(entries, event.previousIndex, event.currentIndex);
      await this.saveEntries(entries, 'Nouvel ordre envoyé à la télé.');
      return;
    }
    await this.place(event.item.data as Droppable, event.currentIndex);
  }

  private already(entry: Droppable): boolean {
    if (entry.kind === 'list') return this.isOnHome(entry.list);
    if (entry.kind === 'next') return this.entries().some(e => e.kind === 'next');
    if (entry.kind === 'addon') return this.entries().some(e => e.kind === 'addon' && e.path === entry.path);
    return false;
  }

  /** Place une rangée sur l'écran affiché, en créant d'abord la liste si c'est une suggestion. */
  async place(entry: Droppable, index = this.entries().length): Promise<void> {
    const screen = this.screenInfo().name;
    if (this.already(entry)) {
      this.say(`Cette rangée est déjà sur ${screen}.`);
      return;
    }
    if (this.entries().length >= this.rowLimit()) {
      this.failure.set(`${screen} affiche ${this.rowLimit()} rangées au maximum. Retires-en une pour faire de la place.`);
      return;
    }
    try {
      const placed: Entry = entry.kind === 'suggestion' ? { kind: 'list', list: await this.createFrom(entry) } : entry;
      const entries = [...this.entries()];
      entries.splice(index, 0, placed);
      await this.saveEntries(entries, `${this.entryTitle(placed)} arrive sur ${screen} dans quelques secondes.`);
      await this.refresh();
    } catch {
      this.failure.set("La rangée n'a pas pu être ajoutée. Réessaie dans un instant.");
    }
  }

  private async createFrom(entry: Extract<Droppable, { kind: 'suggestion' }>): Promise<TraktList> {
    const existing = this.lists().find(l => l.name === entry.name);
    if (existing) return existing;
    return firstValueFrom(this.http.post<TraktList>('/api/trakt/lists', { name: entry.name, source: entry.source }));
  }

  async removeEntry(entry: Entry): Promise<void> {
    const key = this.entryKey(entry);
    await this.saveEntries(
      this.entries().filter(e => this.entryKey(e) !== key),
      `${this.entryTitle(entry)} retirée de ${this.screenInfo().name}.`,
    );
  }

  async removeFromHome(list: TraktList): Promise<void> {
    await this.removeEntry({ kind: 'list', list });
  }

  async move(index: number, delta: number): Promise<void> {
    const target = index + delta;
    if (target < 0 || target >= this.entries().length) return;
    const entries = [...this.entries()];
    moveItemInArray(entries, index, target);
    await this.saveEntries(entries, 'Nouvel ordre envoyé à la télé.');
  }

  async renameEntry(index: number): Promise<void> {
    const entry = this.entries()[index];
    if (entry?.kind !== 'addon') return;
    const title = window.prompt('Nom affiché sur la télé', entry.title)?.trim();
    if (!title || title === entry.title) return;
    const entries = [...this.entries()];
    entries[index] = { ...entry, title };
    await this.saveEntries(entries, `${title} envoyé à la télé.`);
  }

  // --- Écrans du rail ---

  openNewScreen(): void {
    this.editingEntry.set(null);
    if (this.customScreens().length >= this.maxScreens()) {
      this.failure.set(`La télé accepte ${this.maxScreens()} écrans créés au maximum. Supprimes-en un pour faire de la place.`);
      return;
    }
    this.draftName.set('');
    this.draftIcon.set('');
    this.openEditor('new');
  }

  openEditScreen(): void {
    const entry = this.nav().find(e => e.key === this.screen());
    if (entry) this.editEntry(entry);
  }

  editEntry(entry: TraktNavEntry): void {
    this.editingEntry.set(entry);
    this.draftName.set(entry.name);
    this.draftIcon.set(entry.icon);
    this.openEditor('edit');
  }

  /** Un clic ouvre l'écran ; une entrée sans rangées, comme la recherche, ouvre son réglage. */
  selectEntry(entry: TraktNavEntry): void {
    if (entry.has_rows) void this.goTo(entry.key);
    else this.editEntry(entry);
  }

  private async saveNav(entries: TraktNavEntry[], message: string): Promise<void> {
    const previous = this.nav();
    this.nav.set(entries);
    this.saving = true;
    try {
      const saved = await firstValueFrom(
        this.http.put<TraktNavEntry[]>('/api/trakt/nav', {
          entries: entries.map(e => ({
            key: e.key,
            hidden: e.hidden,
            name: e.builtin ? e.name : '',
            icon: e.builtin ? e.icon : '',
          })),
        }),
      );
      this.nav.set(saved);
      this.say(message);
    } catch {
      this.nav.set(previous);
      this.failure.set("Le menu n'a pas été enregistré. Réessaie dans un instant.");
    } finally {
      this.saving = false;
    }
  }

  async setHidden(entry: TraktNavEntry, hidden: boolean): Promise<void> {
    this.editing.set(null);
    await this.saveNav(
      this.nav().map(e => (e.key === entry.key ? { ...e, hidden } : e)),
      hidden ? `${entry.name} retiré du menu de la télé.` : `${entry.name} de retour dans le menu de la télé.`,
    );
    if (hidden && this.screen() === entry.key) await this.goTo('home');
  }

  private openEditor(mode: 'new' | 'edit'): void {
    this.logoQuery.set('');
    this.logoTab.set('brands');
    this.confirmingScreenDelete.set(false);
    this.editing.set(mode);
    void this.loadLogos();
  }

  private async loadLogos(): Promise<void> {
    try {
      if (!this.brands().length) this.brands.set(await loadBrands());
      if (!this.platforms().length) {
        this.platforms.set(await firstValueFrom(this.http.get<TraktProviderLogo[]>('/api/trakt/provider-logos')));
      }
    } catch {
      this.failure.set('La librairie de logos ne répond pas. Tu peux importer ton image.');
    }
  }

  private async upload(png: string): Promise<void> {
    const { url } = await firstValueFrom(this.http.post<{ url: string }>('/api/trakt/icons', { png }));
    this.draftIcon.set(url);
  }

  async chooseBrand(brand: BrandIcon): Promise<void> {
    try {
      await this.upload(await svgToPng(await brandSvg(brand.slug)));
    } catch {
      this.failure.set(`Le logo ${brand.title} n'a pas pu être préparé.`);
    }
  }

  async chooseGeneral(name: string): Promise<void> {
    const icon = GENERAL_ICONS.find(i => i.name === name);
    if (!icon) return;
    try {
      await this.upload(await svgToPng(generalSvg(icon.data)));
    } catch {
      this.failure.set("L'icône n'a pas pu être préparée.");
    }
  }

  choosePlatform(logo: TraktProviderLogo): void {
    this.draftIcon.set(logo.logo);
  }

  async chooseFile(file: File | undefined): Promise<void> {
    if (!file) return;
    try {
      await this.upload(await fileToPng(file));
    } catch {
      this.failure.set("Cette image n'a pas pu être lue. Essaie un PNG ou un JPEG.");
    }
  }

  async saveScreen(): Promise<void> {
    const name = this.draftName().trim();
    if (!name) return;
    const body = { name, icon: this.draftIcon() };
    try {
      if (this.editing() === 'new') {
        const created = await firstValueFrom(this.http.post<TraktCustomScreen>('/api/trakt/custom-screens', body));
        this.editing.set(null);
        await this.refresh();
        await this.goTo(created.id);
        this.say(`${name} ajouté au menu de la télé. Glisse des rangées pour le remplir.`);
      } else {
        const entry = this.editingEntry();
        if (entry && !entry.builtin) {
          await firstValueFrom(this.http.put(`/api/trakt/custom-screens/${entry.key}`, body));
        } else if (entry) {
          const entries = this.nav().map(e => (e.key === entry.key ? { ...e, name, icon: this.draftIcon() } : e));
          await this.saveNav(entries, `${name} mis à jour.`);
        }
        this.editing.set(null);
        await this.refresh();
        this.say(`${name} mis à jour.`);
      }
    } catch {
      this.failure.set("L'écran n'a pas pu être enregistré.");
    }
  }

  async deleteScreen(): Promise<void> {
    const entry = this.editingEntry();
    if (!entry || entry.builtin) return;
    try {
      await firstValueFrom(this.http.delete(`/api/trakt/custom-screens/${entry.key}`));
      this.editing.set(null);
      if (this.screen() === entry.key) await this.goTo('home');
      await this.refresh();
      this.say(`${entry.name} retiré du menu de la télé. Tes listes sont conservées.`);
    } catch {
      this.failure.set(`${entry.name} n'a pas pu être supprimé.`);
    }
  }

  async dropScreen(event: CdkDragDrop<unknown, unknown, unknown>): Promise<void> {
    if (event.previousIndex === event.currentIndex) return;
    const visible = [...this.navVisible()];
    moveItemInArray(visible, event.previousIndex, event.currentIndex);
    await this.saveNav([...visible, ...this.navHidden()], 'Nouvel ordre du menu envoyé à la télé.');
  }

  // --- Bibliothèque ---

  /** Suit le nombre de titres : « 7 titres choisis à la main ». */
  /** Suit le nombre de titres : « 7 titres choisis à la main ». */
  describe(list: TraktList): string {
    const source = list.source;
    if (!source) return 'choisis à la main';
    if (source.type === 'netflix_top10') return 'du classement Netflix de la semaine';
    if (source.type === 'chart') return CHART_LABELS[source.chart];
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
