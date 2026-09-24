import { Zip, ZipPassThrough, strToU8 } from "fflate";
import type { ComicDocument, ComicPage, ComicPageAsset } from "./ComicInteractionTypes";

/** Images are already compressed. ZIP STORE avoids blocking compression and retaining
 * decoded pages. Only the output archive and small interaction records accumulate. */
export class ComicLimaWriter {
  private readonly chunks: Uint8Array[] = [];
  private readonly zip = new Zip((error, data) => { if (error) throw error; this.chunks.push(data); });
  private readonly paths = new Set<string>();
  private add(path: string, data: Uint8Array): void {
    if (this.paths.has(path)) throw new Error(`Duplicate LIMA entry: ${path}`);
    this.paths.add(path);
    const entry = new ZipPassThrough(path);
    this.zip.add(entry); entry.push(data, true);
  }
  public page(page: ComicPage, asset: ComicPageAsset): void {
    this.add(page.imagePath, asset.data);
    for (const object of asset.interactionAssets ?? []) this.add(object.path, object.data);
    this.add(`interaction/${String(page.index + 1).padStart(3, "0")}.json`, strToU8(JSON.stringify({ pageIndex: page.index, regions: page.regions })));
  }
  public finish(document: ComicDocument): Uint8Array {
    this.add("manifest.json", strToU8(JSON.stringify(document.manifest)));
    this.add("metadata/metadata.json", strToU8(JSON.stringify(document.metadata)));
    this.zip.end();
    const bytes = new Uint8Array(this.chunks.reduce((sum, chunk) => sum + chunk.length, 0));
    let offset = 0;
    for (const chunk of this.chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    this.chunks.length = 0;
    return bytes;
  }
}
