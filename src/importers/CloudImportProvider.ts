import type { ImportedFile } from "./BookImporter";

export interface CloudImportProvider {
  readonly providerName: string;
  selectFile(): Promise<ImportedFile>;
}
