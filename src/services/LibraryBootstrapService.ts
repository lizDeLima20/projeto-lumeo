import type { Book } from "../models/Book";
import type { Genre } from "../models/Genre";
import { GenreRepository } from "../repositories/GenreRepository";
import { PersistentLibraryManager } from "./PersistentLibraryManager";
import type { LibraryReconciliation } from "./LibraryReconciliationService";
export interface LibraryBootstrapResult { genres: Genre[]; books: Book[]; integrity: LibraryReconciliation[]; }
export class LibraryBootstrapService { public constructor(private readonly genres: GenreRepository, private readonly library: PersistentLibraryManager) {} public async restore(): Promise<LibraryBootstrapResult> { const [genres, restored] = await Promise.all([this.genres.getAll(), this.library.restoreLibrary()]); return { genres, books: restored.books, integrity: restored.integrity }; } }
