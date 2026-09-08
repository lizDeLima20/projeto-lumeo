import type { Book } from "../models/Book";

export interface LumeoBackupManifest {
  format: "lumeo-backup";
  version: 1;
  createdAt: string;
  includesBooks: boolean;
}
export interface LumeoBackup {
  manifest: LumeoBackupManifest;
  library: { books: Book[] };
  progress: unknown[];
  highlights: unknown[];
  notes: unknown[];
  bookmarks: unknown[];
  study: Record<string, unknown>;
  preferences: Record<string, unknown>;
  books?: { bookId: string; blob: Blob; hash?: string }[];
}
export interface BackupSource {
  books: Book[];
  progress?: unknown[];
  highlights?: unknown[];
  notes?: unknown[];
  bookmarks?: unknown[];
  study?: Record<string, unknown>;
  preferences?: Record<string, unknown>;
  files?: { bookId: string; blob: Blob; hash?: string }[];
}

export class BackupService {
  public createLight(source: BackupSource): LumeoBackup {
    return this.create(source, false);
  }

  public createFull(source: BackupSource): LumeoBackup {
    return this.create(source, true);
  }

  private create(source: BackupSource, includesBooks: boolean): LumeoBackup {
    return {
      manifest: { format: "lumeo-backup", version: 1, createdAt: new Date().toISOString(), includesBooks },
      library: { books: source.books },
      progress: source.progress ?? [],
      highlights: source.highlights ?? [],
      notes: source.notes ?? [],
      bookmarks: source.bookmarks ?? [],
      study: source.study ?? {},
      preferences: source.preferences ?? {},
      ...(includesBooks ? { books: source.files ?? [] } : {}),
    };
  }
}
