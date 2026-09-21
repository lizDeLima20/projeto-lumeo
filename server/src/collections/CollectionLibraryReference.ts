import type { DriveCollection, DriveFolderEntry } from "./types.js";

/** Everything needed to reopen a comic later without walking the Drive tree again. The
 *  Drive file id is the identity, so a renamed file - or two files with the same name -
 *  still resolve to exactly one book. */
export interface CollectionLibraryReference {
  sourceId: string;
  driveFileId: string;
  title: string;
  mimeType: string;
  format: "pdf" | "epub";
  contentType: "comic" | "book";
  /** The folder the file was found in, so "voltar para a coleção" needs no search. */
  folderId: string;
  folderPath: readonly string[];
  downloadUrl: string;
  fileSize: number | null;
}

export class CollectionLibraryReferenceError extends Error {}

export function collectionLibraryReference(
  collection: DriveCollection, folderId: string, breadcrumb: readonly { id: string }[], entry: DriveFolderEntry,
): CollectionLibraryReference {
  if (entry.kind !== "file" || !entry.supported || (entry.format !== "pdf" && entry.format !== "epub")) {
    throw new CollectionLibraryReferenceError("COLLECTION_ENTRY_NOT_READABLE");
  }
  return {
    sourceId: collection.id,
    driveFileId: entry.id,
    title: entry.name.replace(/\.(pdf|epub)$/i, "").trim() || entry.name,
    mimeType: entry.mimeType,
    format: entry.format,
    contentType: entry.contentType ?? collection.contentType,
    folderId,
    folderPath: breadcrumb.map(step => step.id),
    // The published Drive link: bytes are downloaded by the device, never proxied here.
    downloadUrl: `https://drive.google.com/uc?export=download&id=${encodeURIComponent(entry.id)}`,
    fileSize: entry.size,
  };
}
