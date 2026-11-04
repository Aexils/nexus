import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { TraktSnapshotItem } from '@nexus/shared-types';

/** Zone de l'écran qu'un réglage touche : l'aperçu l'entoure quand on survole ce réglage. */
export type TvZone = 'spotlight' | 'menu' | 'row';

/** Couleur Kodi AARRGGBB vers CSS, avec un repli si le skin n'a rien enregistré. */
function css(value: unknown, fallback: string): string {
  const m = /^([0-9a-f]{2})([0-9a-f]{6})$/i.exec(String(value ?? ''));
  return m ? `#${m[2]}${m[1]}` : fallback;
}

/** Miniature de la télé : montre l'effet des réglages simulés avec les vraies images des rangées. */
@Component({
  selector: 'app-tv-preview',
  standalone: true,
  templateUrl: './tv-preview.html',
  styleUrl: './tv-preview.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TvPreview {
  readonly values = input.required<Record<string, unknown>>();
  readonly art = input<TraktSnapshotItem[]>([]);
  readonly zone = input<TvZone | null>(null);

  readonly hero = computed<TraktSnapshotItem | null>(() => this.art()[0] ?? null);
  readonly backdrop = computed(() => this.hero()?.art.fanart ?? null);
  readonly tiles = computed(() => this.art().slice(1, 7));

  readonly showSpotlight = computed(() => this.values()['DisableSpotlightContent'] !== true);
  readonly showMenu = computed(() => this.values()['DisableStaticSlimMenu'] !== true);
  readonly showLogo = computed(() => this.values()['NoClearLogoBingie'] !== true && !!this.hero()?.art.clearlogo);
  readonly showTrailer = computed(() => this.values()['SpotLightTrailers'] === true);
  readonly movingFrame = computed(() => this.values()['EnableFixedFrameWidgets'] !== true);
  readonly showWatched = computed(() => this.values()['WatchedIndicator.Watched'] === true);
  readonly showNew = computed(() => this.values()['EnableNewEpisodesIndicator'] === true);

  readonly vars = computed(() => {
    const v = this.values();
    return {
      '--tv-bg': css(v['BackgroundColor'], '#000000'),
      '--tv-icon': css(v['MainMenuButtonColor'], '#ffffff80'),
      '--tv-icon-on': css(v['MainMenuFocusButtonColor'], '#ffffff'),
      '--tv-line': css(v['LineUnderMenuIconsColor'], '#e50914'),
      '--tv-plot': css(v['BingieSpotlightPlotTextColor'], '#ffffff'),
      '--tv-label': css(v['BingieLabelTextColor'], '#ffffff'),
      '--tv-progress': css(v['BingieProgressBarColor'], '#e50914'),
      '--tv-track': css(v['BingieProgressBarBackgroundColor'], '#929699'),
      '--tv-frame': css(v['ViewDetailsBorderFocusColor'], '#ffffff'),
      '--tv-watched': css(v['WatchedIndicator.Watched.Color'], '#e50914e6'),
      '--tv-new': css(v['BingieNewEpisodesTagColor'], '#e50914'),
      '--tv-new-text': css(v['NewEpisodes.TextColor'], '#ffffff'),
    };
  });

  tileImage(item: TraktSnapshotItem): string | null {
    return item.art.landscape ?? item.art.fanart ?? item.art.poster ?? item.art.thumb ?? null;
  }
}
