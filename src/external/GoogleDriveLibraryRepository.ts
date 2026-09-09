import type { StorageAdapter } from "../services/StorageService";
import { I18nManager } from "../i18n/I18nManager";

export interface GoogleDriveLibrarySource {
  id: string; userId: string; name: string; folderUrl: string; folderId: string;
  createdAt: string; updatedAt: string;
}
export class GoogleDriveLibraryRepository {
  private queue: Promise<unknown> = Promise.resolve();
  /** Sources registered while nobody is signed in belong to the device. Without this
   *  the modal opened onto a dead end - no name field, no link field, no way to add -
   *  and blamed disk space for it. That is precisely the state a 400 from
   *  /auth/refresh leaves the app in, and registering a Drive folder has nothing to do
   *  with being signed in. Once a session exists its own bucket is used again. */
  public static readonly deviceOwner = "device";
  private readonly owner: string;
  public constructor(private readonly storage: StorageAdapter, userId: string) {
    this.owner = userId.trim() || GoogleDriveLibraryRepository.deviceOwner;
  }
  public static parse(value: string): { folderId: string; folderUrl: string } {
    try {
      const url = new URL(value.trim());
      const match = /^\/drive\/(?:u\/\d+\/)?folders\/([\w-]+)\/?$/.exec(url.pathname);
      if (url.protocol !== "https:" || url.hostname !== "drive.google.com" || url.port || url.username || url.password || !match) throw new Error();
      const clean = new URL(`https://drive.google.com/drive/folders/${match[1]}`);
      const key = url.searchParams.get("resourcekey");
      if (key) { if (!/^[\w-]+$/.test(key)) throw new Error(); clean.searchParams.set("resourcekey", key); }
      return { folderId: match[1]!, folderUrl: clean.href };
    } catch { throw new Error(I18nManager.shared.t("google.invalidLink")); }
  }
  public async all(): Promise<GoogleDriveLibrarySource[]> {
    return (await this.storage.load<GoogleDriveLibrarySource[]>(`googleLibraries:${this.owner}`) ?? []).filter(row => row.userId === this.owner);
  }
  private mutate<T>(action: () => Promise<T>): Promise<T> {
    const result = this.queue.then(action); this.queue = result.catch(() => undefined); return result;
  }
  public save(name: string, link: string, id?: string): Promise<GoogleDriveLibrarySource> {
    return this.mutate(async () => {
      if (!name.trim() || name.trim().length > 100) throw new Error(I18nManager.shared.t("externalLibrary.invalidName"));
      const parsed = GoogleDriveLibraryRepository.parse(link), rows = await this.all();
      const previous = rows.find(row => row.id === id), now = new Date().toISOString();
      const source: GoogleDriveLibrarySource = { ...parsed, id: previous?.id ?? crypto.randomUUID(), userId: this.owner,
        name: name.trim(), createdAt: previous?.createdAt ?? now, updatedAt: now };
      await this.storage.save(`googleLibraries:${this.owner}`, [...rows.filter(row => row.id !== source.id), source]); return source;
    });
  }
  public remove(id: string): Promise<void> { return this.mutate(async () => {
    await this.storage.save(`googleLibraries:${this.owner}`, (await this.all()).filter(row => row.id !== id));
  }); }
}
