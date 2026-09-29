import type { DriveCollection } from "./types.js";

/** The single place a published collection is defined. A new collection is one entry here
 *  or one entry in DRIVE_COLLECTIONS_JSON - never a code change anywhere else, and never a
 *  folder name: the tree inside the root folder supplies all of that at runtime. */
export const DEFAULT_DRIVE_COLLECTIONS: readonly DriveCollection[] = [
  { id: "marvel-hqs", name: "HQs da Marvel", rootFolderId: "1wXs64lZ0nOBAAWwGutDHfjO-TnfYO6Ee", contentType: "comic", navigationMode: "folders",
    sourceRootFolderIds: ["1zjVQ0K6mWgXcZSTV8gNi-jxY0x2KWjGN"] },
  { id: "dc-hqs", name: "HQs da DC", rootFolderId: "1-9bSxiCfavMPf9g0wzSDFVkzJqS6j2nI", contentType: "comic" },
];

const ID_PATTERN = /^[a-z0-9-]{3,60}$/i;
const FOLDER_PATTERN = /^[A-Za-z0-9_-]{10,}$/;

export function driveCollectionsFromEnvironment(raw: string | undefined): readonly DriveCollection[] {
  if (!raw?.trim()) return DEFAULT_DRIVE_COLLECTIONS;
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return DEFAULT_DRIVE_COLLECTIONS;
    const collections = value.flatMap((entry): DriveCollection[] => {
      if (!entry || typeof entry !== "object") return [];
      const candidate = entry as Partial<DriveCollection>;
      if (typeof candidate.id !== "string" || !ID_PATTERN.test(candidate.id)) return [];
      if (typeof candidate.name !== "string" || !candidate.name.trim()) return [];
      if (typeof candidate.rootFolderId !== "string" || !FOLDER_PATTERN.test(candidate.rootFolderId)) return [];
      return [{ id: candidate.id, name: candidate.name.trim(), rootFolderId: candidate.rootFolderId,
        contentType: candidate.contentType === "book" ? "book" : "comic",
        ...(candidate.navigationMode === "folders" ? { navigationMode: "folders" as const } : {}),
        ...(Array.isArray(candidate.sourceRootFolderIds) ? { sourceRootFolderIds: candidate.sourceRootFolderIds.filter(id => typeof id === "string" && FOLDER_PATTERN.test(id)) } : {}) }];
    });
    if (!collections.length) return DEFAULT_DRIVE_COLLECTIONS;
    const merged = new Map(DEFAULT_DRIVE_COLLECTIONS.map(collection => [collection.id, collection]));
    collections.forEach(collection => {
      const current = merged.get(collection.id);
      merged.set(collection.id, { ...current, ...collection,
        sourceRootFolderIds: collection.sourceRootFolderIds ?? current?.sourceRootFolderIds });
    });
    return [...merged.values()];
  } catch { return DEFAULT_DRIVE_COLLECTIONS; }
}
