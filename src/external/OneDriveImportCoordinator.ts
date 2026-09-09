import type { OneDriveDownloadService } from "./OneDriveDownloadService";
import type { BookMetadataExtractor } from "../metadata/BookMetadataExtractor";
import type { CoverService } from "../services/CoverService";
import { ImportManager, type ImportMetadata, type SaveImportOptions, DuplicateBookImportError } from "../services/ImportManager";
import type { ImportedFile } from "../importers/BookImporter";
import type { ExtractedBookMetadata } from "../metadata/MetadataTypes";
import type { DuplicateDecision } from "../storage/DuplicateBookDetector";
import type { Book } from "../models/Book";
import { OperationRecoveryJournal } from "../recovery/OperationRecoveryJournal";
import { OneDriveError, checkCancelled } from "./OneDriveError";
import type { ExternalLibraryTranslationKey } from "../i18n/ExternalLibraryTranslations";
import type { DocumentCapability } from "../reader/image/DocumentCapabilityAnalyzer";

export interface OneDrivePreview { imported: ImportedFile; metadata: ExtractedBookMetadata; cover: string; duplicate: DuplicateDecision; capability?: DocumentCapability; }
export type RemoteProgress = (stage: ExternalLibraryTranslationKey, percent?: number | null) => void;
export class OneDriveImportCoordinator {
  private operationId: string | null = null;
  private controller: AbortController | null = null;
  private preview: OneDrivePreview | null = null;
  private busy = false;
  public constructor(private readonly downloader: OneDriveDownloadService, private readonly manager: ImportManager,
    private readonly metadata: BookMetadataExtractor, private readonly covers: CoverService, private readonly journal: OperationRecoveryJournal,
    private readonly analyze: (file: File, signal: AbortSignal) => Promise<DocumentCapability | undefined> = OneDriveImportCoordinator.analyzePdf) {}
  private static async analyzePdf(file: File, signal: AbortSignal): Promise<DocumentCapability> {
    const { getDocument, GlobalWorkerOptions } = await import("pdfjs-dist");
    const { default: workerUrl } = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
    const { DocumentCapabilityAnalyzer } = await import("../reader/image/DocumentCapabilityAnalyzer");
    GlobalWorkerOptions.workerSrc = workerUrl;
    checkCancelled(signal);
    const task = getDocument({ data: await file.arrayBuffer() });
    try { return await new DocumentCapabilityAnalyzer().analyze(await task.promise); }
    finally { await task.destroy(); }
  }
  public cancel(): void { this.controller?.abort(); this.preview = null; }
  public async discard(): Promise<void> {
    this.cancel();
    if (!this.busy && this.operationId) { await this.journal.fail(this.operationId); this.operationId = null; }
  }
  public async prepare(driveId: string, itemId: string, progress: RemoteProgress): Promise<OneDrivePreview> {
    if (this.busy) throw new OneDriveError("import.remote.failed");
    this.busy = true;
    this.cancel();
    try { if (this.operationId) await this.journal.fail(this.operationId); }
    catch (error) { this.busy = false; throw this.safeError(error); }
    const controller = new AbortController(); this.controller = controller;
    const id = `onedrive-${crypto.randomUUID()}`; this.operationId = id;
    try {
      await this.journal.begin({ id, kind: "import" });
      progress("import.download.loading");
      const file = await this.downloader.download(driveId, itemId, percent => progress("import.download.loading", percent), controller.signal);
      checkCancelled(controller.signal); progress("import.processing.file");
      const validated = await this.manager.select(file); const imported: ImportedFile = { ...validated, source: "onedrive" };
      checkCancelled(controller.signal); progress("import.processing.metadata");
      const metadata = await this.metadata.extract(file, imported.fileType).catch(() => this.metadata.extract(file, imported.fileType, { extract: async () => ({}) }));
      checkCancelled(controller.signal);
      const duplicate = await this.manager.inspect(imported, { title: metadata.title.value, author: metadata.author?.value ?? "" });
      let cover = "";
      let capability: DocumentCapability | undefined;
      if (duplicate.kind !== "duplicate") {
        progress("import.processing.cover"); cover = await this.covers.fromBookFile(file, imported.fileType, metadata.title.value);
        checkCancelled(controller.signal);
        if (imported.fileType === "pdf") { progress("import.processing.file"); capability = await this.analyze(file, controller.signal); }
      }
      checkCancelled(controller.signal);
      this.preview = { imported, metadata, cover, duplicate, capability }; progress("import.remote.preview");
      return this.preview;
    } catch (error) { await this.journal.fail(id); this.operationId = null; this.preview = null; throw this.safeError(error); }
    finally { this.busy = false; }
  }
  public async confirm(metadata: ImportMetadata, options: SaveImportOptions = {}, progress?: RemoteProgress): Promise<Book> {
    if (this.busy || !this.preview || !this.operationId || !this.controller) throw new OneDriveError("import.remote.failed");
    const { imported, duplicate, capability } = this.preview, id = this.operationId, signal = this.controller.signal;
    if (duplicate.kind === "duplicate") throw new DuplicateBookImportError(duplicate);
    this.busy = true;
    try {
      checkCancelled(signal); progress?.("import.processing.library");
      const book = await this.manager.save(imported, { ...metadata, ...(capability ? { documentMode: capability.documentMode, textCapability: capability.textCapability, limaCapability: capability.limaCapability } : {}) }, step => progress?.("import.processing.library", step.percent),
        { ...options, signal, journal: this.journal, operationId: id });
      this.preview = null; this.operationId = null; return book;
    } catch (error) { await this.journal.fail(id); this.preview = null; this.operationId = null; throw this.safeError(error); }
    finally { this.busy = false; }
  }
  private safeError(error: unknown): Error {
    if (error instanceof OneDriveError || error instanceof DuplicateBookImportError) return error;
    if (error instanceof DOMException && error.name === "QuotaExceededError") return new OneDriveError("import.processing.noSpace");
    if (error instanceof Error && /espaço|espa[cç]o insuficiente/i.test(error.message)) return new OneDriveError("import.processing.noSpace");
    return new OneDriveError("import.remote.failed");
  }
}
