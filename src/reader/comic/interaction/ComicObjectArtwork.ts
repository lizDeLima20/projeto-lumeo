import { unzipSync } from "fflate";
import type { ComicTextRegion } from "./ComicInteractionTypes";

export interface ComicOriginalArt { image: CanvasImageSource; x: number; y: number; width: number; height: number; fallback?: boolean; }

/** One original-pixel representation shared by the open balloon and its hint. */
export function comicArtworkCanvas(art: ComicOriginalArt): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(art.width)); canvas.height = Math.max(1, Math.round(art.height));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas unavailable");
  context.drawImage(art.image, art.x, art.y, art.width, art.height, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Keep compressed assets; decode only recently used objects, never all 36 pages. */
export class ComicObjectArtwork {
  private bytes: Record<string, Uint8Array> = {};
  private readonly decoded = new Map<string, ImageBitmap>();
  private generation = 0;
  public load(bytes: Uint8Array): void {
    this.clear();
    this.bytes = unzipSync(bytes, { filter: entry => entry.name.startsWith("interaction/assets/") && !/-mask\.[a-z]+$/.test(entry.name) });
  }
  /** The cutouts of one page, ready before the package that will hold them all. */
  public add(assets: readonly { path: string; data: Uint8Array }[] = []): void {
    for (const asset of assets) if (!/-mask\.[a-z]+$/.test(asset.path)) this.bytes[asset.path] = asset.data;
  }

  public async get(region: ComicTextRegion): Promise<ComicOriginalArt | null> {
    const path = region.assetPath; if (!path || !this.bytes[path]) return null;
    let bitmap = this.decoded.get(path);
    if (!bitmap) {
      const generation = this.generation;
      // The type comes from the bytes themselves; the extension only names the entry.
      bitmap = await createImageBitmap(new Blob([new Uint8Array(this.bytes[path]!)]));
      if (generation !== this.generation) { bitmap.close(); return null; }
      this.decoded.set(path, bitmap);
      if (this.decoded.size > 24) {
        const oldest = this.decoded.keys().next().value!;
        this.decoded.get(oldest)?.close(); this.decoded.delete(oldest);
      }
    }
    return { image: bitmap, x: 0, y: 0, width: bitmap.width, height: bitmap.height, fallback: region.segmentationMethod === "original-crop-fallback" };
  }
  public clear(): void { this.generation++; for (const bitmap of this.decoded.values()) bitmap.close(); this.decoded.clear(); this.bytes = {}; }
}
