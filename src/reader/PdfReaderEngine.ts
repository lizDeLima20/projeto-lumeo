import { getDocument, GlobalWorkerOptions, PasswordResponses, type PDFDocumentLoadingTask,
  type PDFDocumentProxy, type PDFPageProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerUrl;

export class PdfPasswordCancelledError extends Error {}
export type PasswordProvider = (incorrectPassword: boolean) => Promise<string | null>;

export class PdfReaderEngine {
  private loadingTask: PDFDocumentLoadingTask | null = null;
  private document: PDFDocumentProxy | null = null;
  private passwordCancelled = false;

  public async open(blob: Blob, passwordProvider: PasswordProvider): Promise<void> {
    await this.close();
    this.passwordCancelled = false;
    this.loadingTask = getDocument({ data: await blob.arrayBuffer() });
    this.loadingTask.onPassword = (updatePassword: (password: string) => void, reason: number) => {
      void passwordProvider(reason === PasswordResponses.INCORRECT_PASSWORD).then((password) => {
        if (password === null) { this.passwordCancelled = true; void this.loadingTask?.destroy(); return; }
        updatePassword(password);
      });
    };
    try { this.document = await this.loadingTask.promise; }
    catch (error) {
      if (this.passwordCancelled) throw new PdfPasswordCancelledError("A abertura do PDF protegido foi cancelada.");
      throw error;
    }
  }

  public get totalPages(): number { return this.document?.numPages ?? 0; }
  public async getPage(pageNumber: number): Promise<PDFPageProxy> {
    if (!this.document) throw new Error("O PDF ainda não foi carregado.");
    return this.document.getPage(pageNumber);
  }
  public async close(): Promise<void> {
    if (this.loadingTask) await this.loadingTask.destroy();
    this.loadingTask = null; this.document = null;
  }
}
