import { IndexedDbService, STORE_NAMES } from "./IndexedDbService";

export interface PendingCatalogImport {
  bookId: string;
  driveFileId: string;
  title: string;
  author: string;
  format: "pdf" | "epub";
  expectedFilename: string;
  coverUrl: string | null;
  catalogGenre: string;
  sha256: string | null;
}

interface SavedValue<T> { key: string; value: T; }
interface FilePickerOptions {
  id?: string;
  startIn?: FileSystemDirectoryHandle | "downloads";
  multiple?: boolean;
  types?: readonly { description: string; accept: Record<string, readonly string[]>; }[];
}
interface DirectoryPickerOptions { id?: string; startIn?: "downloads"; mode?: "read" | "readwrite"; }
interface FileSystemAccessWindow extends Window {
  showDirectoryPicker?: (options: DirectoryPickerOptions) => Promise<FileSystemDirectoryHandle>;
  showOpenFilePicker?: (options: FilePickerOptions) => Promise<readonly FileSystemFileHandle[]>;
}

/**
 * Keeps a user-approved directory handle only in this device's IndexedDB.
 * It never reads Downloads silently and never sends a handle to the BFF.
 */
export class FileSystemFolderManager {
  private static readonly FOLDER_KEY = "catalog-download-folder";
  private static readonly PENDING_KEY = "catalog-pending-import";

  public constructor(private readonly database: IndexedDbService) {}

  public get supportsDirectoryPicker(): boolean { return typeof window !== "undefined" && typeof (window as FileSystemAccessWindow).showDirectoryPicker === "function"; }
  public get supportsOpenFilePicker(): boolean { return typeof window !== "undefined" && typeof (window as FileSystemAccessWindow).showOpenFilePicker === "function"; }

  public async savePending(value: PendingCatalogImport): Promise<void> {
    await this.save(FileSystemFolderManager.PENDING_KEY, value);
  }

  public async pending(): Promise<PendingCatalogImport | null> {
    return this.load<PendingCatalogImport>(FileSystemFolderManager.PENDING_KEY);
  }

  /** Requests a folder only from a direct user action. Returns null on cancellation. */
  public async chooseLumeoFolder(): Promise<FileSystemDirectoryHandle | null> {
    if (!this.supportsDirectoryPicker) return null;
    try {
      const picker = (window as FileSystemAccessWindow).showDirectoryPicker!;
      // Read/write permission is requested only because a user selecting Downloads
      // may allow creation of its Lumeo child directory.
      const selected = await picker({ id: "lumeo-books-folder", startIn: "downloads", mode: "readwrite" });
      const folder = selected.name.toLocaleLowerCase() === "lumeo" ? selected : await selected.getDirectoryHandle("Lumeo", { create: true });
      await this.save(FileSystemFolderManager.FOLDER_KEY, folder);
      return folder;
    } catch (error) {
      if (this.isAbort(error)) return null;
      throw error;
    }
  }

  public async savedLumeoFolder(): Promise<FileSystemDirectoryHandle | null> {
    return this.load<FileSystemDirectoryHandle>(FileSystemFolderManager.FOLDER_KEY);
  }

  /** Opens a file picker at the approved Lumeo folder when the browser supports it. */
  public async selectDownloadedBook(): Promise<File | null> {
    const startIn = await this.savedLumeoFolder();
    if (this.supportsOpenFilePicker) {
      try {
        const handles = await this.openFilePicker(startIn ?? "downloads");
        return handles[0] ? handles[0].getFile() : null;
      } catch (error) {
        if (this.isAbort(error)) return null;
        if (startIn) {
          try { const handles = await this.openFilePicker("downloads"); return handles[0] ? handles[0].getFile() : null; }
          catch (fallbackError) { if (this.isAbort(fallbackError)) return null; throw fallbackError; }
        }
        throw error;
      }
    }
    return this.selectWithInput();
  }

  private openFilePicker(startIn: FileSystemDirectoryHandle | "downloads"): Promise<readonly FileSystemFileHandle[]> {
    return (window as FileSystemAccessWindow).showOpenFilePicker!({
      id: "lumeo-book-import", startIn, multiple: false,
      types: [{ description: "Livros", accept: {
        "application/pdf": [".pdf"], "application/epub+zip": [".epub"], "application/x-mobipocket-ebook": [".mobi"],
      } }],
    });
  }

  private selectWithInput(): Promise<File | null> {
    return new Promise((resolve) => {
      const input = document.createElement("input"); input.type = "file";
      input.accept = ".epub,.mobi,.pdf,application/epub+zip,application/x-mobipocket-ebook,application/pdf";
      input.addEventListener("change", () => resolve(input.files?.[0] ?? null), { once: true }); input.click();
    });
  }

  private async save<T>(key: string, value: T): Promise<void> {
    await this.database.request(STORE_NAMES.librarySettings, "readwrite", store => store.put({ key, value } satisfies SavedValue<T>));
  }
  private async load<T>(key: string): Promise<T | null> {
    const row = await this.database.request<SavedValue<T> | undefined>(STORE_NAMES.librarySettings, "readonly", store => store.get(key));
    return row?.value ?? null;
  }
  private isAbort(error: unknown): boolean { return error instanceof DOMException && error.name === "AbortError"; }
}
