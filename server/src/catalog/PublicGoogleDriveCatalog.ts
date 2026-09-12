import { LegacyDriveCatalogProvider } from "./LegacyDriveCatalogProvider.js";

/** @deprecated Compatibility name for the original public Drive catalog flow. */
export class PublicGoogleDriveCatalog extends LegacyDriveCatalogProvider {
  public constructor(folderId: string, locale = "pt-BR") {
    super({ sourceId: `legacy-${locale.toLowerCase()}`, locale, folderId, mode: "legacy", enabled: true, priority: 10 });
  }
}
