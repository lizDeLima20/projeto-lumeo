import { strFromU8, unzipSync } from "fflate";
import type { ComicDocument, ComicLimaManifest, ComicMetadata, ComicPage, ComicTextRegion } from "./ComicInteractionTypes";
import { ComicInteractionValidator } from "./ComicInteractionValidator";

interface InteractionFile {
  pageIndex: number;
  regions?: ComicTextRegion[];
}

export class ComicLimaDeserializer {
  public deserialize(bytes: Uint8Array): ComicDocument {
    const archive = unzipSync(bytes);
    Object.keys(archive).forEach(path => this.safePath(path));
    const manifest = this.json<ComicLimaManifest>(archive["manifest.json"], "manifest.json");
    new ComicInteractionValidator().validateManifest(manifest);
    const metadata = this.json<ComicMetadata>(archive[manifest.metadataPath], manifest.metadataPath);
    const pages = manifest.pages.map(entry => {
      const interaction = entry.interactionPath ? this.optionalJson<InteractionFile>(archive[entry.interactionPath]) : undefined;
      if (interaction && interaction.pageIndex !== entry.index) throw new Error("Interacao associada a pagina incorreta.");
      return {
        index: entry.index,
        id: entry.id,
        imagePath: entry.imagePath,
        width: entry.width,
        height: entry.height,
        mimeType: entry.mimeType,
        cover: entry.cover ?? false,
        regions: interaction?.regions ?? [],
      } satisfies ComicPage;
    });
    const document = { manifest, metadata, pages };
    new ComicInteractionValidator().validateDocument(document);
    for (const page of pages) for (const region of page.regions) {
      for (const path of [region.assetPath, region.maskPath]) if (path && !archive[path]?.length) {
        throw new Error("Asset original da região ausente no pacote LIMA.");
      }
    }
    return document;
  }

  private json<T>(bytes: Uint8Array | undefined, path: string): T {
    if (!bytes) throw new Error(`Arquivo ${path} ausente no pacote LIMA de HQ.`);
    return JSON.parse(strFromU8(bytes)) as T;
  }

  private optionalJson<T>(bytes: Uint8Array | undefined): T | undefined {
    return bytes ? JSON.parse(strFromU8(bytes)) as T : undefined;
  }

  private safePath(path: string): void {
    if (path.startsWith("/") || path.split("/").includes("..")) throw new Error("Container LIMA de HQ contém caminho inseguro.");
  }
}
