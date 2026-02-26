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

export interface AbsStatus {
  connected: boolean;
  activeSessions: AbsSession[];
}

export interface AbsBookProgress {
  currentTime: number;
  progress: number;    // 0–1
  isFinished: boolean;
  lastUpdate?: number;
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
