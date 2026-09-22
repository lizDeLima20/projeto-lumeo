import { DriveEntryClassifier } from "./DriveEntryClassifier.js";
import type { DriveRequestLimiter } from "./DriveRequestLimiter.js";
import type { DriveCollection, DriveFolderEntry } from "./types.js";

const SHORTCUT_MIME = "application/vnd.google-apps.shortcut";
const FIELDS = "nextPageToken,files(id,name,mimeType,description,thumbnailLink,size,modifiedTime,shortcutDetails(targetId,targetMimeType))";

interface DriveApiFile {
  id: string; name: string; mimeType: string; description?: string; thumbnailLink?: string; size?: string; modifiedTime?: string;
  parents?: string[];
  shortcutDetails?: { targetId?: string; targetMimeType?: string };
}

/** An authorized Drive API GET. Injected so the browser has no opinion about credentials:
 *  in production it is the catalogue's service account, in tests a stub. */
export type DriveRequest = (url: URL) => Promise<Response>;

export class DriveFolderUnavailableError extends Error {
  public constructor(public readonly httpStatus: number) { super("DRIVE_FOLDER_UNAVAILABLE"); }
}

/** Reads one folder at a time through the Drive API. Never recursive: a folder is listed
 *  only when someone opens it, so a collection of any size costs one request per screen. */
export interface DriveWarning { code: string; entryId: string; name: string }

export class DriveFolderBrowser {
  private readonly classifier = new DriveEntryClassifier();
  /** Warnings from the last listing: a broken shortcut is reported, never fatal. */
  public readonly warnings: DriveWarning[] = [];
  public constructor(private readonly request: DriveRequest, private readonly limiter?: DriveRequestLimiter) {}
  private send(url: URL): Promise<Response> {
    return this.limiter ? this.limiter.run(() => this.request(url)) : this.request(url);
  }

  public async children(folderId: string, collection?: Pick<DriveCollection, "contentType">): Promise<readonly DriveFolderEntry[]> {
    const entries: DriveFolderEntry[] = [];
    this.warnings.length = 0;
    let pageToken = "";
    do {
      const url = new URL("https://www.googleapis.com/drive/v3/files");
      url.searchParams.set("q", `'${folderId.replace(/'/g, "\\'")}' in parents and trashed = false`);
      url.searchParams.set("fields", FIELDS);
      url.searchParams.set("pageSize", "1000");
      url.searchParams.set("supportsAllDrives", "true");
      url.searchParams.set("includeItemsFromAllDrives", "true");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const response = await this.send(url);
      if (!response.ok) throw new DriveFolderUnavailableError(response.status);
      const data = await response.json() as { files?: DriveApiFile[]; nextPageToken?: string };
      // Every child is kept, folders and files alike: a folder that holds both must not
      // lose either half on the way to the screen.
      for (const file of data.files ?? []) { const entry = this.entry(file, collection); if (entry) entries.push(entry); }
      pageToken = data.nextPageToken ?? "";
    } while (pageToken);
    return entries;
  }

  /** The folder's own name and parent, used to build a breadcrumb and to prove a folder
   *  really belongs to the collection that is asking for it. */
  public async folder(folderId: string): Promise<{ id: string; name: string; parentId: string | null }> {
    const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}`);
    url.searchParams.set("fields", "id,name,mimeType,parents");
    url.searchParams.set("supportsAllDrives", "true");
    const response = await this.send(url);
    if (!response.ok) throw new DriveFolderUnavailableError(response.status);
    const file = await response.json() as DriveApiFile;
    return { id: file.id, name: file.name, parentId: file.parents?.[0] ?? null };
  }

  private entry(file: DriveApiFile, collection?: Pick<DriveCollection, "contentType">): DriveFolderEntry | null {
    if (file.mimeType === SHORTCUT_MIME) {
      const target = file.shortcutDetails;
      if (!target?.targetId || !target.targetMimeType) {
        // A shortcut whose target is gone. Dropping just this row keeps the rest of the
        // folder intact, which is the whole point of not failing the listing.
        this.warnings.push({ code: "SHORTCUT_BROKEN", entryId: file.id, name: file.name });
        return null;
      }
      return this.describe({ ...file, id: target.targetId, mimeType: target.targetMimeType, size: undefined }, collection, true);
    }
    return this.describe(file, collection, false);
  }

  private describe(file: DriveApiFile, collection: Pick<DriveCollection, "contentType"> | undefined, shortcut: boolean): DriveFolderEntry {
    if (this.classifier.isFolder(file.mimeType)) {
      return { id: file.id, name: file.name, kind: "folder", mimeType: file.mimeType, format: null, supported: true,
        size: null, modifiedAt: file.modifiedTime ?? null, ...(shortcut ? { shortcut: true } : {}) };
    }
    const format = this.classifier.format(file.mimeType, file.name);
    const supported = this.classifier.isSupported(format);
    return { id: file.id, name: file.name, kind: "file", mimeType: file.mimeType, format, supported,
      ...(file.description ? { description: file.description } : {}),
      ...(file.thumbnailLink ? { thumbnailUrl: file.thumbnailLink } : {}),
      ...(supported ? { contentType: collection?.contentType ?? "book" } : {}),
      size: file.size ? Number(file.size) : null, modifiedAt: file.modifiedTime ?? null,
      ...(shortcut ? { shortcut: true } : {}) };
  }

}
