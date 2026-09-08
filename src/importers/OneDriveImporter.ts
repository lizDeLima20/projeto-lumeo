import type { CloudImportProvider } from "./CloudImportProvider";
import type { ImportedFile } from "./BookImporter";

export class OneDriveImporter implements CloudImportProvider {
  public readonly providerName = "OneDrive";
  public async selectFile(): Promise<ImportedFile> { throw new Error("A integração com OneDrive ainda não está disponível."); }
}
