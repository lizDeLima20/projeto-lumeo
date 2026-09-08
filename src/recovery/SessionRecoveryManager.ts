import type { StorageAdapter } from "../services/StorageService";

export interface ReaderSessionSnapshot {
  bookId: string;
  location: string;
  panel?: string;
  pendingNoteDraft?: string;
  savedAt: string;
}

export class SessionRecoveryManager {
  private static readonly KEY = "readerSessionSnapshot";
  public constructor(private readonly storage: StorageAdapter) {}

  public save(snapshot: Omit<ReaderSessionSnapshot, "savedAt">): Promise<void> {
    return this.storage.save(SessionRecoveryManager.KEY, { ...snapshot, savedAt: new Date().toISOString() });
  }

  public load(): Promise<ReaderSessionSnapshot | null> {
    return this.storage.load<ReaderSessionSnapshot>(SessionRecoveryManager.KEY);
  }
}
