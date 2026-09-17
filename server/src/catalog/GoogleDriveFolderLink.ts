import { ApiError } from "../errors/ApiError.js";

/** Turns whatever a person copies from Google Drive into the folder ID the catalogue reads. */
export class GoogleDriveFolderLink {
  /**
   * Accepts `drive/folders/<id>` (with or without `/u/<n>/`, query strings or a trailing
   * slash), `open?id=<id>`, `folderview?id=<id>` and a bare ID.
   */
  public static folderId(value: string): string {
    const raw = value.trim();
    if (GoogleDriveFolderLink.isId(raw)) return raw;
    let url: URL;
    try { url = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { throw GoogleDriveFolderLink.invalid(); }
    if (url.protocol !== "https:" && url.protocol !== "http:") throw GoogleDriveFolderLink.invalid();
    if (url.hostname !== "drive.google.com" && url.hostname !== "docs.google.com") throw GoogleDriveFolderLink.invalid();
    const byPath = url.pathname.match(/\/folders\/([A-Za-z0-9_-]+)/)?.[1];
    const byQuery = /\/(open|folderview)$/.test(url.pathname) ? url.searchParams.get("id") : null;
    const candidate = byPath ?? byQuery;
    if (!candidate || !GoogleDriveFolderLink.isId(candidate)) throw GoogleDriveFolderLink.invalid();
    return candidate;
  }

  /** Canonical link stored next to the ID, so the admin screen always shows a working URL. */
  public static canonicalUrl(folderId: string): string { return `https://drive.google.com/drive/folders/${folderId}`; }

  private static isId(value: string): boolean { return /^[A-Za-z0-9_-]{10,}$/.test(value); }
  private static invalid(): ApiError { return new ApiError(422, "CATALOG_SOURCE_LINK_INVALID", "Link de pasta do Google Drive inválido."); }
}
