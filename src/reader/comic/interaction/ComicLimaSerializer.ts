import { strToU8, zipSync } from "fflate";
import type { ComicDocument, ComicPageAsset } from "./ComicInteractionTypes";
import { ComicInteractionValidator } from "./ComicInteractionValidator";

export class ComicLimaSerializer {
  public serialize(document: ComicDocument, assets: readonly ComicPageAsset[] = []): Uint8Array {
    new ComicInteractionValidator().validateDocument(document);
    const archive: Record<string, Uint8Array> = {
      "manifest.json": strToU8(JSON.stringify(document.manifest, null, 2)),
      "metadata/metadata.json": strToU8(JSON.stringify(document.metadata, null, 2)),
    };
    const assetMap = new Map(assets.map(asset => [asset.path, asset.data]));
    for (const asset of assets) for (const object of asset.interactionAssets ?? []) archive[object.path] = object.data;
    for (const asset of assets) if (asset.path.startsWith("interaction/assets/")) archive[asset.path] = asset.data;
    document.pages.forEach(page => {
      const data = assetMap.get(page.imagePath);
      if (data) archive[page.imagePath] = data;
      archive[`interaction/${String(page.index + 1).padStart(3, "0")}.json`] = strToU8(JSON.stringify({ pageIndex: page.index, regions: page.regions }, null, 2));
    });
    return zipSync(archive, { level: 6 });
  }
}
