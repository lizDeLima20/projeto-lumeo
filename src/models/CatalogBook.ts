import type { BookFileType } from "./Book";

export interface CatalogBookData {
  id: string; title: string; author: string; genre: string; coverUrl: string;
  fileUrl: string; format: BookFileType; description: string; licenseType: string; source: string;
}
export class CatalogBook {
  public constructor(public readonly data: CatalogBookData) {}
}
