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
import { ConnectivityManager } from "../pwa/ConnectivityManager";
import { PwaInstallManager } from "../pwa/PwaInstallManager";
import { LimaDocumentRepository } from "../repositories/LimaDocumentRepository";
import { LimaConversionManager } from "../lima/LimaConversionManager";
import { LibraryChecksumRepository } from "../repositories/LibraryChecksumRepository";
import { HighlightRepository } from "../repositories/HighlightRepository";
import { AnnotationRepository } from "../repositories/AnnotationRepository";
import { BookmarkRepository } from "../repositories/BookmarkRepository";
import { ChapterStudySheetRepository } from "../repositories/ChapterStudySheetRepository";
import { BookDetailsView } from "../views/BookDetailsView";
import { BookEditView } from "../views/BookEditView";
import { BookImportView } from "../views/BookImportView";
import { DeviceConflictView } from "../views/DeviceConflictView";
import { GenreView } from "../views/GenreView";
import { HeaderView } from "../views/HeaderView";
import { HomeView } from "../views/HomeView";
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
  private readonly metadataExtractor = new BookMetadataExtractor();
  private readonly covers = new CoverService();
  private readonly driveConfig: GoogleDriveConfig = { clientId: import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "",
    apiKey: import.meta.env.VITE_GOOGLE_API_KEY ?? "", appId: import.meta.env.VITE_GOOGLE_APP_ID ?? "" };
  private imports = this.createImportManager();
  private libraryService = this.createLibraryService();
  private readerSettings = new ReaderSettingsManager(this.storage);
  private readerManager = new ReaderManager(this.books, new LocalBookFileStore(this.files),
    new ReadingProgressService(this.progress, this.books), this.readerSettings,this.limaDocuments);
  private readonly api = new ApiClient(new EnvironmentConfig().read().bffBaseUrl);
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
    this.connectivity.subscribe((status)=>{if(status==="OFFLINE")this.showToast(I18nManager.shared.t("offline.status"));if(status==="RECONNECTING")this.showToast(I18nManager.shared.t("offline.reconnecting"));});
    await this.devices.initialize();
    await this.auth.initialize();
    if (this.state.authStatus === "authenticated" || this.state.authStatus === "AUTHENTICATED") {
      try { await this.resolveDevice(); }
      catch (error) { this.showToast(error instanceof ApiError ? error.message : "Não foi possível restaurar sua sessão."); }
    }
    this.router.start(this.isAuthenticated() ? this.nextProtectedRoute() : "login");
  }

  private registerRoutes(): void {
    this.router.register("login", () => new LoginView(this.auth, () => this.afterAuthentication(), () => this.router.navigate("register")));
    this.router.register("register", () => new RegisterView(this.auth, () => this.afterAuthentication(), () => this.router.navigate("login")));
    this.router.register("device-conflict", () => new DeviceConflictView(
      this.state, this.auth, this.devices, () => void this.afterAuthentication(), () => void this.logout(),
    ));
    this.router.register("onboarding", () => new OnboardingView(this.state, this.userName(), () => void this.finishOnboarding()));
    this.router.register("home", () => new HomeView(this.state, this.userName(),
      () => this.router.navigate("library"), () => this.router.navigate("import")));
    this.router.register("library", () => new LibraryView(this.state,
      (genreId) => this.router.navigate("genre", { id: genreId }), (bookId) => this.router.navigate("reader", { id: bookId }), (bookId) => void this.deleteBook(bookId, false)));
    this.router.register("explore", () => new CatalogExplorerView(this.catalog, this.state, (bookId) => this.router.navigate("catalog-book", { id: bookId })));
    this.router.register("catalog-book", (params) => new CatalogBookView(this.catalog, this.state, params.get("id") ?? "",
      () => this.router.navigate("explore"), (bookId) => this.router.navigate("reader", { id: bookId }),
      (book, link) => this.prepareCatalogDownload(book, link),
      (book, link, progress, signal) => this.addCatalogBook(book, link, progress, signal), this.catalogDownloads));
    this.router.register("catalog-admin", () => new CatalogAdminView(this.catalog, () => this.router.navigate("explore")));
    this.router.register("genre", (params) => new GenreView(this.state, params.get("id") ?? "",
      () => this.router.navigate("library"), (bookId) => this.router.navigate("reader", { id: bookId })));
    this.router.register("import", (params) => {
      const storage = new ExternalLibraryStorage(this.database);
      const connections = new OneDriveConnections(storage, this.state.currentUser!.id);
      const coordinator = new OneDriveImportCoordinator(connections.downloads, this.imports, this.metadataExtractor, this.covers, new OperationRecoveryJournal(storage));
      return new BookImportView(this.state, this.imports, this.genres, this.collections, this.covers, this.metadataExtractor,
        (book) => void this.addBook(book), () => this.router.navigate("library"), (bookId) => this.deleteBook(bookId, false),
        { connections, coordinator, initialSourceId: params.get("source") ?? undefined, openExisting: id => this.router.navigate("reader", { id }) });
    });
    this.router.register("book", (params) => this.detailsView(params.get("id") ?? ""));
    this.router.register("edit-book", (params) => new BookEditView(this.state, this.findBook(params.get("id")), this.genres, this.covers,
      (book) => void this.updateBook(book), () => this.router.navigate("book", { id: params.get("id") ?? "" })));
    this.router.register("reader", (params) => new ReaderView(params.get("id") ?? "", this.readerManager,
      this.state.settings.theme, () => this.router.navigate("library"), (book) => this.syncBook(book), this.database));
    this.router.register("settings", () => new SettingsView(this.state, (theme) => void this.changeTheme(theme),new StoragePersistenceService(),new DesktopLibraryFolderService(this.database),
      this.state.currentUser ? { connections: new OneDriveConnections(new ExternalLibraryStorage(this.database), this.state.currentUser.id),
        open: source => this.router.navigate("import", { source }) } : undefined, this.pwaInstall));
  }

  private detailsView(id: string): BookDetailsView {
    const book = this.findBook(id);
    const genre = book ? this.state.genres.find((item) => item.id === book.genreId) ?? null : null;
    return new BookDetailsView(book, genre, () => this.router.navigate("reader", { id }),
      () => this.router.navigate("edit-book", { id }), () => void this.deleteBook(id), () => this.router.navigate("library"),()=>void this.locateBookFile(id));
  }

  private async afterAuthentication(): Promise<void> {
    await this.resolveDevice();
    if (!this.isAuthenticated()) {
      throw new ApiError(403, "LICENSE_REQUIRED", "Esta conta não possui uma licença ativa.");
    }
    this.router.navigate(this.nextProtectedRoute());
  }

  private async resolveDevice(): Promise<void> {
    try {
      const device = await this.devices.ensureAuthorized();
      if (device.status === "authorized") {
        const me = await this.api.get<{ license: { status: "active" | "inactive" } }>("/me");
        this.state.licenseStatus = me.license.status;
        if (me.license.status === "active" && this.state.currentUser) {
          this.configureLocalLibrary(this.state.currentUser.id);
          await this.hydrateLibrary();
        }
        else {
          await this.auth.logout();
          throw new ApiError(403, "LICENSE_REQUIRED", "Esta conta não possui uma licença ativa.");
        }
      }
    } catch (error) {
      if (error instanceof ApiError && error.code === "DEVICE_REVOKED") {
        await this.auth.logout();
        throw new ApiError(403, "DEVICE_REVOKED", "Este aparelho foi revogado. Entre novamente em um aparelho autorizado.");
      }
      throw error instanceof ApiError ? error : new ApiError(500, "DEVICE_VALIDATION_FAILED", "Não foi possível validar este aparelho.");
    }
  }

  private async hydrateLibrary(): Promise<void> {
    const files=new LocalBookFileStore(this.files),folder=new DesktopLibraryFolderService(this.database),manager=new PersistentLibraryManager(this.books,files,this.limaDocuments,undefined,folder),restored=await new LibraryBootstrapService(this.genres,manager).restore();
    this.state.library.replaceGenres(restored.genres); this.state.library.replaceBooks(restored.books);
    this.state.onboardingCompleted = restored.genres.length > 0; this.state.notify();
  }

  private configureLocalLibrary(userId: string): void {
    this.database = new IndexedDbService(`lumeo-library-${userId}`);
    this.books = new BookRepository(this.database); this.genres = new GenreRepository(this.database);
    this.files = new BookFileRepository(this.database); this.progress = new ReadingProgressRepository(this.database);
    this.collections = new CollectionRepository(this.database);
    this.limaDocuments=new LimaDocumentRepository(this.database);
    this.imports = this.createImportManager();
    this.libraryService = this.createLibraryService();
    this.readerSettings = new ReaderSettingsManager(this.storage);
    this.readerManager = new ReaderManager(this.books, new LocalBookFileStore(this.files),
      new ReadingProgressService(this.progress, this.books), this.readerSettings,this.limaDocuments);
  }

  private async finishOnboarding(): Promise<void> {
    await Promise.all([Promise.all(this.state.genres.map((genre) => this.genres.save(genre))),
      this.storage.save("theme", this.state.settings.theme)]);
    this.applyTheme(this.state.settings.theme); this.router.navigate("home");
  }

  private createImportManager(): ImportManager {
    const local = new LocalFileImporter(); const drive = new GoogleDriveImporter(this.driveConfig, local);
    return new ImportManager(local, this.books, new LocalBookFileStore(this.files), drive, new UrlImporter(local, undefined, drive),this.limaDocuments,new DesktopLibraryFolderService(this.database),new LibraryChecksumRepository(this.database));
  }

  private createLibraryService(): LibraryService {
    return new LibraryService(this.books, new LocalBookFileStore(this.files), this.progress, [
      this.limaDocuments,
      new LibraryChecksumRepository(this.database),
      new HighlightRepository(this.database),
      new AnnotationRepository(this.database),
      new BookmarkRepository(this.database),
      new ChapterStudySheetRepository(this.database),
    ]);
  }

  private async addBook(book: Book): Promise<void> {
    this.state.library.addBook(book); this.state.notify();
    void new StoragePersistenceService().requestAfterImport();
    this.router.navigate("book", { id: book.id }); this.showToast("Livro adicionado à biblioteca.");
  }

  private async prepareCatalogDownload(catalogBook: CatalogBookData, link: CatalogDownloadLink): Promise<void> {
    const folders = new FileSystemFolderManager(this.database);
    await folders.savePending({ bookId: catalogBook.bookId, driveFileId: link.driveFileId, title: link.title, author: link.author,
      format: link.format, expectedFilename: link.expectedFilename, coverUrl: link.coverUrl ?? null, catalogGenre: link.genreName, sha256: link.sha256 ?? null });
  }

  private async addCatalogBook(catalogBook: CatalogBookData, link: CatalogDownloadLink, progress: (stage: CatalogImportStage, percent?: number | null) => void, signal?: AbortSignal): Promise<void> {
    const local = this.state.books.find((book) => book.catalogBookId === catalogBook.bookId);
    if (local) { this.router.navigate("reader", { id: local.id }); return; }
    const folders = new FileSystemFolderManager(this.database);
    const file = await folders.selectDownloadedBook();
    if (!file) return;
    const confirmed = await new CatalogGenreDialog(this.state, catalogBook).open();
    if (!confirmed) return;
    let genre = this.state.genres.find((item) => item.id === confirmed.genreId);
    if (!genre) { genre = new Genre(confirmed.genreId || crypto.randomUUID(), confirmed.genreName || "Sem gênero"); await this.genres.save(genre); this.state.library.addGenre(genre); }
    let collectionId: string | undefined;
    if (confirmed.collection) {
      const collection = await this.collections.findByName(confirmed.collection);
      if (collection) collectionId = collection.id;
      else { const created = new Collection(crypto.randomUUID(), confirmed.collection, "custom"); await this.collections.save(created); collectionId = created.id; }
    }
    const coordinator = new CatalogImportCoordinator(this.imports, this.covers);
    const saved = await coordinator.addDownloadedFile({ ...confirmed, genreId: genre.id }, link, file, progress, signal);
    // Catalog collection metadata is optional; ImportManager already saved the original file,
    // cover and LIMA document locally. Keep library state authoritative for the shelf.
    if (collectionId) {
      const adjusted = new Book({ ...saved, collectionId }); await this.libraryService.saveBook(adjusted); this.state.library.addBook(adjusted);
    } else this.state.library.addBook(saved);
    this.state.notify(); void new StoragePersistenceService().requestAfterImport(); this.showToast(I18nManager.shared.t("ui.catalog.complete"));
    this.router.navigate("library");
  }

  private async updateBook(book: Book): Promise<void> {
    await this.libraryService.saveBook(book);
    this.state.library.replaceBooks(this.state.books.map((item) => item.id === book.id ? book : item));
    this.state.notify(); this.router.navigate("book", { id: book.id }); this.showToast("Livro atualizado.");
  }

  private syncBook(book: Book): void {
    this.state.library.replaceBooks(this.state.books.map((item) => item.id === book.id ? book : item)); this.state.notify();
  }

  private async deleteBook(id: string, navigate = true): Promise<void> {
    await this.libraryService.deleteBook(id);
    this.state.library.removeBook(id); this.state.notify(); if(navigate)this.router.navigate("library"); this.showToast("Livro e arquivo removidos.");
  }
  private async locateBookFile(id:string):Promise<void>{const book=this.findBook(id);if(!book)return;const input=document.createElement("input");input.type="file";input.accept=book.fileType==="pdf"?"application/pdf,.pdf":"application/epub+zip,.epub";input.addEventListener("change",async()=>{const file=input.files?.[0];if(!file)return;try{const imported=await new LocalFileImporter().import(file);if(imported.fileType!==book.fileType)throw new Error("Selecione o mesmo formato do livro.");await new LocalBookFileStore(this.files).save(book.id,file);await new LimaConversionManager(this.limaDocuments,this.books).convert(book,file);book.availability=book.conversionStatus==="failed"?"INVALID_FILE":"AVAILABLE";await this.books.save(book);this.syncBook(book);this.router.navigate("book",{id});this.showToast("Arquivo local restaurado.");}catch(error){this.showToast(error instanceof Error?error.message:"Não foi possível localizar o arquivo.");}});input.click();}

  private findBook(id: string | null): Book | null { return id ? this.state.library.findBookById(id) ?? null : null; }

  private guardRoute(route: RouteName): RouteName {
    const publicRoutes: readonly RouteName[] = ["login", "register"];
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
    this.state.settings.theme = theme; this.applyTheme(theme); await this.storage.save("theme", theme); this.state.notify();
  }

  private applyTheme(theme: "light" | "dark"): void { document.documentElement.dataset.theme = theme; }
  private userName(): string {
    const raw = this.state.currentUser?.email.split("@")[0]?.replace(/[._-]+/g, " ").trim() || "Leitor";
    return raw.charAt(0).toLocaleUpperCase() + raw.slice(1);
  }

  private renderHeader(): void {
    this.headerView?.unmount();
    this.headerView = new HeaderView((route) => this.router.navigate(route),
      this.isAuthenticated() && this.state.deviceStatus === "authorized",
      this.userName(), () => void this.logout());
    this.headerView.mount(this.headerRoot);
    this.footerRoot.replaceChildren(...(this.isAuthenticated() && this.state.deviceStatus === "authorized"
      ? [new MobileBottomNavigation((route)=>this.router.navigate(route)).render()] : []));
    I18nManager.shared.localizeTree(this.footerRoot);
  }

  private isAuthenticated(): boolean { return this.state.authStatus === "authenticated" || this.state.authStatus === "AUTHENTICATED" || this.state.authStatus === "OFFLINE_AUTHENTICATED"; }
  private hasUsableLicense(): boolean { return this.state.licenseStatus === "active" || this.state.licenseStatus === "offline_grace" || this.state.licenseStatus === "grace"; }

  private async logout(): Promise<void> {
    await this.auth.logout(); this.state.library.replaceBooks([]); this.state.library.replaceGenres([]);
    this.state.onboardingCompleted = false; this.state.notify(); this.router.navigate("login");
  }
  private showToast(message: string): void {
    const root = document.querySelector<HTMLElement>("#toast-root"); if (!root) return;
    root.textContent = message; root.className = "toast toast--visible";
    window.setTimeout(() => { root.className = "toast"; }, 5000);
  }
}
