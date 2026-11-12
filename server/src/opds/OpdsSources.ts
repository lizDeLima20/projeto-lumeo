import type { ServerConfig } from "../config/Config.js";
import type { CatalogSourceConfig } from "../catalog/types.js";

/** The Autoajuda folder: the OPDS catalog's shelf today, and the first one the Kindle worker converts. */
export const opdsAutoajudaSource = (config: Pick<ServerConfig, "opdsCatalogLocale" | "opdsAutoajudaFolderId">): CatalogSourceConfig => ({
  sourceId: "opds-autoajuda",
  locale: config.opdsCatalogLocale ?? "pt-BR",
  folderId: config.opdsAutoajudaFolderId ?? "1Pqu3DcMJT8wTwC7pFX7e20Z9fPUDJBoZ",
  mode: "structured",
  enabled: true,
  priority: 1,
  genre: "Autoajuda",
});
