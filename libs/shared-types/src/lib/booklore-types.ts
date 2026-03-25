/** Book currently being read (included in WebSocket status) */
export interface BookloreCurrentBook {
  id: number;
  title: string;
  authors: string[];
  progress: number;      // 0–100 percentage
  seriesName?: string;
}

/** WebSocket status payload per user */
export interface BookloreStatus {
  connected: boolean;
  version?: string;       // e.g. "1.17.0"
  totalBooks?: number;
  currentlyReading: BookloreCurrentBook[];
}

/** Map of status per Nexus user */
export interface BookloreStatusMap {
  alexis: BookloreStatus;
  marion: BookloreStatus;
}

/** Full book record returned by REST /api/booklore/library */
export interface BookloreBook {
  id: number;
  title: string;
  authors: string[];
  categories: string[];
  description?: string;
  publisher?: string;
  publishedYear?: string;
  language?: string;
  seriesName?: string;
  seriesIndex?: string;
  libraryName?: string;
  progress?: number;     // 0–100 (from epubProgress / pdfProgress)
  isRead?: boolean;
  pageCount?: number;
}
