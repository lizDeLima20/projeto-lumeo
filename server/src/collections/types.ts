/** A published Drive folder that Lumeo browses live. The folder tree itself is the
 *  navigation: nothing here is copied, mirrored or written back to Drive. */
export interface DriveCollection {
  id: string;
  name: string;
  rootFolderId: string;
  /** What a readable file in this collection is. It belongs to the collection, not to the
   *  file: the same PDF is a comic here and an ordinary book elsewhere. */
  contentType: "comic" | "book";
}

export type DriveEntryKind = "folder" | "file";
/** What the file actually is, decided from Drive metadata rather than from its name. */
export type DriveEntryFormat = "pdf" | "epub" | "cbr" | "cbz" | "unknown";

/** One child of a folder. `id` is the Drive id and is the identity: two folders may share
 *  a name, never an id. */
export interface DriveFolderEntry {
  id: string;
  name: string;
  kind: DriveEntryKind;
  mimeType: string;
  description?: string;
  thumbnailUrl?: string;
  format: DriveEntryFormat | null;
  /** False for a format Lumeo cannot open yet, such as CBR. The entry is still listed:
   *  hiding it would silently lose part of the folder. */
  supported: boolean;
  /** Which reader opens it, for the formats Lumeo supports. */
  contentType?: "comic" | "book";
  size: number | null;
  modifiedAt: string | null;
  /** Present when the entry is a Drive shortcut resolved to its target. */
  shortcut?: boolean;
}

export interface DriveFolderListing {
  collectionId: string;
  folderId: string;
  /** Root first, current folder last. Built from the ancestry walk, so a deep link that
   *  skips the intermediate screens still shows a complete breadcrumb. */
  breadcrumb: readonly { id: string; name: string }[];
  entries: readonly DriveFolderEntry[];
  /** Items that could not be shown, such as a shortcut whose target is gone. The folder is
   *  still served: one bad row must not cost the reader the screen. */
  warnings: readonly { code: string; entryId: string; name: string }[];
}
