import { randomUUID } from "node:crypto";
import { ApiError } from "../errors/ApiError.js";
import type { CatalogStore } from "./CatalogRepository.js";
import type { CatalogBookRecord, CatalogSyncReport } from "./types.js";
import { GoogleCatalogDriveClient, type CatalogDriveFile } from "./GoogleCatalogDriveClient.js";

/** Explicit administrator action only; it never runs on a user page load. */
export class CatalogSyncService {
  public constructor(private readonly store: CatalogStore, private readonly drive: GoogleCatalogDriveClient, private readonly storageAccountId = "google-drive-default") {}
  public async sync(): Promise<CatalogSyncReport> {
    const report: CatalogSyncReport = { lastSyncedAt: new Date().toISOString(), total: 0, created: 0, updated: 0, duplicates: 0, failures: 0, unavailable: 0 };
    const listing = await this.drive.listCatalog(), files = listing.books; report.total = files.length; report.audit = listing.audit; const present = new Set(files.map((file) => file.id));
    for (const file of files) {
      try { await this.syncFile(file, report); } catch (error) { report.failures++; console.warn(JSON.stringify({ event: "catalog.sync.file_failed", fileId: file.id, code: error instanceof ApiError ? error.code : "UNKNOWN" })); }
    }
    report.unavailable = await this.store.markUnavailableMissingFrom(this.storageAccountId, present); return report;
  }
  private async syncFile(file: CatalogDriveFile, report: CatalogSyncReport): Promise<void> {
    const sha256 = await this.drive.hashAndValidate(file); const existing = await this.store.getAnyByDriveFileId(this.storageAccountId, file.id);
    const now = new Date().toISOString(); const parsed = this.parseName(file.name);
    const record: CatalogBookRecord = { bookId: existing?.bookId ?? randomUUID(), title: parsed.title, author: parsed.author, genreId: "sem-genero", genreName: "Sem gênero", coverUrl: existing?.coverUrl ?? null, description: existing?.description ?? null,
      format: file.format, sourceFileName: file.name, fileSize: file.size, driveFileId: file.id, storageAccountId: this.storageAccountId, sha256, volume: parsed.volume, collection: parsed.collection, language: existing?.language ?? null, createdAt: existing?.createdAt ?? now, updatedAt: now, status: "ACTIVE" };
    await this.store.save(record); if (existing) report.updated++; else report.created++;
  }
  private parseName(name: string): { title: string; author: string; volume: string | null; collection: string | null } {
    const base = name.replace(/\.(pdf|epub)$/i, "").replace(/[_]+/g, " ").trim(); const parts = base.split(/\s+-\s+/);
    const title = (parts[0] ?? base).trim() || "Livro sem título"; const author = (parts[1] ?? "Autor desconhecido").trim();
    const volume = base.match(/(?:volume|vol\.?|v\.?|parte|tomo)\s*(\d+)/i)?.[1] ?? null;
    const collection = volume ? title.replace(/\s*(?:volume|vol\.?|v\.?|parte|tomo)\s*\d+.*/i, "").trim() || null : null;
    return { title, author, volume, collection };
  }
}
