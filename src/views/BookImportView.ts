import type { ImportedFile } from "../importers/BookImporter";
import { PickerCancelledError } from "../importers/GoogleDriveImporter";
import { FolderUrlError } from "../importers/UrlImporter";
import type { Book, ReadingStatus } from "../models/Book";
import { Genre } from "../models/Genre";
import { GenreRepository } from "../repositories/GenreRepository";
import { CollectionRepository } from "../repositories/CollectionRepository";
import { Collection } from "../models/Collection";
import { BookMetadataExtractor } from "../metadata/BookMetadataExtractor";
import type { Confidence } from "../metadata/MetadataTypes";
import { GenreSuggestionResolver } from "../metadata/GenreSuggestionResolver";
import { ApiError } from "../services/ApiClient";
import { CoverService } from "../services/CoverService";
import { DuplicateBookImportError, ImportManager } from "../services/ImportManager";
import type { AppState } from "../core/AppState";
import { BaseView } from "./BaseView";
import { I18nManager } from "../i18n/I18nManager";

export class BookImportView extends BaseView {
  private imported: ImportedFile | null = null;
  private automaticCover = "";
  private authorInput: HTMLInputElement | null = null; private genreSelect: HTMLSelectElement | null = null;
  private collectionSelect: HTMLSelectElement | null = null; private metadataNote: HTMLElement | null = null;
  private genreSuggestion: HTMLElement | null = null; private collectionSuggestion: HTMLElement | null = null;
  private readonly genreResolver = new GenreSuggestionResolver();
  public constructor(private readonly state: AppState, private readonly manager: ImportManager,
    private readonly genres: GenreRepository, private readonly collections: CollectionRepository, private readonly covers: CoverService,
    private readonly metadataExtractor: BookMetadataExtractor,
    private readonly onSaved: (book: Book) => void, private readonly onCancel: () => void, private readonly onReplaceExisting?: (bookId: string) => Promise<void>) { super(); }

  public render(): HTMLElement {
    const section = this.createElement("section", "page-shell import-page");
    const form = this.createElement("form", "import-card");
    form.append(this.createElement("span", "eyebrow", "Sua biblioteca"), this.createElement("h1", "page-title", "Adicionar livro"),
      this.createElement("p", "page-subtitle", "Escolha de onde deseja importar. O arquivo será salvo somente neste dispositivo."));
    const sourceChoices = this.createElement("div", "import-sources");
    const device = this.sourceButton("▣", "Do dispositivo", "PDF ou EPUB salvo neste aparelho");
    const drive = this.sourceButton("◆", "Google Drive", "Escolha um arquivo da sua conta");
    const link = this.sourceButton("↗", "Por link", "Use um endereço público compatível"); sourceChoices.append(device, drive, link);
    const file = this.input("Arquivo PDF ou EPUB", "file"); file.wrapper.classList.add("import-source-panel", "is-hidden"); file.input.required = false; file.input.accept = ".pdf,.epub,application/pdf,application/epub+zip";
    const urlPanel = this.createElement("div", "import-source-panel is-hidden");
    const urlLabel = this.createElement("label", "field"); urlLabel.append(this.createElement("span", "field__label", "Cole o link do arquivo"));
    const url = this.createElement("input", "input") as HTMLInputElement; url.type = "url"; url.placeholder = "https://.../livro.pdf"; urlLabel.append(url);
    const importUrl = this.createElement("button", "button button--secondary", "Importar link"); importUrl.type = "button"; urlPanel.append(urlLabel, importUrl);
    const download = this.createElement("p", "download-status"); download.setAttribute("role", "status");
    const metadataNote = this.createElement("p", "metadata-note"); metadataNote.setAttribute("role", "status"); this.metadataNote = metadataNote;
    const title = this.input("Título", "text"); const author = this.input("Autor", "text"); this.authorInput = author.input;
    const genreLabel = this.createElement("label", "field"); genreLabel.append(this.createElement("span", "field__label", "Gênero"));
    const genre = this.createElement("select", "input") as HTMLSelectElement; genre.required = true; this.genreSelect = genre; this.fillGenres(genre); genreLabel.append(genre);
    const genreSuggestion = this.createElement("div", "metadata-suggestion is-hidden"); this.genreSuggestion = genreSuggestion;
    const newGenreRow = this.createElement("div", "inline-form");
    const newGenre = this.createElement("input", "input") as HTMLInputElement; newGenre.placeholder = "Novo gênero"; newGenre.maxLength = 40;
    const createGenre = this.createElement("button", "button button--secondary", "+ Criar gênero"); createGenre.type = "button";
    createGenre.addEventListener("click", () => void this.createGenre(newGenre, genre)); newGenreRow.append(newGenre, createGenre);
    const collectionLabel = this.createElement("label", "field"); collectionLabel.append(this.createElement("span", "field__label", "Coleção (opcional)"));
    const collection = this.createElement("select", "input") as HTMLSelectElement; collection.append(new Option("Sem coleção", "")); this.collectionSelect = collection; collectionLabel.append(collection); void this.fillCollections(collection);
    const collectionSuggestion = this.createElement("div", "metadata-suggestion is-hidden"); this.collectionSuggestion = collectionSuggestion;
    const statusLabel = this.createElement("label", "field"); statusLabel.append(this.createElement("span", "field__label", "Status inicial"));
    const status = this.createElement("select", "input") as HTMLSelectElement;
    status.append(new Option("Não iniciado", "unread"), new Option("Lendo", "reading"), new Option("Concluído", "finished")); statusLabel.append(status);
    const coverPreview = this.createElement("div", "cover-preview is-hidden"); const coverImage = this.createElement("img", "") as HTMLImageElement; coverImage.alt = "Capa extraída do livro";
    const coverNote = this.createElement("span", "", "A capa será extraída automaticamente do arquivo."); coverPreview.append(coverImage, coverNote);
    const error = this.createElement("p", "form-error"); error.setAttribute("role", "alert");
    const actions = this.createElement("div", "form-actions");
    const save = this.createElement("button", "button button--primary", "Adicionar à biblioteca"); save.type = "submit";
    const cancel = this.createElement("button", "button button--secondary", "Cancelar"); cancel.type = "button"; cancel.addEventListener("click", this.onCancel); actions.append(save, cancel);
    file.input.addEventListener("change", () => void this.selectFile(file.input, title.input, error, download, coverPreview, coverImage));
    device.addEventListener("click", () => { file.wrapper.classList.remove("is-hidden"); urlPanel.classList.add("is-hidden"); file.input.click(); });
    drive.addEventListener("click", () => void this.selectDrive(title.input, error, download, coverPreview, coverImage));
    link.addEventListener("click", () => { urlPanel.classList.remove("is-hidden"); file.wrapper.classList.add("is-hidden"); url.focus(); });
    importUrl.addEventListener("click", () => void this.selectUrl(url.value, title.input, error, download, importUrl, coverPreview, coverImage));
    form.append(sourceChoices, file.wrapper, urlPanel, download, coverPreview, metadataNote, title.wrapper, author.wrapper, genreLabel, genreSuggestion, newGenreRow, collectionLabel, collectionSuggestion, statusLabel, error, actions);
    form.addEventListener("submit", (event) => void this.submit(event, { title: title.input, author: author.input, genre, collection, status, error, save,progress:download }));
    section.append(form); return section;
  }
  private async selectDrive(title: HTMLInputElement, error: HTMLElement, status: HTMLElement, preview: HTMLElement, image: HTMLImageElement, folderId?: string): Promise<void> {
    error.textContent = ""; status.textContent = "Abrindo Google Drive…";
    try { await this.applyImported(await this.manager.selectGoogleDrive(folderId, (percent) => this.downloadProgress(status, percent)), title, status, preview, image); status.textContent = "Livro e capa preparados. Personalize os dados abaixo."; }
    catch (caught) { status.textContent = ""; if (!(caught instanceof PickerCancelledError)) error.textContent = caught instanceof Error ? caught.message : "Não foi possível importar do Google Drive."; }
  }
  private async selectUrl(value: string, title: HTMLInputElement, error: HTMLElement, status: HTMLElement, button: HTMLButtonElement, preview: HTMLElement, image: HTMLImageElement): Promise<void> {
    if (!value.trim()) { error.textContent = "Cole o link do arquivo."; return; } error.textContent = ""; button.disabled = true; status.textContent = "Baixando livro…";
    try { await this.applyImported(await this.manager.selectUrl(value, (percent) => this.downloadProgress(status, percent)), title, status, preview, image); status.textContent = "Livro e capa preparados. Personalize os dados abaixo."; }
    catch (caught) {
      status.textContent = ""; error.textContent = caught instanceof Error ? caught.message : "Não foi possível importar este link.";
      if (caught instanceof FolderUrlError) { const choose = this.createElement("button", "button button--secondary", "Escolher arquivo da pasta"); choose.type = "button";
        choose.addEventListener("click", () => void this.selectDrive(title, error, status, preview, image, caught.folderId)); error.append(document.createTextNode(" "), choose); }
    } finally { button.disabled = false; }
  }
  private async applyImported(imported: ImportedFile, title: HTMLInputElement, status: HTMLElement, preview: HTMLElement, image: HTMLImageElement): Promise<void> {
    this.imported = imported; if (!title.value) title.value = imported.suggestedTitle; status.textContent = "Preparando capa…";
    this.automaticCover = await this.covers.fromBookFile(imported.file, imported.fileType, imported.suggestedTitle);
    image.src = this.automaticCover; preview.classList.remove("is-hidden");
    status.textContent = "Identificando título, autor e organização…"; await this.analyzeMetadata(imported, title);
  }
  private downloadProgress(status: HTMLElement, percent: number | null): void { status.textContent = percent === null ? "Baixando livro…" : `Baixando livro… ${percent}%`; }
  private async selectFile(input: HTMLInputElement, title: HTMLInputElement, error: HTMLElement, status: HTMLElement, preview: HTMLElement, image: HTMLImageElement): Promise<void> {
    const file = input.files?.[0]; if (!file) return;
    try { await this.applyImported(await this.manager.select(file), title, status, preview, image); status.textContent = "Livro e capa preparados. Personalize os dados abaixo."; error.textContent = ""; }
    catch (caught) { this.imported = null; input.value = ""; error.textContent = caught instanceof Error ? caught.message : "Arquivo inválido."; }
  }
  private async submit(event: SubmitEvent, fields: { title: HTMLInputElement; author: HTMLInputElement; genre: HTMLSelectElement;
    collection: HTMLSelectElement; status: HTMLSelectElement; error: HTMLElement; save: HTMLButtonElement;progress:HTMLElement }): Promise<void> {
    event.preventDefault();
    if (!this.imported) { fields.error.textContent = "Selecione um arquivo PDF ou EPUB."; return; }
    fields.save.disabled = true;
    try {
      const metadata = { title: fields.title.value.trim(), author: fields.author.value.trim(),
        genreId: fields.genre.value, collectionId: fields.collection.value || undefined, readingStatus: fields.status.value as ReadingStatus, cover: this.automaticCover };
      const options = await this.resolveVersionConflict(this.imported, metadata);
      if(options.cancelled){fields.progress.textContent="";return;}
      if(options.replaceBookId) await this.onReplaceExisting?.(options.replaceBookId);
      fields.progress.textContent="Preparando seu livro… Lendo conteúdo";this.onSaved(await this.manager.save(this.imported, metadata,step=>{const labels={reading:"Lendo conteúdo",organizing:"Organizando páginas",chapters:"Preparando capítulos",finalizing:"Finalizando"};fields.progress.textContent=`Preparando seu livro… ${labels[step.stage]} (${step.percent}%)`;},options));
    } catch (caught) { fields.error.textContent = caught instanceof ApiError || caught instanceof Error ? caught.message : "Não foi possível salvar o livro."; }
    finally { fields.save.disabled = false; }
  }
  private async resolveVersionConflict(imported:ImportedFile,metadata:{title:string;author:string}):Promise<{allowPossibleVersion?:boolean;replaceBookId?:string;cancelled?:boolean}>{
    const decision=await this.manager.inspect(imported,metadata);
    if(decision.kind==="duplicate")throw new DuplicateBookImportError(decision);
    if(decision.kind!=="possible-version")return{};
    const answer=(prompt(I18nManager.shared.t("library.versionPrompt"),I18nManager.shared.t("library.versionKeep"))??I18nManager.shared.t("library.versionCancel")).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase().trim();
    if(answer.startsWith("substitu"))return{replaceBookId:decision.book.id};
    if(answer.startsWith("mant"))return{allowPossibleVersion:true};
    return{cancelled:true};
  }
  private async createGenre(input: HTMLInputElement, select: HTMLSelectElement): Promise<void> {
    const name = input.value.trim(); if (!name) return;
    const existing = this.state.genres.find((item) => item.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    const genre = existing ?? new Genre(crypto.randomUUID(), name);
    if (!existing) { await this.genres.save(genre); this.state.library.addGenre(genre); this.state.notify(); }
    this.fillGenres(select); select.value = genre.id; input.value = "";
  }
  private fillGenres(select: HTMLSelectElement): void {
    const selected = select.value; select.replaceChildren(new Option("Selecione", ""));
    this.state.genres.forEach((genre) => select.append(new Option(genre.name, genre.id))); select.value = selected;
  }
  private async analyzeMetadata(imported: ImportedFile, title: HTMLInputElement): Promise<void> {
    try { const detected = await this.metadataExtractor.extract(imported.file, imported.fileType); title.value = detected.title.value;
      if (detected.author && this.authorInput) this.authorInput.value = detected.author.value;
      const notes = [`Título: ${this.confidence(detected.title.confidence)}`]; if (detected.author) notes.push(`Autor: ${this.confidence(detected.author.confidence)}`);
      if (detected.genre) { notes.push(`Gênero: ${this.confidence(detected.genre.confidence)}`); await this.suggestGenre(detected.genre.value); }
      if (detected.collection) await this.suggestCollection(detected.collection.value);
      if (this.metadataNote) this.metadataNote.textContent = `Preenchimento automático — ${notes.join(" · ")}. Você pode corrigir os campos.`;
    } catch { if (this.metadataNote) this.metadataNote.textContent = "Não foi possível identificar todos os dados. Complete ou corrija os campos antes de adicionar."; }
  }
  private async suggestGenre(name: string): Promise<void> {
    if (!this.genreSelect || !this.genreSuggestion) return; const resolution = this.genreResolver.resolve({ value: name, confidence: "medium" }, this.state.genres);
    if (resolution.kind === "existing") { this.genreSelect.value = resolution.genre.id; this.genreSuggestion.classList.add("is-hidden"); return; }
    this.genreSuggestion.replaceChildren(this.createElement("span", "", `Gênero sugerido: ${name}`)); const create = this.createElement("button", "button button--secondary", "Criar e usar"); create.type = "button";
    create.addEventListener("click", async () => { if (!this.genreSelect) return; const genre = new Genre(crypto.randomUUID(), name); await this.genres.save(genre); this.state.library.addGenre(genre); this.fillGenres(this.genreSelect); this.genreSelect.value = genre.id; this.genreSuggestion?.classList.add("is-hidden"); });
    this.genreSuggestion.append(create); this.genreSuggestion.classList.remove("is-hidden");
  }
  private async suggestCollection(name: string): Promise<void> {
    if (!this.collectionSelect || !this.collectionSuggestion) return; const existing = await this.collections.findByName(name);
    if (existing) { this.collectionSelect.value = existing.id; return; }
    this.collectionSuggestion.replaceChildren(this.createElement("span", "", `Organizar em coleção “${name}”?`)); const create = this.createElement("button", "button button--secondary", "Criar e usar"); create.type = "button";
    create.addEventListener("click", async () => { if (!this.collectionSelect) return; const collection = new Collection(crypto.randomUUID(), name, "author"); await this.collections.save(collection); this.collectionSelect.append(new Option(collection.name, collection.id)); this.collectionSelect.value = collection.id; this.collectionSuggestion?.classList.add("is-hidden"); });
    this.collectionSuggestion.append(create); this.collectionSuggestion.classList.remove("is-hidden");
  }
  private async fillCollections(select: HTMLSelectElement): Promise<void> { (await this.collections.getAll()).forEach(item => select.append(new Option(item.name, item.id))); }
  private confidence(value: Confidence): string { return value === "high" ? "alta confiança" : value === "medium" ? "média confiança" : "baixa confiança"; }
  private input(labelText: string, type: string): { wrapper: HTMLLabelElement; input: HTMLInputElement } {
    const wrapper = this.createElement("label", "field"); wrapper.append(this.createElement("span", "field__label", labelText));
    const input = this.createElement("input", "input") as HTMLInputElement; input.type = type; input.required = type !== "file" || labelText.startsWith("Arquivo"); wrapper.append(input); return { wrapper, input };
  }
  private sourceButton(icon: string, title: string, description: string): HTMLButtonElement {
    const button = this.createElement("button", "import-source") as HTMLButtonElement; button.type = "button";
    button.append(this.createElement("span", "import-source__icon", icon), this.createElement("strong", "", title), this.createElement("small", "", description)); return button;
  }
}
