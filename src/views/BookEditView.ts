import type { AppState } from "../core/AppState";
import { Book, type ReadingStatus } from "../models/Book";
import { Genre } from "../models/Genre";
import { GenreRepository } from "../repositories/GenreRepository";
import { CoverService } from "../services/CoverService";
import { BaseView } from "./BaseView";

export class BookEditView extends BaseView {
  public constructor(private readonly state: AppState, private readonly book: Book | null, private readonly genres: GenreRepository,
    private readonly covers: CoverService, private readonly onSave: (book: Book) => void, private readonly onCancel: () => void) { super(); }
  public render(): HTMLElement {
    const section = this.createElement("section", "page-shell import-page");
    if (!this.book) { section.append(this.createElement("h1", "page-title", "Livro não encontrado")); return section; }
    const form = this.createElement("form", "import-card"); form.append(this.createElement("h1", "page-title", "Editar livro"));
    const title = this.field("Título", this.book.title); const author = this.field("Autor", this.book.author);
    const genre = this.createElement("select", "input") as HTMLSelectElement; this.state.genres.forEach((item) => genre.append(new Option(item.name, item.id))); genre.value = this.book.genreId;
    const genreLabel = this.createElement("label", "field"); genreLabel.append(this.createElement("span", "field__label", "Gênero"), genre);
    const newGenreRow = this.createElement("div", "inline-form"); const newGenre = this.createElement("input", "input") as HTMLInputElement; newGenre.placeholder = "Novo gênero";
    const create = this.createElement("button", "button button--secondary", "+ Criar gênero"); create.type = "button";
    create.addEventListener("click", () => void this.createGenre(newGenre, genre)); newGenreRow.append(newGenre, create);
    const status = this.createElement("select", "input") as HTMLSelectElement; status.append(new Option("Não iniciado", "unread"), new Option("Lendo", "reading"), new Option("Concluído", "finished")); status.value = this.book.readingStatus;
    const statusLabel = this.createElement("label", "field"); statusLabel.append(this.createElement("span", "field__label", "Status"), status);
    const coverLabel = this.createElement("label", "field"); coverLabel.append(this.createElement("span", "field__label", "Trocar capa"));
    const cover = this.createElement("input", "input") as HTMLInputElement; cover.type = "file"; cover.accept = "image/*"; coverLabel.append(cover);
    const error = this.createElement("p", "form-error"); const actions = this.createElement("div", "form-actions");
    const save = this.createElement("button", "button button--primary", "Salvar alterações"); save.type = "submit";
    const cancel = this.createElement("button", "button button--secondary", "Cancelar"); cancel.type = "button"; cancel.addEventListener("click", this.onCancel); actions.append(save, cancel);
    form.append(title.wrapper, author.wrapper, genreLabel, newGenreRow, statusLabel, coverLabel, error, actions);
    form.addEventListener("submit", async (event) => {
      event.preventDefault(); save.disabled = true;
      try {
        const chosenCover = cover.files?.[0] ? await this.covers.fromImage(cover.files[0]) : this.book?.cover ?? "";
        if (!this.book) return;
        this.onSave(new Book({ id: this.book.id, title: title.input.value.trim(), author: author.input.value.trim(), genreId: genre.value,
          cover: chosenCover, fileType: this.book.fileType, fileName: this.book.fileName, fileSize: this.book.fileSize,
          mimeType: this.book.mimeType, readingStatus: status.value as ReadingStatus, createdAt: this.book.createdAt,
          updatedAt: new Date(), currentLocation: this.book.currentLocation, progressPercent: this.book.progressPercent, collectionId: this.book.collectionId }));
      } catch (caught) { error.textContent = caught instanceof Error ? caught.message : "Não foi possível salvar."; }
      finally { save.disabled = false; }
    }); section.append(form); return section;
  }
  private async createGenre(input: HTMLInputElement, select: HTMLSelectElement): Promise<void> {
    const name = input.value.trim(); if (!name) return;
    const existing = this.state.genres.find((item) => item.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    const item = existing ?? new Genre(crypto.randomUUID(), name);
    if (!existing) { await this.genres.save(item); this.state.library.addGenre(item); this.state.notify(); }
    select.append(new Option(item.name, item.id)); select.value = item.id; input.value = "";
  }
  private field(label: string, value: string): { wrapper: HTMLLabelElement; input: HTMLInputElement } {
    const wrapper = this.createElement("label", "field"); wrapper.append(this.createElement("span", "field__label", label));
    const input = this.createElement("input", "input") as HTMLInputElement; input.required = label === "Título"; input.value = value; wrapper.append(input); return { wrapper, input };
  }
}
