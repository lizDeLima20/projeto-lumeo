import type { SupabaseClient } from "@supabase/supabase-js";
import type { CollectionIndexStore } from "./CollectionIndexStore.js";
import type { CollectionIndex } from "./types.js";

const BUCKET = "collection-search-index";

/** The materialized index, one JSON object per collection, in Supabase Storage - not the
 *  database (no migration needed, the server's own service key already manages it) and
 *  never the comic files themselves (this bucket holds metadata only). A user's search
 *  reads it; only the separate rebuild endpoint writes it. */
export class SupabaseCollectionIndexStore implements CollectionIndexStore {
  public constructor(private readonly client: SupabaseClient) {}

  public async get(collectionId: string): Promise<CollectionIndex | null> {
    const { data, error } = await this.client.storage.from(BUCKET).download(this.path(collectionId));
    if (error || !data) return null;
    try { return JSON.parse(await data.text()) as CollectionIndex; }
    catch { return null; }
  }

  public async put(index: CollectionIndex): Promise<void> {
    const body = JSON.stringify(index);
    const { error } = await this.client.storage.from(BUCKET).upload(this.path(index.collectionId), body, {
      contentType: "application/json", upsert: true,
    });
    if (error) throw error;
  }

  private path(collectionId: string): string { return `${collectionId}.json`; }
}
