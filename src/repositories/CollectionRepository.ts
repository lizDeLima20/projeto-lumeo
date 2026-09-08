import { Collection, type CollectionType } from "../models/Collection";
import { IndexedDbService, STORE_NAMES } from "../services/IndexedDbService";
interface StoredCollection { id: string; name: string; type: CollectionType; createdAt: string; }
export class CollectionRepository {
  public constructor(private readonly database: IndexedDbService) {}
  public async save(collection: Collection): Promise<void> { await this.database.request(STORE_NAMES.collections, "readwrite", store => store.put({ ...collection, createdAt: collection.createdAt.toISOString() })); }
  public async getAll(): Promise<Collection[]> { return (await this.database.getAll<StoredCollection>(STORE_NAMES.collections)).map(item => new Collection(item.id, item.name, item.type, new Date(item.createdAt))); }
  public async findByName(name: string): Promise<Collection | null> { return (await this.getAll()).find(item => item.name.toLocaleLowerCase() === name.toLocaleLowerCase()) ?? null; }
}
