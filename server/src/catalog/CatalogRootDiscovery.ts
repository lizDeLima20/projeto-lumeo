import type { CatalogSourceConfig } from "./types.js";

export interface DriveFolderEntry { id: string; name: string; mimeType: string; }
export interface DriveFolderLister { listFolderEntries(folderId: string): Promise<readonly DriveFolderEntry[]>; }

const FOLDER = "application/vnd.google-apps.folder";

/** Finds published genre folders below configured Drive roots, including nested roots. */
export class CatalogRootDiscovery {
  public constructor(private readonly roots: readonly string[], private readonly drive: DriveFolderLister) {}

  public async sources(): Promise<readonly CatalogSourceConfig[]> {
    const found: CatalogSourceConfig[] = [];
    for (const [index, root] of this.roots.entries()) {
      const visited = new Set<string>();
      let count = 0;
      const visit = async (folderId: string, name: string, depth: number): Promise<void> => {
        if (visited.has(folderId)) return;
        visited.add(folderId);
        let children: readonly DriveFolderEntry[];
        try { children = await this.drive.listFolderEntries(folderId); }
        catch (error) {
          console.warn(JSON.stringify({ event: "CATALOG_CATEGORY_INVALID", rootIndex: index + 1, folderId, reason: "NO_ACCESS", code: error instanceof Error ? error.message.slice(0, 80) : "UNKNOWN" }));
          return;
        }
        const hasCatalog = children.some((child) => child.name.toLocaleLowerCase("pt-BR") === "catalog.json" && child.mimeType !== FOLDER);
        if (hasCatalog) {
          const hasBooks = children.some((child) => child.name.toLocaleLowerCase("pt-BR") === "books" && child.mimeType === FOLDER);
          const hasCovers = children.some((child) => child.name.toLocaleLowerCase("pt-BR") === "covers" && child.mimeType === FOLDER);
          if (name && hasBooks && hasCovers && !/^hqs?\b/i.test(name)) {
            found.push({ sourceId: `discovered-${folderId}`, locale: "pt-BR", folderId, mode: "structured", enabled: true, priority: 200 + index, genre: name });
            count++;
            console.info(JSON.stringify({ event: "CATALOG_CATEGORY_DISCOVERED", rootIndex: index + 1, folderId, genre: name }));
          } else {
            console.warn(JSON.stringify({ event: "CATALOG_CATEGORY_INVALID", rootIndex: index + 1, folderId, reason: !name ? "ROOT_WITH_CATALOG" : !hasBooks ? "BOOKS_FOLDER_MISSING" : !hasCovers ? "COVERS_FOLDER_MISSING" : "COMIC_COLLECTION" }));
          }
          return;
        }
        if (depth >= 3) return;
        for (const child of children) if (child.mimeType === FOLDER) await visit(child.id, child.name, depth + 1);
      };
      await visit(root, "", 0);
      console.info(JSON.stringify({ event: `CATALOG_DRIVE_${index + 1}_DISCOVERED`, rootFolderId: root, categories: count }));
    }
    return found;
  }
}
