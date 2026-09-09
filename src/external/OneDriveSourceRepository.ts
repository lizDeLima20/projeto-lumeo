import type { StorageAdapter } from "../services/StorageService";
import type { ExternalLibrarySource } from "./ExternalLibrarySource";
import { OneDriveError } from "./OneDriveError";
import { OneDriveFolderResolver } from "./OneDriveFolderResolver";

/** Stores source settings only, scoped to the signed-in Lumeo account. */
export class OneDriveSourceRepository {
  private readonly key: string;
  private queue: Promise<unknown> = Promise.resolve();
  public constructor(private readonly storage: StorageAdapter, private readonly userId: string) {
    if (!userId) throw new OneDriveError("onedrive.authRequired");
    this.key = `externalLibraries:${userId}`;
  }
  public async all(): Promise<ExternalLibrarySource[]> {
    const rows = await this.storage.load<ExternalLibrarySource[]>(this.key);
    return Array.isArray(rows) ? rows.filter(row => row.userId === this.userId && row.provider === "ONEDRIVE") : [];
  }
  public save(name: string, sourceUrl: string, id?: string): Promise<ExternalLibrarySource> {
    const clean = name.trim();
    if (!clean || clean.length > 100) return Promise.reject(new OneDriveError("externalLibrary.invalidName"));
    const url = OneDriveFolderResolver.validateLink(sourceUrl);
    return this.serialize(async () => {
      const rows = await this.all(); const existing = id ? rows.find(row => row.id === id) : undefined;
      if (id && !existing) throw new OneDriveError("onedrive.notFound");
      const now = new Date().toISOString();
      const source: ExternalLibrarySource = { id: existing?.id ?? crypto.randomUUID(), userId: this.userId, name: clean,
        provider: "ONEDRIVE", sourceUrl: url, remoteFolderId: existing?.sourceUrl === url ? existing.remoteFolderId : null,
        createdAt: existing?.createdAt ?? now, updatedAt: now, enabled: true };
      await this.storage.save(this.key, [...rows.filter(row => row.id !== source.id), source]); return source;
    });
  }
  public async resolved(id: string, folderId: string): Promise<void> {
    await this.serialize(async () => { const rows = await this.all(); await this.storage.save(this.key, rows.map(row => row.id === id
      ? { ...row, remoteFolderId: folderId, updatedAt: new Date().toISOString() } : row)); });
  }
  public async remove(id: string): Promise<void> {
    await this.serialize(async () => { await this.storage.save(this.key, (await this.all()).filter(row => row.id !== id)); });
  }
  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const result = this.queue.then(action); this.queue = result.catch(() => undefined); return result;
  }
}
