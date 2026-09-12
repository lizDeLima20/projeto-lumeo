import type { CatalogBookRecord, CatalogPage, CatalogQuery, CatalogSourceConfig, CatalogSourceDiagnostic, CatalogSourceProviderKind } from "./types.js";

/** Source-specific catalog adapter. It only handles public metadata, never bytes. */
export interface CatalogSourceProvider {
  readonly source: CatalogSourceConfig;
  readonly provider: CatalogSourceProviderKind;
  list(query: CatalogQuery): Promise<CatalogPage>;
  get(bookId: string): Promise<CatalogBookRecord | null>;
  diagnostic(): CatalogSourceDiagnostic;
}
