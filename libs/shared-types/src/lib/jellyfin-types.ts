export interface JellyfinLibraryItem {
  id:               string;
  name:             string;
  type:             'Movie' | 'Series' | string;
  year?:            number;
  genres?:          string[];
  overview?:        string;
  officialRating?:  string;    // e.g. "PG-13", "TV-MA"
  communityRating?: number;    // e.g. 7.4
  hasPoster:        boolean;
  childCount?:      number;    // Series: number of seasons
}

export interface JellyfinNowPlaying {
  name:            string;
  type:            string;          // 'Movie' | 'Episode' | 'MusicVideo' | 'Audio'
  seriesName?:     string;          // TV show name
  episodeTitle?:   string;
  runTimeTicks?:   number;          // 100ns intervals
  productionYear?: number;
  itemId:          string;          // used for /api/jellyfin/image/:itemId
}

export interface JellyfinSession {
  id:           string;
  userId:       string;
  userName:     string;
  deviceName:   string;
  client:       string;
  nowPlaying?:  JellyfinNowPlaying;
  positionTicks?: number;           // 100ns intervals
  isPaused:     boolean;
}

export interface JellyfinStatus {
  connected:      boolean;
  version?:       string;
  serverName?:    string;
  activeSessions: JellyfinSession[];
}
