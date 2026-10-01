import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { BookFileRepository } from "../src/repositories/BookFileRepository";
import { BookRepository } from "../src/repositories/BookRepository";
import { LibraryChecksumRepository } from "../src/repositories/LibraryChecksumRepository";
import { IndexedDbService } from "../src/services/IndexedDbService";
import { ImportManager, DuplicateBookImportError } from "../src/services/ImportManager";
import { LocalFileImporter } from "../src/importers/LocalFileImporter";
import { CollectionImportService, CollectionFileMismatchError } from "../src/services/CollectionImportService";
import type { Book } from "../src/models/Book";
import type { CatalogDownloadReceipt, CatalogDownloadService } from "../src/services/CatalogDownloadService";
import type { CoverService } from "../src/services/CoverService";
import type { DriveFolderEntry, DriveFolderListing } from "../src/services/DriveCollectionService";

Object.assign(globalThis, { indexedDB, IDBKeyRange });
const source = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const ROOT = "1wXs64lZ0nOBAAWwGutDHfjO-TnfYO6Ee";
// Aminimal real PDF so LocalFileImporter.import() (header-sniffing, no archive worker
// needed) succeeds without the WASM/libarchive.js environment this suite cannot provide -
// the bug this file reproduces lives entirely above that layer anyway.
const pdfBytes = (tag = "") => new TextEncoder().encode(`%PDF-1.4\n%${tag}\n`);
const comic = (id: string, over: Partial<DriveFolderEntry> = {}): DriveFolderEntry => ({
  id, name: "Capítulo 01", kind: "file", mimeType: "application/pdf", format: "pdf", supported: true,
  contentType: "comic", size: null, modifiedAt: null, ...over,
});
const listing = (...folders: [string, string][]): Pick<DriveFolderListing, "folderId" | "breadcrumb"> => ({
  folderId: folders.at(-1)?.[0] ?? ROOT,
  breadcrumb: [{ id: ROOT, name: "HQs da Marvel" }, ...folders.map(([id, name]) => ({ id, name }))],
});
const covers = { fromBookFile: async () => "data:image/png;base64,primeira-pagina" } as unknown as CoverService;

/** A shared on-disk store (one real IndexedB per test), with two independently-constructed
 *  CollectionImportService instances pointed at it - each with its own "library" identity
 *  view, exactly like two app sessions (an old one, and a freshly relaunched one) sharing
 *  the same underlying storage without necessarily agreeing yet on what is already there. */
function sharedStore(receipt: (file: File) => CatalogDownloadReceipt) {
  const database = new IndexedDbService(`lumeo-collection-${crypto.randomUUID()}`);
  const books = new BookRepository(database);
  const imports = new ImportManager(new LocalFileImporter(), books, new BookFileRepository(database), undefined, undefined, undefined, undefined, new LibraryChecksumRepository(database));
  const downloaded: string[] = [];
  const downloads: CatalogDownloadService = {
    target: "android-private-storage",
    download: async link => { downloaded.push(link.downloadUrl); return receipt(new File([pdfBytes()], link.expectedFilename, { type: "application/pdf" })); },
  };
  const serviceWithLibrary = (library: readonly Book[]) => new CollectionImportService(downloads, imports, covers, id => library.find(book => book.catalogBookId === id));
  return { books, downloaded, serviceWithLibrary };
}

describe("o bug real: download termina com sucesso, mas a UI mostrava falha genérica", () => {
  it("3/9. a importação encontra o MESMO arquivo já salvo (por hash) quando a visão local da biblioteca não sabe disso - erro específico (DuplicateBookImportError), nunca uma falha genérica", async () => {
    // Every download in this test returns byte-for-byte the same PDF - the point is that
    // Drive content, not the entry id, is what the library is ultimately keyed by once the
    // file reaches disk.
    const { books, downloaded, serviceWithLibrary } = sharedStore(file => ({ kind: "native-file", file }));
    const library: Book[] = [];
    const firstService = serviceWithLibrary(library);
    const first = await firstService.add({ collectionId: "marvel-hqs", entry: comic("fenix-01"), listing: listing(["fenix", "Fênix"]), genreId: "hqs" });
    assert.equal(first.kind, "saved");
    if (first.kind === "saved") library.push(first.book);

    // A second request, for a DIFFERENT comic identity, through a service whose own
    // "library" callback is empty - the exact shape of a session whose in-memory list has
    // not (yet, or ever, in this run) caught up with what the first service already
    // persisted. existing() cannot find it by identity; only the content hash can.
    const staleSessionService = serviceWithLibrary([]);
    await assert.rejects(
      () => staleSessionService.add({ collectionId: "marvel-hqs", entry: comic("deadpool-01"), listing: listing(["deadpool", "Deadpool"]), genreId: "hqs" }),
      (error: unknown) => {
        assert.ok(error instanceof DuplicateBookImportError, `esperava DuplicateBookImportError, recebeu ${error instanceof Error ? error.constructor.name : typeof error}`);
        assert.equal(error.decision.book.id, first.kind === "saved" ? first.book.id : undefined);
        assert.equal(error.message, "Este livro já está na sua biblioteca.");
        return true;
      },
    );
    // The download itself succeeded (the native plugin's own job) - only the later import
    // step found the duplicate. A real download must not have been skipped, and nothing
    // extra should have been written to the library.
    assert.equal(downloaded.length, 2, "as duas tentativas de download de fato aconteceram");
    assert.equal((await books.getAll()).length, 1, "a segunda tentativa não pode ter criado um segundo registro");
  });

  it("2. download sucesso + importação sucesso (identidade nova, conteúdo novo): a HQ entra normalmente na biblioteca", async () => {
    const { books, serviceWithLibrary } = sharedStore(file => ({ kind: "native-file", file } as CatalogDownloadReceipt));
    const library: Book[] = [];
    const service = serviceWithLibrary(library);
    const result = await service.add({ collectionId: "marvel-hqs", entry: comic("fenix-01"), listing: listing(["fenix", "Fênix"]), genreId: "hqs" });
    assert.equal(result.kind, "saved");
    assert.equal((await books.getAll()).length, 1);
  });

  it("9. um resultado nativo malformado (tamanho não corresponde ao esperado) é recusado com um erro específico, nunca passa batido", async () => {
    const { books, serviceWithLibrary } = sharedStore(() => ({ kind: "native-file", file: new File([pdfBytes("outro-conteudo")], "Capítulo 01.pdf", { type: "application/pdf" }) }));
    const service = serviceWithLibrary([]);
    // Drive reported this entry as 20MB; whatever the plugin actually handed back is not
    // that file - the exact shape of a native layer returning something unexpected.
    const request = { collectionId: "marvel-hqs", entry: comic("fenix-01", { size: 20_000_000 }), listing: listing(["fenix", "Fênix"]), genreId: "hqs" };
    await assert.rejects(() => service.add(request), CollectionFileMismatchError);
    assert.equal((await books.getAll()).length, 0, "um arquivo que não bate com a HQ nunca deveria ser salvo");
  });

  it("8. PDF continua funcionando normalmente mesmo quando o conteúdo colide com outra HQ já salva (sem regressão)", async () => {
    // The fix only changes which error reaches the view and how the view reacts to it - the
    // service's own PDF path (identical in shape to CBR/CBZ's) is untouched.
    const { books, serviceWithLibrary } = sharedStore(file => ({ kind: "native-file", file } as CatalogDownloadReceipt));
    const library: Book[] = [];
    const service = serviceWithLibrary(library);
    const first = await service.add({ collectionId: "marvel-hqs", entry: comic("fenix-01", { name: "Capítulo 01.pdf" }), listing: listing(["fenix", "Fênix"]), genreId: "hqs" });
    assert.equal(first.kind, "saved");
    if (first.kind === "saved") library.push(first.book);
    const second = await service.add({ collectionId: "marvel-hqs", entry: comic("fenix-01", { name: "Capítulo 01.pdf" }), listing: listing(["fenix", "Fênix"]), genreId: "hqs" });
    // Same identity this time (same entry.id) - existing() finds it up front, exactly as
    // before this change; this is the ordinary "already added" path, not the bug's path.
    assert.equal(second.kind, "existing");
    assert.equal((await books.getAll()).length, 1);
  });
});

describe("CBR/CBZ: MIME types reais do Drive continuam aceitos (não regredidos por esta correção)", () => {
  it("4/5. application/x-rar e application/rar - os MIME reais que o Drive devolve para CBR - continuam na lista aceita", () => {
    const cbrLine = /cbr: \[([^\]]+)\]/.exec(source("src/importers/LocalFileImporter.ts"))![1]!;
    assert.match(cbrLine, /"application\/x-rar"/);
    assert.match(cbrLine, /"application\/rar"/);
  });
  it("6. quando o MIME é genérico (application/octet-stream), a extensão do arquivo governa o formato - tanto para CBR quanto CBZ", () => {
    const importer = source("src/importers/LocalFileImporter.ts");
    const cbrLine = /cbr: \[([^\]]+)\]/.exec(importer)![1]!;
    const cbzLine = /cbz: \[([^\]]+)\]/.exec(importer)![1]!;
    assert.match(cbrLine, /"application\/octet-stream"/);
    assert.match(cbzLine, /"application\/octet-stream"/);
    // An empty mimeType (no Content-Type at all) must not be rejected either - the check is
    // skipped entirely so the extension alone decides, the same as a generic one.
    assert.match(importer, /if \(file\.type && !this\.mimeTypes\[extension\]\.includes\(file\.type\)\)/);
  });
  it("7. application/zip - o MIME real que o Drive devolve para CBZ - continua na lista aceita", () => {
    const cbzLine = /cbz: \[([^\]]+)\]/.exec(source("src/importers/LocalFileImporter.ts"))![1]!;
    assert.match(cbzLine, /"application\/zip"/);
  });
});

describe("ComicDetailsView: a tela reconhece corretamente um resultado de DuplicateBookImportError como sucesso, não como falha de download", () => {
  it("1. nem download.onclick nem add.onclick mostram a mensagem genérica de falha quando o erro real é 'já está na biblioteca'", () => {
    const view = source("src/views/ComicDetailsView.ts");
    assert.match(view, /import \{ DuplicateBookImportError \} from "\.\.\/services\/ImportManager";/);
    // Both handlers must recognize the duplicate error and reuse the same success path
    // (showOpen) the pre-existing "already in library" check at the top of detail() uses -
    // never fall through to the generic ui.catalog.downloadFailed text for this case.
    const downloadHandler = view.slice(view.indexOf("download.onclick ="), view.indexOf("add.onclick ="));
    const addHandler = view.slice(view.indexOf("add.onclick ="));
    for (const [name, handler] of [["download.onclick", downloadHandler], ["add.onclick", addHandler]] as const) {
      // The DuplicateBookImportError branch must add the book to this session's live
      // library state (it was only ever found in the repository, by hash - never seen by
      // this session's own identity-based check), reuse showOpen() and return immediately -
      // never fall through to the generic "ui.catalog.downloadFailed" text further down in
      // the same catch block, and never leave the book invisible until the app restarts.
      assert.match(handler,
        /if \(error instanceof DuplicateBookImportError\) \{ this\.actions\.added\(error\.decision\.book\); showOpen\(error\.decision\.book, this\.i18n\.t\("ui\.comic\.alreadyInLibrary"\)\); return; \}/,
        `${name} deveria registrar a HQ já existente na biblioteca desta sessão, reconhecer sucesso e retornar, nunca cair na mensagem genérica de falha`);
    }
  });
  it("outros erros reais (ex.: arquivo não corresponde) continuam mostrando sua própria mensagem, nunca a genérica de download", () => {
    const view = source("src/views/ComicDetailsView.ts");
    assert.match(view, /error instanceof CollectionFileMismatchError \? this\.i18n\.t\("ui\.comic\.fileMismatch"\)\s*\n?\s*:\s*error instanceof Error \? error\.message : this\.i18n\.t\("ui\.catalog\.downloadFailed"\)/);
  });
});
