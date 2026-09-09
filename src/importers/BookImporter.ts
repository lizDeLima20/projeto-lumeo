import type { BookFileType } from "../models/Book";

export type ImportSource = "device" | "google-drive" | "url" | "onedrive";
export interface ImportedFile {
  file: File; fileType: BookFileType; suggestedTitle: string; source: ImportSource;
  originalName: string; mimeType: string; size: number;
}
export interface BookImporter { import(source: File): Promise<ImportedFile>; }
