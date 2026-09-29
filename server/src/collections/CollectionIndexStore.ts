import type { CollectionIndex } from "./types.js";

/** Where the materialized search index for a collection lives between rebuilds. A user's
 *  search only ever reads through this; only the separate rebuild process writes to it. */
export interface CollectionIndexStore {
  get(collectionId: string): Promise<CollectionIndex | null>;
  put(index: CollectionIndex): Promise<void>;
}
