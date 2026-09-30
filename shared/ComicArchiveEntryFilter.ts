/** Which archive entries are real comic pages, and in what order. Shared between the
 *  reader's own archive engine (which decides what page 1 actually is) and anything that
 *  only needs to peek at the first page - such as a cover thumbnail - so both always agree
 *  on what "the first page" means, instead of drifting into two different answers. */

/** No path traversal, no absolute paths. */
export function isSafeArchivePath(path: string): boolean {
  return !path.startsWith("/") && !/^[a-z]:\//i.test(path) && !path.split("/").some(part => part === ".." || part === "" || part === ".");
}

/** A real page: not a hidden file, not __MACOSX/Thumbs.db, and a format the reader shows. */
export function isComicPageImagePath(path: string): boolean {
  const parts = path.split("/");
  return !parts.some(part => part.startsWith(".") || part === "__MACOSX" || part.toLowerCase() === "thumbs.db") && /\.(jpe?g|png|webp)$/i.test(path);
}

/** The exact ordering the reader uses for pages within one archive - numeric-aware, so
 *  "Capítulo 2" sorts before "Capítulo 10". */
export const comicPageCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Sniffs the real image type from its own bytes - a renamed or mislabeled page is still
 *  read correctly, and anything else is rejected rather than shown as a broken image. */
export function sniffComicPageMime(bytes: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}
