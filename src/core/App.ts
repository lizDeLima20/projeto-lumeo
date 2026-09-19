import { LocalFileImporter } from "../importers/LocalFileImporter";
import { EnvironmentConfig } from "../config/EnvironmentConfig";
import { OneDriveConnections } from "../external/OneDriveConnections";
import { ExternalLibraryStorage } from "../external/ExternalLibraryStorage";
import { OneDriveImportCoordinator } from "../external/OneDriveImportCoordinator";
import { OperationRecoveryJournal } from "../recovery/OperationRecoveryJournal";
import { GoogleDriveImporter, type GoogleDriveConfig } from "../importers/GoogleDriveImporter";
import { UrlImporter } from "../importers/UrlImporter";
import { Book } from "../models/Book";
import { Genre } from "../models/Genre";
import { Collection } from "../models/Collection";
import { ReaderManager } from "../reader/ReaderManager";
import { ReadingProgressService } from "../reader/ReadingProgressService";
import { ReaderSettingsManager } from "../reader/ReaderSettingsManager";
import { BookFileRepository } from "../repositories/BookFileRepository";
import { BookRepository } from "../repositories/BookRepository";
import { GenreRepository } from "../repositories/GenreRepository";
import { UserLibraryPreferencesRepository } from "../repositories/UserLibraryPreferencesRepository";
import { ReadingProgressRepository } from "../repositories/ReadingProgressRepository";
import { CollectionRepository } from "../repositories/CollectionRepository";
import { BookMetadataExtractor } from "../metadata/BookMetadataExtractor";
import { ApiClient, ApiError } from "../services/ApiClient";
import { CatalogService } from "../services/CatalogService";
import type { CatalogDownloadLink } from "../services/CatalogService";
import { CatalogImportCoordinator, type CatalogImportStage } from "../services/CatalogImportCoordinator";
import { HybridCatalogDownloadService } from "../services/CatalogDownloadService";
import { FileSystemFolderManager } from "../services/FileSystemFolderManager";
import type { CatalogBookData } from "../models/CatalogBook";
import { AuthManager } from "../services/AuthManager";
import { CoverService } from "../services/CoverService";
import { DeviceManager } from "../services/DeviceManager";
import { ImportManager } from "../services/ImportManager";
import { IndexedDbService } from "../services/IndexedDbService";
import { LibraryService } from "../services/LibraryService";
import { LocalBookFileStore } from "../services/LocalBookFileStore";
import { PersistentLibraryManager } from "../services/PersistentLibraryManager";
import { LibraryBootstrapService } from "../services/LibraryBootstrapService";
import { DesktopLibraryFolderService } from "../services/DesktopLibraryFolderService";
import { StoragePersistenceService } from "../services/StoragePersistenceService";
import { StorageService } from "../services/StorageService";
import { AccountPersistenceService, type RemoteLibraryBook } from "../services/AccountPersistenceService";
import { reportNativeDownloadDiagnostic } from "../services/NativeBookDownload";
import { ConnectivityManager } from "../pwa/ConnectivityManager";
import { PwaInstallManager } from "../pwa/PwaInstallManager";
import { SyncOutbox, SyncOutboxRepository } from "../services/SyncOutbox";
import { LimaDocumentRepository } from "../repositories/LimaDocumentRepository";
import { LimaConversionManager } from "../lima/LimaConversionManager";
import { LibraryChecksumRepository } from "../repositories/LibraryChecksumRepository";
import { HighlightRepository } from "../repositories/HighlightRepository";
import { AnnotationRepository } from "../repositories/AnnotationRepository";
import { BookmarkRepository } from "../repositories/BookmarkRepository";
import { ChapterStudySheetRepository } from "../repositories/ChapterStudySheetRepository";
import { ReadingReviewRepository } from "../repositories/ReadingReviewRepository";
import { BookDetailsView } from "../views/BookDetailsView";
import { BookEditView } from "../views/BookEditView";
import { BookImportView } from "../views/BookImportView";
import { DeviceConflictView } from "../views/DeviceConflictView";
import { GenreView } from "../views/GenreView";
import { HeaderView } from "../views/HeaderView";
import { HomeView } from "../views/HomeView";
import { AudiobooksView } from "../views/AudiobooksView";
import { LibraryView } from "../views/LibraryView";
import { LoginView } from "../views/LoginView";
import { OnboardingView } from "../views/OnboardingView";
import { ReaderView } from "../views/ReaderView";
import { RegisterView } from "../views/RegisterView";
import { SettingsView } from "../views/SettingsView";
import { CatalogExplorerView } from "../views/CatalogExplorerView";
import { CatalogBookView } from "../views/CatalogBookView";
import { CatalogGenreDialog } from "../views/CatalogGenreDialog";
import { CatalogAdminView } from "../views/CatalogAdminView";
import { PrivacyView } from "../views/PrivacyView";
import { MobileBottomNavigation } from "../views/MobileBottomNavigation";
import { I18nManager } from "../i18n/I18nManager";
import { AppState } from "./AppState";
import { Router, type RouteName } from "./Router";

export class App {
  private readonly state = new AppState();
  private readonly storage = new StorageService();
  private database = new IndexedDbService();
  private books = new BookRepository(this.database);
  private genres = new GenreRepository(this.database);
  private files = new BookFileRepository(this.database);
  private progress = new ReadingProgressRepository(this.database);
  private collections = new CollectionRepository(this.database);
  private limaDocuments=new LimaDocumentRepository(this.database);
  private preferences = new UserLibraryPreferencesRepository(this.database);
  private readonly metadataExtractor = new BookMetadataExtractor();
  private readonly covers = new CoverService();
  private readonly driveConfig: GoogleDriveConfig = { clientId: import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "",
    apiKey: import.meta.env.VITE_GOOGLE_API_KEY ?? "", appId: import.meta.env.VITE_GOOGLE_APP_ID ?? "" };
  private imports = this.createImportManager();
  private libraryService = this.createLibraryService();
  private readerSettings = new ReaderSettingsManager(this.storage);
  private readerManager = new ReaderManager(this.books, this.localFileStore(),
    new ReadingProgressService(this.progress, this.books), this.readerSettings,this.limaDocuments);
  private readonly api = new ApiClient(new EnvironmentConfig().read().bffBaseUrl);
  private readonly accountPersistence = new AccountPersistenceService(this.api);
  private readonly catalog = new CatalogService(this.api);
  private readonly catalogDownloads = new HybridCatalogDownloadService();
  private readonly auth = new AuthManager(this.api, this.storage, this.state);
  private readonly devices = new DeviceManager(this.api, this.storage, this.state);
  private readonly router: Router;
  private headerView: HeaderView | null = null;
  private readonly connectivity = new ConnectivityManager();
  private readonly pwaInstall = new PwaInstallManager();

  public constructor(outlet: HTMLElement, private readonly headerRoot: HTMLElement, private readonly footerRoot: HTMLElement) {
    this.router = new Router(outlet);
    this.router.setGuard((route) => this.guardRoute(route));
    this.registerRoutes();
    this.state.subscribe(() => this.renderHeader());
    I18nManager.shared.subscribe(() => {
      this.renderHeader();
      // Reader holds an in-memory document and selection. Its controls subscribe
      // independently; rebuilding it here would close the book on locale change.
      if (this.router.currentRoute !== "reader") this.router.refresh();
    });
    this.renderHeader();
  }

  public async start(): Promise<void> {
    await I18nManager.shared.initialize();
    await this.restoreTheme();
    this.connectivity.bind();
    this.pwaInstall.bind();
    this.connectivity.subscribe((status)=>{if(status==="OFFLINE")this.showToast(I18nManager.shared.t("offline.status"));if(status==="RECONNECTING"){this.showToast(I18nManager.shared.t("offline.reconnecting"));this.connectivity.markReconnected();if(this.isAuthenticated())void this.syncLocalLibrary();}});
    await this.devices.initialize();
    await this.auth.initialize();
    if (this.isAuthenticated()) {
        if (!this.connectivity.online || this.state.authStatus === "OFFLINE_SESSION_AVAILABLE" || this.state.authStatus === "OFFLINE_AUTHENTICATED") {
          if (this.state.currentUser) { this.configureLocalLibrary(this.state.currentUser.id); await this.hydrateLibrary(false); }
          this.state.authStatus = "OFFLINE_READY"; this.state.notify();
        } else {
          this.state.authStatus = "USER_DATA_LOADING"; this.state.notify();
          try { await this.resolveDevice(); }
          catch (error) {
            // Offline readers still restore their per-user IndexedDB/OPFS library.
            if ((error instanceof ApiError && error.code === "NETWORK_ERROR") || !this.connectivity.online) {
              if (this.state.currentUser) { this.configureLocalLibrary(this.state.currentUser.id); await this.hydrateLibrary(false); }
              this.state.authStatus = "OFFLINE_READY"; this.state.notify();
            } else this.showToast(error instanceof ApiError ? error.message : "Não foi possível restaurar sua sessão.");
          }
        }
    }
      if (this.isAuthenticated() && this.state.authStatus !== "OFFLINE_READY") { this.state.authStatus = "ONLINE_READY"; console.info(JSON.stringify({ event: "AUTH_READY" })); this.state.notify(); }
    this.router.start(this.isAuthenticated() ? this.nextProtectedRoute() : "login");
  }

  private registerRoutes(): void {
    this.router.register("login", () => new LoginView(this.auth, () => this.afterAuthentication(), () => this.router.navigate("register")));
    this.router.register("register", () => new RegisterView(this.auth, () => this.afterAuthentication(), () => this.router.navigate("login")));
    this.router.register("privacy", () => new PrivacyView());
    this.router.register("device-conflict", () => new DeviceConflictView(
      this.state, this.auth, this.devices, () => void this.afterAuthentication(), () => void this.logout(),
    ));
    this.router.register("onboarding", () => new OnboardingView(this.state, this.userName(), () => void this.finishOnboarding()));
    this.router.register("home", () => new HomeView(this.state, this.userName(),
      () => this.router.navigate("library"), () => this.router.navigate("import"), () => this.router.navigate("audiobooks")));
    this.router.register("audiobooks", () => new AudiobooksView(() => this.router.navigate("home")));
    this.router.register("library", () => new LibraryView(this.state,
      (genreId) => this.router.navigate("genre", { id: genreId }), (bookId) => this.openLibraryBook(bookId), (bookId) => void this.deleteBook(bookId, false)));
    this.router.register("explore", () => new CatalogExplorerView(this.catalog, this.state, (bookId) => this.router.navigate("catalog-book", { id: bookId }), () => this.router.navigate("catalog-admin")));
    this.router.register("catalog-book", (params) => new CatalogBookView(this.catalog, this.state, params.get("id") ?? "",
      () => this.router.navigate("explore"), (bookId) => this.openLibraryBook(bookId),
      (book, link) => this.prepareCatalogDownload(book, link),
      (book, link, progress, signal, downloadedFile) => this.addCatalogBook(book, link, progress, signal, downloadedFile), this.catalogDownloads));
    this.router.register("catalog-admin", () => new CatalogAdminView(this.catalog, () => this.router.navigate("explore")));
    this.router.register("genre", (params) => new GenreView(this.state, params.get("id") ?? "",
      () => this.router.navigate("library"), (bookId) => this.openLibraryBook(bookId)));
    this.router.register("import", (params) => {
      const storage = new ExternalLibraryStorage(this.database);
      const connections = new OneDriveConnections(storage, this.state.currentUser!.id);
      const coordinator = new OneDriveImportCoordinator(connections.downloads, this.imports, this.metadataExtractor, this.covers, new OperationRecoveryJournal(storage));
      return new BookImportView(this.state, this.imports, this.genres, this.collections, this.covers, this.metadataExtractor,
        (book) => void this.addBook(book), () => this.router.navigate("library"), (bookId) => this.deleteBook(bookId, false),
        { connections, coordinator, initialSourceId: params.get("source") ?? undefined, openExisting: id => this.openLibraryBook(id) });
    });
    this.router.register("book", (params) => this.detailsView(params.get("id") ?? ""));
    this.router.register("edit-book", (params) => new BookEditView(this.state, this.findBook(params.get("id")), this.genres, this.covers,
      (book) => void this.updateBook(book), () => this.router.navigate("book", { id: params.get("id") ?? "" })));
    this.router.register("reader", (params) => new ReaderView(params.get("id") ?? "", this.readerManager,
      this.state.settings.theme, () => this.router.navigate("library"), (book) => this.syncBook(book), this.database,
      this.userName(), this.state.currentUser?.id));
    this.router.register("settings", () => new SettingsView(this.state, (theme) => void this.changeTheme(theme),new StoragePersistenceService(),new DesktopLibraryFolderService(this.database),
      this.state.currentUser ? { connections: new OneDriveConnections(new ExternalLibraryStorage(this.database), this.state.currentUser.id),
        open: source => this.router.navigate("import", { source }) } : undefined, this.pwaInstall));
  }

  private detailsView(id: string): BookDetailsView {
    const book = this.findBook(id);
    const genre = book ? this.state.genres.find((item) => item.id === book.genreId) ?? null : null;
    return new BookDetailsView(book, genre, () => this.openLibraryBook(id),
      () => this.router.navigate("edit-book", { id }), () => void this.deleteBook(id), () => this.router.navigate("library"),()=>void this.locateBookFile(id),
      () => { if (book?.catalogBookId) this.router.navigate("catalog-book", { id: book.catalogBookId }); });
  }

  private async afterAuthentication(): Promise<void> {
    await this.resolveDevice();
    if (!this.isAuthenticated()) {
      throw new ApiError(403, "LICENSE_REQUIRED", "Esta conta não possui uma licença ativa.");
    }
    this.router.navigate(this.nextProtectedRoute());
  }

  private async resolveDevice(): Promise<void> {
      if (this.state.authStatus === "OFFLINE_SESSION_AVAILABLE" || this.state.authStatus === "OFFLINE_AUTHENTICATED" || !this.connectivity.online) return;
    try {
      const device = await this.devices.ensureAuthorized();
      if (device.status === "authorized") {
        const me = await this.api.get<{ license: { status: "active" | "inactive" } }>("/me");
        this.state.licenseStatus = me.license.status;
        if (me.license.status === "active" && this.state.currentUser) {
          console.info(JSON.stringify({ event: "USER_LOADED" }));
          this.configureLocalLibrary(this.state.currentUser.id);
          await this.hydrateLibrary();
        }
        else {
          throw new ApiError(403, "LICENSE_REQUIRED", "Esta conta não possui uma licença ativa.");
        }
      }
    } catch (error) {
      if (error instanceof ApiError && error.code === "DEVICE_REVOKED") {
        throw new ApiError(403, "DEVICE_REVOKED", "Este aparelho foi revogado. Entre novamente em um aparelho autorizado.");
      }
      throw error instanceof ApiError ? error : new ApiError(500, "DEVICE_VALIDATION_FAILED", "Não foi possível validar este aparelho.");
    }
  }

  private async hydrateLibrary(allowRemote = true): Promise<void> {
    const files=this.localFileStore(),folder=new DesktopLibraryFolderService(this.database),manager=new PersistentLibraryManager(this.books,files,this.limaDocuments,undefined,folder),restored=await new LibraryBootstrapService(this.genres,manager).restore();
    const localPreferences = await this.preferences.load();
    // A remote metadata failure must never hide a valid local library or end a
    // session. It will reconcile on the next authenticated online boot.
    const remote = allowRemote ? await this.accountPersistence.load().catch(() => null) : null;
    const preferences = remote?.preferences ?? localPreferences;
    const genres = [...restored.genres];
    for (const item of preferences?.genres ?? []) {
      if (genres.some((genre) => genre.id === item.id)) continue;
      const genre = new Genre(item.id, item.name); await this.genres.save(genre); genres.push(genre);
    }
    const byId = new Map(restored.books.map(book => [book.id, book]));
    const reviews = new ReadingReviewRepository(this.database), userId = this.state.currentUser?.id;
    for (const item of remote?.books ?? []) {
      const remoteBook = this.remoteBook(item); if (!remoteBook) continue;
      const remoteGenre = this.remoteGenre(item);
      if (remoteGenre && !genres.some((genre) => genre.id === remoteGenre.id)) {
        await this.genres.save(remoteGenre); genres.push(remoteGenre);
      }
      const localBook = byId.get(item.bookId) ?? [...byId.values()].find(book => book.catalogBookId === item.bookId);
      const usesRemoteState = !localBook || remoteBook.updatedAt > localBook.updatedAt;
      const book = usesRemoteState ? this.mergeRemoteBook(remoteBook, localBook) : localBook;
      if (book !== localBook) await this.books.save(book);
      byId.set(book.id, book);
      const review = userId ? this.remoteReview(item, userId, book.id) : null;
      if (review) { const localReview = await reviews.get(userId!, book.id); if (!localReview || Date.parse(review.updatedAt) > Date.parse(localReview.updatedAt)) await reviews.save(review); }
      if (usesRemoteState) await this.restoreRemoteProgress(book);
    }
    const books = [...byId.values()];
    this.state.library.replaceGenres(genres); this.state.library.replaceBooks(books);
    this.state.onboardingCompleted = preferences?.onboardingCompleted ?? genres.length > 0;
    if (preferences) { this.state.settings.theme = preferences.theme; this.applyTheme(preferences.theme); await this.preferences.save(preferences); }
    this.state.notify();
    console.info(JSON.stringify({ event: "LIBRARY_RESTORED", books: books.length }));
    // Offline writes are retained in local metadata. A successful authenticated
    // startup/reconnect retries them without ever uploading the original file.
    if (allowRemote) void this.syncLocalLibrary();
  }

  private configureLocalLibrary(userId: string): void {
    this.database = new IndexedDbService(`lumeo-library-${userId}`);
    this.books = new BookRepository(this.database); this.genres = new GenreRepository(this.database);
    this.files = new BookFileRepository(this.database); this.progress = new ReadingProgressRepository(this.database);
    this.collections = new CollectionRepository(this.database);
    this.limaDocuments=new LimaDocumentRepository(this.database);
    this.preferences = new UserLibraryPreferencesRepository(this.database);
    this.imports = this.createImportManager();
    this.libraryService = this.createLibraryService();
    this.readerSettings = new ReaderSettingsManager(this.storage);
    this.readerManager = new ReaderManager(this.books, this.localFileStore(),
      new ReadingProgressService(this.progress, this.books), this.readerSettings,this.limaDocuments);
  }

  private async finishOnboarding(): Promise<void> {
    const preferences = this.preferences.fromState(true, this.state.settings.theme, this.state.genres);
    await Promise.all([Promise.all(this.state.genres.map((genre) => this.genres.save(genre))),
      this.preferences.save(preferences), this.storage.save("theme", this.state.settings.theme)]);
    void this.persistPreferences(preferences).catch(() => undefined);
    this.applyTheme(this.state.settings.theme); this.router.navigate("home");
  }

  private createImportManager(): ImportManager {
    const local = new LocalFileImporter(); const drive = new GoogleDriveImporter(this.driveConfig, local);
    return new ImportManager(local, this.books, this.localFileStore(), drive, new UrlImporter(local, undefined, drive),this.limaDocuments,new DesktopLibraryFolderService(this.database),new LibraryChecksumRepository(this.database));
  }

  private createLibraryService(): LibraryService {
    return new LibraryService(this.books, this.localFileStore(), this.progress, [
      this.limaDocuments,
      new LibraryChecksumRepository(this.database),
      new HighlightRepository(this.database),
      new AnnotationRepository(this.database),
      new BookmarkRepository(this.database),
      new ChapterStudySheetRepository(this.database),
      new ReadingReviewRepository(this.database),
    ]);
  }

  private localFileStore(): LocalBookFileStore { return new LocalBookFileStore(this.files, this.state.currentUser?.id); }

  private async addBook(book: Book): Promise<void> {
    this.state.library.addBook(book); this.state.notify();
    void this.persistRemoteBook(book).catch(() => undefined);
    void new StoragePersistenceService().requestAfterImport();
    this.router.navigate("book", { id: book.id }); this.showToast("Livro adicionado à biblioteca.");
  }

  private async prepareCatalogDownload(catalogBook: CatalogBookData, link: CatalogDownloadLink): Promise<void> {
    const folders = new FileSystemFolderManager(this.database);
    await folders.savePending({ bookId: catalogBook.bookId, driveFileId: link.driveFileId, title: link.title, author: link.author,
      format: link.format, expectedFilename: link.expectedFilename, coverUrl: link.coverUrl ?? null, catalogGenre: link.genreName, sha256: link.sha256 ?? null });
  }

  private async addCatalogBook(catalogBook: CatalogBookData, link: CatalogDownloadLink, progress: (stage: CatalogImportStage, percent?: number | null) => void, signal?: AbortSignal, downloadedFile?: File): Promise<string | null> {
    const local = this.state.books.find((book) => book.catalogBookId === catalogBook.bookId);
    if (local?.availability === "AVAILABLE") { this.router.navigate("reader", { id: local.id }); return local.id; }
    if (local) {
      // A remote metadata placeholder is intentionally retained after logout
      // or a device change. Replace only that placeholder when bytes return.
      await this.libraryService.deleteBook(local.id);
      this.state.library.removeBook(local.id);
    }
    const file = downloadedFile ?? await new FileSystemFolderManager(this.database).selectDownloadedBook();
    if (!file) return null;
    // Every source reaches the same confirmation step. The cover comes from
    // the actual file before the user commits title, author and genre.
    const extractedCover = await this.covers.fromBookFile(file, link.format, catalogBook.title);
    const confirmed = await new CatalogGenreDialog(this.state, catalogBook).open(extractedCover);
    if (!confirmed) return null;
    let genre = this.state.genres.find((item) => item.id === confirmed.genreId);
    if (!genre) { genre = new Genre(confirmed.genreId || crypto.randomUUID(), confirmed.genreName || "Sem gênero"); await this.genres.save(genre); this.state.library.addGenre(genre); }
    let collectionId: string | undefined;
    if (confirmed.collection) {
      const collection = await this.collections.findByName(confirmed.collection);
      if (collection) collectionId = collection.id;
      else { const created = new Collection(crypto.randomUUID(), confirmed.collection, "custom"); await this.collections.save(created); collectionId = created.id; }
    }
    const coordinator = new CatalogImportCoordinator(this.imports, this.covers);
    this.logCatalogImport("IMPORT_STARTED", { bookId: catalogBook.bookId, format: link.format });
    let saved: Book;
    const remoteCopy = this.state.books.find(item => item.catalogBookId === catalogBook.bookId && item.availability !== "AVAILABLE");
    try { saved = await coordinator.addDownloadedFile({ ...confirmed, genreId: genre.id }, link, file, progress, signal, extractedCover, remoteCopy?.id); }
    catch (error) {
      reportNativeDownloadDiagnostic("IMPORT_FAILED", { bookId: catalogBook.bookId, errorCode: error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : "IMPORT_FAILED", exceptionClass: error instanceof Error ? error.constructor.name : "Unknown" });
      throw error;
    }
    this.logCatalogImport("IMPORT_COMPLETED", { bookId: catalogBook.bookId, localBookId: saved.id });
    // Catalog collection metadata is optional; ImportManager already saved the original file,
    // cover and LIMA document locally. Keep library state authoritative for the shelf.
    const libraryBook = collectionId ? new Book({ ...saved, collectionId }) : saved;
    if (collectionId) {
      await this.libraryService.saveBook(libraryBook); this.state.library.addBook(libraryBook);
    } else this.state.library.addBook(saved);
    // Mirror lightweight metadata before announcing success. The original file
    // and its extracted cover remain local and never go to the backend.
    const accountPreferences = this.preferences.fromState(this.state.onboardingCompleted, this.state.settings.theme, this.state.genres);
    await this.preferences.save(accountPreferences);
    await Promise.all([
      this.persistRemoteBook(libraryBook),
      this.persistPreferences(accountPreferences),
    ]).catch(() => undefined);
    this.logCatalogImport("LIBRARY_REGISTERED", { bookId: catalogBook.bookId, localBookId: saved.id });
    this.state.notify(); void new StoragePersistenceService().requestAfterImport(); this.showToast(I18nManager.shared.t("ui.catalog.complete"));
    if (!downloadedFile) this.router.navigate("library");
    return saved.id;
  }

  private async updateBook(book: Book): Promise<void> {
    await this.libraryService.saveBook(book);
    this.state.library.replaceBooks(this.state.books.map((item) => item.id === book.id ? book : item));
    void this.persistRemoteBook(book).catch(() => undefined);
    this.state.notify(); this.router.navigate("book", { id: book.id }); this.showToast("Livro atualizado.");
  }

  private syncBook(book: Book): void {
    this.state.library.replaceBooks(this.state.books.map((item) => item.id === book.id ? book : item));
    // Reader progress updates the Book record asynchronously. Mirror only its
    // lightweight metadata; the file, annotations and highlights stay local.
    void this.persistRemoteBook(book).catch(() => undefined);
    this.state.notify();
  }

  private async deleteBook(id: string, navigate = true): Promise<void> {
    const book = this.findBook(id);
    await this.libraryService.deleteBook(id);
    void this.persistRemoteDelete(book?.catalogBookId ?? id).catch(() => undefined);
    this.state.library.removeBook(id); this.state.notify(); if(navigate)this.router.navigate("library"); this.showToast("Livro e arquivo removidos.");
  }
  private async locateBookFile(id:string):Promise<void>{const book=this.findBook(id);if(!book)return;const input=document.createElement("input");input.type="file";input.accept=book.fileType==="pdf"?"application/pdf,.pdf":"application/epub+zip,.epub";input.addEventListener("change",async()=>{const file=input.files?.[0];if(!file)return;try{const imported=await new LocalFileImporter().import(file);if(imported.fileType!==book.fileType)throw new Error("Selecione o mesmo formato do livro.");await this.localFileStore().save(book.id,file);await new LimaConversionManager(this.limaDocuments,this.books).convert(book,file);book.availability=book.conversionStatus==="failed"?"INVALID_FILE":"AVAILABLE";await this.books.save(book);this.syncBook(book);this.router.navigate("book",{id});this.showToast("Arquivo local restaurado.");}catch(error){this.showToast(error instanceof Error?error.message:"Não foi possível localizar o arquivo.");}});input.click();}

  private findBook(id: string | null): Book | null { return id ? this.state.library.findBookById(id) ?? null : null; }

  private openLibraryBook(id: string): void {
    const book = this.findBook(id);
    if (!book) return;
    if (book.availability !== "AVAILABLE") {
      if (book.catalogBookId) this.router.navigate("catalog-book", { id: book.catalogBookId });
      else this.router.navigate("book", { id });
      return;
    }
    this.router.navigate("reader", { id });
  }

  private guardRoute(route: RouteName): RouteName {
    const publicRoutes: readonly RouteName[] = ["login", "register", "privacy"];
    if (route === "privacy") return route;
    if (!this.isAuthenticated()) return publicRoutes.includes(route) ? route : "login";
    if (this.state.deviceStatus === "conflict") return route === "login" ? "login" : "device-conflict";
    if (this.state.deviceStatus !== "authorized" || !this.hasUsableLicense()) return "login";
    if (publicRoutes.includes(route)) return this.nextProtectedRoute();
    if (!this.state.onboardingCompleted && route !== "onboarding") return "onboarding";
    return route;
  }

  private nextProtectedRoute(): RouteName {
    if (this.state.deviceStatus === "conflict") return "device-conflict";
    return this.state.onboardingCompleted ? "home" : "onboarding";
  }

  private async restoreTheme(): Promise<void> {
    const stored = await this.storage.load<"light" | "dark">("theme");
    if (stored === "light" || stored === "dark") this.state.settings.theme = stored;
    this.applyTheme(this.state.settings.theme);
  }

  private async changeTheme(theme: "light" | "dark"): Promise<void> {
    this.state.settings.theme = theme; this.applyTheme(theme); await this.storage.save("theme", theme);
    if (this.state.currentUser) {
      const preferences = this.preferences.fromState(this.state.onboardingCompleted, theme, this.state.genres);
      await this.preferences.save(preferences); void this.persistPreferences(preferences).catch(() => undefined);
    }
    this.state.notify();
  }

  private applyTheme(theme: "light" | "dark"): void { document.documentElement.dataset.theme = theme; }
  private userName(): string {
    const raw = this.state.currentUser?.displayName?.trim() || this.state.currentUser?.email.split("@")[0]?.replace(/[._-]+/g, " ").trim() || "Leitor";
    return raw.charAt(0).toLocaleUpperCase() + raw.slice(1);
  }

  private renderHeader(): void {
    this.headerView?.unmount();
    this.headerView = new HeaderView((route) => this.router.navigate(route),
      this.isAuthenticated() && this.state.deviceStatus === "authorized",
      this.userName(), () => void this.logout());
    this.headerView.mount(this.headerRoot);
    const authenticated = this.isAuthenticated() && this.state.deviceStatus === "authorized";
    this.footerRoot.replaceChildren(...(authenticated ? [new MobileBottomNavigation((route)=>this.router.navigate(route)).render()] : []));
    I18nManager.shared.localizeTree(this.footerRoot);
  }

  private isAuthenticated(): boolean { return ["authenticated", "AUTHENTICATED", "OFFLINE_AUTHENTICATED", "OFFLINE_SESSION_AVAILABLE", "OFFLINE_READY", "SESSION_RESTORED", "USER_DATA_LOADING", "READY", "ONLINE_READY"].includes(this.state.authStatus); }
  private hasUsableLicense(): boolean { return this.state.licenseStatus === "active" || this.state.licenseStatus === "offline_grace" || this.state.licenseStatus === "grace"; }

  private async logout(): Promise<void> {
    // Sign-out invalidates only the remote session. OPFS, IndexedDB and the
    // per-user library database are intentionally retained for offline use.
    await this.auth.logout(); this.state.library.replaceBooks([]); this.state.library.replaceGenres([]); this.state.onboardingCompleted = false; this.state.notify(); this.router.navigate("login");
  }
  private persistRemoteBook(book: Book): Promise<void> {
    const userId = this.state.currentUser?.id; if (!userId) return Promise.resolve();
    return new ReadingReviewRepository(this.database).get(userId, book.id)
      .then(review => this.syncOutbox().enqueueBook(book, this.state.genres.find((genre) => genre.id === book.genreId), review))
      .then(() => this.connectivity.online ? this.syncOutbox().flush() : undefined)
      .then(() => { if (this.connectivity.online) this.connectivity.markReconnected(); });
  }
  private persistRemoteDelete(bookId: string): Promise<void> { return this.syncOutbox().enqueueDelete(bookId).then(() => this.connectivity.online ? this.syncOutbox().flush() : undefined); }
  private persistPreferences(preferences: Parameters<SyncOutbox["enqueuePreferences"]>[0]): Promise<void> { return this.syncOutbox().enqueuePreferences(preferences).then(() => this.connectivity.online ? this.syncOutbox().flush() : undefined); }
  private syncOutbox(): SyncOutbox { return new SyncOutbox(new SyncOutboxRepository(this.database), this.accountPersistence, this.state.currentUser?.id ?? "anonymous"); }
  private async syncLocalLibrary(): Promise<void> {
    if (!this.state.currentUser || !this.connectivity.online) return;
    await Promise.all(this.state.books.map(async book => {
      const review = await new ReadingReviewRepository(this.database).get(this.state.currentUser!.id, book.id);
      await this.syncOutbox().enqueueBook(book, this.state.genres.find(genre => genre.id === book.genreId), review);
    })).then(() => this.syncOutbox().flush()).then(() => this.connectivity.markReconnected()).catch(() => undefined);
  }
  private remoteBook(item: RemoteLibraryBook): Book | null {
    const data = item.metadata; const text = (key: string): string | null => typeof data[key] === "string" && (data[key] as string).trim() ? (data[key] as string).trim() : null;
    const title = text("title"), author = text("author"), genreId = text("genreId"), fileType = text("fileType");
    if (!title || !author || !genreId || (fileType !== "pdf" && fileType !== "epub")) return null;
    const number = (key: string): number => typeof data[key] === "number" && Number.isFinite(data[key]) ? data[key] as number : 0;
    const cover = text("cover")?.startsWith("https://") ? text("cover")! : this.covers.placeholder(title, fileType);
    return new Book({ id: item.bookId, title, author, genreId, cover, fileType, fileName: text("fileName") ?? `${title}.${fileType}`,
      fileSize: number("fileSize"), mimeType: text("mimeType") ?? (fileType === "pdf" ? "application/pdf" : "application/epub+zip"),
      readingStatus: data.readingStatus === "finished" ? "finished" : data.readingStatus === "reading" ? "reading" : "unread",
      progressPercent: number("progressPercent"), currentLocation: text("currentLocation") ?? undefined, collectionId: text("collectionId") ?? undefined,
      volume: text("volume") ?? undefined, series: text("series") ?? undefined, description: text("description") ?? undefined,
      publicationYear: number("publicationYear") || undefined, catalogBookId: text("catalogBookId") ?? undefined,
      source: data.source === "catalog" || data.source === "google-drive" || data.source === "onedrive" || data.source === "url" ? data.source : "device",
      createdAt: text("addedAt") ? new Date(text("addedAt")!) : new Date(item.updatedAt), updatedAt: new Date(item.updatedAt),
      availability: "MISSING_FILE", offlineAvailability: "REMOTE_ONLY" });
  }
  private mergeRemoteBook(remote: Book, local: Book | undefined): Book {
    if (!local) return remote;
    return new Book({ ...remote, id: local.id, cover: local.cover || remote.cover, availability: local.availability, offlineAvailability: local.offlineAvailability,
      conversionStatus: local.conversionStatus, documentMode: local.documentMode, textCapability: local.textCapability, limaCapability: local.limaCapability });
  }
  private remoteReview(item: RemoteLibraryBook, userId: string, localBookId: string) {
    const value = item.metadata.review; if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const review = value as Record<string, unknown>, rating = review.rating;
    if (!Number.isInteger(rating) || Number(rating) < 1 || Number(rating) > 5 || typeof review.updatedAt !== "string" || !Number.isFinite(Date.parse(review.updatedAt))) return null;
    return { userId, bookId: localBookId, rating: Number(rating) as 1|2|3|4|5, comment: typeof review.comment === "string" ? review.comment.slice(0, 500) : undefined,
      createdAt: typeof review.createdAt === "string" && Number.isFinite(Date.parse(review.createdAt)) ? review.createdAt : review.updatedAt, updatedAt: review.updatedAt };
  }
  private async restoreRemoteProgress(book: Book): Promise<void> {
    const location = book.currentLocation; if (!location) return;
    const currentPage = /^\d+$/.test(location) ? Math.max(1, Number(location)) : 1;
    const totalPages = Math.max(currentPage, book.progressPercent ? Math.round(currentPage * 100 / book.progressPercent) : 1);
    await this.progress.save({ bookId: book.id, currentPage, totalPages, currentLocation: location, progressPercent: book.progressPercent ?? 0, updatedAt: book.updatedAt.toISOString() });
  }
  private remoteGenre(item: RemoteLibraryBook): Genre | null {
    const genreId = typeof item.metadata.genreId === "string" ? item.metadata.genreId.trim() : "";
    const name = typeof item.metadata.genreName === "string" ? item.metadata.genreName.trim() : "";
    return genreId ? new Genre(genreId, name || "Sem gênero") : null;
  }
  private showToast(message: string): void {
    const root = document.querySelector<HTMLElement>("#toast-root"); if (!root) return;
    root.textContent = message; root.className = "toast toast--visible";
    window.setTimeout(() => { root.className = "toast"; }, 5000);
  }
  private logCatalogImport(stage: string, details: Record<string, unknown>): void { reportNativeDownloadDiagnostic(stage, details); }
}
