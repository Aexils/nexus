export interface AbsSession {
  id: string;
  userId: string;
  libraryItemId: string;
  mediaType: 'book' | 'podcast';
  title: string;
  author?: string;
  currentTime: number; // seconds
  duration: number;    // seconds
}

export interface AbsLastSession {
  title:         string;
  author?:       string;
  libraryItemId: string;
  mediaType:     'book' | 'podcast';
  currentTime:   number;
  duration:      number;
  stoppedAt:     string; // ISO timestamp
}

export interface AbsStatus {
  connected:      boolean;
  version?:       string; // server version e.g. "2.17.4"
  activeSessions: AbsSession[];
  lastSession?:   AbsLastSession | null;
}

export interface AbsBookProgress {
  currentTime: number;
  progress: number;    // 0–1
  isFinished: boolean;
  lastUpdate?: number;
}

export interface AbsStatusMap {
  alexis: AbsStatus;
  marion: AbsStatus;
}

export interface AbsLibraryItem {
  id: string;
  libraryId: string;
  title: string;
  subtitle?: string;
  author?: string;
  narrator?: string;
  series?: string;
  seriesSequence?: string;
  description?: string;
  publishedYear?: string;
  genres: string[];
  duration: number;
  mediaType: 'book' | 'podcast';
  hasCover: boolean;
  progress?: AbsBookProgress;
}
