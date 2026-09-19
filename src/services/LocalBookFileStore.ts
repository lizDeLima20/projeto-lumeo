import { BookFileRepository } from "../repositories/BookFileRepository";
export class LocalBookFileStore {
  public constructor(private readonly fallback: BookFileRepository, private readonly userId = "default") {}
  public get supportsOpfs(): boolean { return typeof navigator !== "undefined" && Boolean(navigator.storage) && "getDirectory" in navigator.storage; }
  public async save(bookId: string, blob: Blob): Promise<"opfs" | "indexeddb"> { if (await this.saveOpfs(bookId, blob)) return "opfs"; await this.fallback.save(bookId, blob); return "indexeddb"; }
  public async saveLima(bookId:string,blob:Blob):Promise<"opfs"|"indexeddb">{if(await this.saveNamedOpfs(`${bookId}.lima`,blob))return"opfs";return"indexeddb";}
  public async getLima(bookId:string):Promise<Blob|null>{return this.getNamedOpfs(`${bookId}.lima`);}
  public async migrateExisting(bookId:string):Promise<boolean>{const legacy=await this.fallback.get(bookId);if(!legacy||!this.supportsOpfs)return false;if(!await this.saveOpfs(bookId,legacy))return false;const copied=await this.getOpfs(bookId);return copied?.size===legacy.size;}
  public async get(bookId: string): Promise<Blob | null> { const opfs = await this.getOpfs(bookId); return opfs ?? this.fallback.get(bookId); }
  public async exists(bookId: string): Promise<boolean> { return Boolean(await this.get(bookId)); }
  public async delete(bookId: string): Promise<void> { const root=await this.root();if(root){for(const name of[`${bookId}.source`,`${bookId}.lima`])try{await root.removeEntry(name);}catch{/* absent */}}await this.fallback.delete(bookId); }
  private async root(): Promise<FileSystemDirectoryHandle | null> { if (!this.supportsOpfs) return null; const storage = navigator.storage as StorageManager & { getDirectory(): Promise<FileSystemDirectoryHandle> }, origin = await storage.getDirectory(), books = await origin.getDirectoryHandle("lumeo-books", { create: true }); return books.getDirectoryHandle(this.namespace(), { create: true }); }
  private namespace(): string { return this.userId.replace(/[^a-zA-Z0-9._-]/g, "_"); }
  private saveOpfs(bookId: string, blob: Blob):Promise<boolean>{return this.saveNamedOpfs(`${bookId}.source`,blob);}
  private async saveNamedOpfs(name:string,blob:Blob): Promise<boolean> { try { const root = await this.root(); if (!root) return false; const handle = await root.getFileHandle(name, { create: true }), writable = await handle.createWritable(); await writable.write(blob); await writable.close(); return true; } catch { return false; } }
  private async getOpfs(bookId: string): Promise<Blob | null> { try { const root = await this.root(); if (!root) return null; return await (await root.getFileHandle(`${bookId}.source`)).getFile(); } catch { return null; } }
  private async getNamedOpfs(name:string):Promise<Blob|null>{try{const root=await this.root();if(!root)return null;return await(await root.getFileHandle(name)).getFile();}catch{return null;}}
}
