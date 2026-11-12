import sharp from "sharp";

export type OpdsCoverSize = "capa" | "miniatura" | "grande";
/** Width in pixels: a cover for the book's page, a thumbnail for the lists, and the large cover
 *  centred on the Kindle extension's book screen. */
export const OPDS_COVER_WIDTH: Readonly<Record<OpdsCoverSize, number>> = { capa: 300, miniatura: 150, grande: 600 };
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;
/** Covers kept per instance (a few KB each); the reader's own cache does the rest. */
const CACHED_COVERS = 300;

/**
 * Small JPEG covers for e-ink readers, made from the catalog's own cover image (a Drive
 * thumbnail or the catalog's cover link). Kept in memory per instance: losing them only costs
 * one more resize.
 */
export class OpdsCoverService {
  private readonly cache = new Map<string, Buffer>();
  public constructor(private readonly fetcher: typeof fetch = fetch) {}

  public async cover(bookId: string, sourceUrl: string, size: OpdsCoverSize): Promise<Buffer> {
    const key = `${bookId}:${size}`, known = this.cache.get(key);
    if (known) { this.cache.delete(key); this.cache.set(key, known); return known; }
    const width = OPDS_COVER_WIDTH[size];
    const response = await this.fetcher(OpdsCoverService.sourceFor(sourceUrl, width), { redirect: "follow", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`OPDS_COVER_SOURCE_${response.status}`);
    const declared = Number(response.headers.get("content-length"));
    if (declared > MAX_SOURCE_BYTES) throw new Error("OPDS_COVER_SOURCE_TOO_LARGE");
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_SOURCE_BYTES) throw new Error("OPDS_COVER_SOURCE_TOO_LARGE");
    const jpeg = await sharp(bytes).rotate().resize({ width, withoutEnlargement: true }).flatten({ background: "#ffffff" }).jpeg({ quality: 72, progressive: true, mozjpeg: true }).toBuffer();
    this.cache.set(key, jpeg);
    if (this.cache.size > CACHED_COVERS) this.cache.delete(this.cache.keys().next().value!);
    return jpeg;
  }

  /** A Drive thumbnail is asked at twice the final width (sharper after resizing); any other
   *  cover link is used as it is. */
  public static sourceFor(url: string, width: number): string {
    try {
      const parsed = new URL(url);
      if (parsed.hostname === "drive.google.com" && parsed.pathname === "/thumbnail") { parsed.searchParams.set("sz", `w${width * 2}`); return parsed.toString(); }
      if (parsed.hostname.endsWith("googleusercontent.com")) return url.replace(/=s\d+(-[a-z0-9-]+)?$/i, `=w${width * 2}`);
    } catch { /* not a URL: fetch reports it */ }
    return url;
  }
}
