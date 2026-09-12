import { ApiError } from "../errors/ApiError.js";
import type { CatalogFormat } from "./types.js";

export interface GoogleDrivePublicDownloadInfo {
  driveFileId: string;
  downloadUrl: string;
  downloadUrls: readonly string[];
  coverUrl: string;
  expectedFormat: CatalogFormat;
}

/**
 * The one place where public Google Drive file links are interpreted.
 * It deliberately returns URLs only: book bytes always travel from Drive to
 * the reader's browser, never through the BFF.
 */
export class GoogleDrivePublicUrlResolver {
  public resolve(fileIdOrUrl: string, expectedFormat: CatalogFormat): GoogleDrivePublicDownloadInfo {
    const driveFileId = this.extractFileId(fileIdOrUrl);
    // Google documents https://drive.google.com/uc as its public-download
    // endpoint. It redirects to the current content host and avoids forcing a
    // confirmation token that can be rejected by mobile browsers.
    const download = new URL("https://drive.google.com/uc");
    download.searchParams.set("export", "download");
    download.searchParams.set("id", driveFileId);
    const contentDownload = new URL("https://drive.usercontent.google.com/download");
    contentDownload.searchParams.set("id", driveFileId);
    contentDownload.searchParams.set("export", "download");
    const thumbnail = new URL("https://drive.google.com/thumbnail");
    thumbnail.searchParams.set("id", driveFileId);
    // Drive creates this lightweight preview from the document itself. It is
    // cached by Drive and does not make Explore download the book file.
    thumbnail.searchParams.set("sz", "w480-h640");
    return { driveFileId, downloadUrl: download.toString(), downloadUrls: [download.toString(), contentDownload.toString()], coverUrl: thumbnail.toString(), expectedFormat };
  }

  /** Public thumbnail for a separately prepared structured cover. */
  public coverUrl(fileIdOrUrl: string): string {
    const driveFileId = this.extractFileId(fileIdOrUrl);
    const thumbnail = new URL("https://drive.google.com/thumbnail");
    thumbnail.searchParams.set("id", driveFileId);
    thumbnail.searchParams.set("sz", "w480-h640");
    return thumbnail.toString();
  }

  public extractFileId(fileIdOrUrl: string): string {
    const raw = fileIdOrUrl.trim();
    if (this.isFileId(raw)) return raw;
    try {
      const url = new URL(raw);
      const byQuery = url.searchParams.get("id");
      const byPath = url.pathname.match(/\/d\/([A-Za-z0-9_-]{10,})/i)?.[1];
      const candidate = byQuery ?? byPath;
      if (candidate && this.isFileId(candidate)) return candidate;
    } catch { /* The validation below produces the safe API error. */ }
    throw new ApiError(422, "CATALOG_FILE_INVALID", "Identificador de arquivo do catálogo inválido.");
  }

  private isFileId(value: string): boolean { return /^[A-Za-z0-9_-]{10,}$/.test(value); }
}
