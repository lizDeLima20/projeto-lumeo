import type { ComicDocument, ComicLimaManifest, ComicPage, ComicTextRegion, NormalizedBounds } from "./ComicInteractionTypes";

export class ComicInteractionValidationError extends Error {}

export class ComicInteractionValidator {
  public validateDocument(document: ComicDocument): true {
    this.validateManifest(document.manifest);
    if (document.manifest.documentId !== document.metadata.id) {
      throw new ComicInteractionValidationError("Manifest e metadados da HQ apontam para documentos diferentes.");
    }
    if (document.manifest.pages.length !== document.pages.length) {
      throw new ComicInteractionValidationError("Manifest e documento da HQ possuem quantidades de páginas diferentes.");
    }
    const pageIds = new Set<string>();
    document.pages.forEach((page, index) => {
      const entry = document.manifest.pages[index];
      if (page.index !== index || entry?.index !== index || entry.id !== page.id || entry.imagePath !== page.imagePath) {
        throw new ComicInteractionValidationError("Manifest e pagina da HQ inconsistentes.");
      }
      if (pageIds.has(page.id)) throw new ComicInteractionValidationError("Página de HQ com identificador duplicado.");
      pageIds.add(page.id);
      this.validatePage(page);
    });
    return true;
  }

  public validateManifest(manifest: ComicLimaManifest): true {
    if (manifest.format !== "lima") throw new ComicInteractionValidationError("Formato LIMA inválido para HQ.");
    // Version 1 has one rectangle per region, version 2 the three of them: both are read.
    if (![1, 2, 3, 4].includes(manifest.version)) throw new ComicInteractionValidationError("Versão LIMA de HQ não suportada.");
    if (manifest.contentType !== "comic") throw new ComicInteractionValidationError("Manifest LIMA não é de HQ.");
    if (manifest.metadataPath !== "metadata/metadata.json") throw new ComicInteractionValidationError("Manifest LIMA de HQ sem metadata padrão.");
    if (manifest.pagesPath !== "pages/" || manifest.interactionPath !== "interaction/") {
      throw new ComicInteractionValidationError("Estrutura LIMA de HQ inválida.");
    }
    manifest.pages.forEach(page => {
      this.safePath(page.imagePath);
      if (!page.imagePath.startsWith("pages/")) throw new ComicInteractionValidationError("Imagem de HQ fora de pages/.");
      if (page.interactionPath) {
        this.safePath(page.interactionPath);
        if (!page.interactionPath.startsWith("interaction/")) throw new ComicInteractionValidationError("Interação de HQ fora de interaction/.");
      }
    });
    return true;
  }

  public validatePage(page: ComicPage): true {
    if (page.index < 0 || !Number.isInteger(page.index)) throw new ComicInteractionValidationError("Índice de página de HQ inválido.");
    this.safePath(page.imagePath);
    if (!page.imagePath.startsWith("pages/")) throw new ComicInteractionValidationError("Imagem de HQ fora de pages/.");
    const ids = new Set<string>();
    page.regions.forEach(region => {
      if (ids.has(region.id)) throw new ComicInteractionValidationError("Regiao duplicada na pagina de HQ.");
      ids.add(region.id); this.validateRegion(region, page.index);
    });
    return true;
  }

  public validateRegion(region: ComicTextRegion, expectedPageIndex = region.pageIndex): true {
    for (const path of [region.assetPath, region.maskPath]) if (path !== undefined) {
      this.safePath(path);
      // WebP or PNG: the browser decides which it can write, and the bytes say which it did.
      if (!/^interaction\/assets\/[a-zA-Z0-9_-]+\.(png|webp)$/.test(path)) throw new ComicInteractionValidationError("Asset de HQ fora de interaction/assets/.");
    }
    if (!region.id) throw new ComicInteractionValidationError("Região de texto de HQ sem identificador.");
    if (region.pageIndex !== expectedPageIndex) throw new ComicInteractionValidationError("Região de texto de HQ em página inconsistente.");
    this.validateBounds(region);
    for (const bounds of [region.textBounds, region.visualBounds, region.hitBounds]) if (bounds) this.validateBounds(bounds);
    if (region.ocrConfidence !== undefined && (!Number.isFinite(region.ocrConfidence) || region.ocrConfidence < 0 || region.ocrConfidence > 1)) {
      throw new ComicInteractionValidationError("Confiança OCR da HQ deve ser normalizada entre 0 e 1.");
    }
    return true;
  }

  public validateBounds(bounds: NormalizedBounds): true {
    const values = [bounds.x, bounds.y, bounds.width, bounds.height];
    if (values.some(value => !Number.isFinite(value))) throw new ComicInteractionValidationError("Coordenada de HQ deve ser finita.");
    if (bounds.x < 0 || bounds.y < 0 || bounds.width <= 0 || bounds.height <= 0) {
      throw new ComicInteractionValidationError("Coordenada de HQ deve ser normalizada e positiva.");
    }
    if (bounds.x + bounds.width > 1 || bounds.y + bounds.height > 1) {
      throw new ComicInteractionValidationError("Região de HQ ultrapassa os limites normalizados da página.");
    }
    return true;
  }

  private safePath(path: string): void {
    if (path.startsWith("/") || path.split("/").includes("..")) {
      throw new ComicInteractionValidationError("Container LIMA de HQ contém caminho inseguro.");
    }
  }
}
