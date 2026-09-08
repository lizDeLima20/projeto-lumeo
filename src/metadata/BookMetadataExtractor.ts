import type { BookFileType } from "../models/Book";
import { AuthorDetector } from "./AuthorDetector";
import { GenreClassifier } from "./GenreClassifier";
import type { ExtractedBookMetadata, MetadataSourceExtractor } from "./MetadataTypes";
import { TitleDetector } from "./TitleDetector";
export class BookMetadataExtractor {
  public constructor(private readonly titles = new TitleDetector(), private readonly authors = new AuthorDetector(), private readonly genres = new GenreClassifier()) {}
  public async extract(file: File, fileType: BookFileType, source?: MetadataSourceExtractor): Promise<ExtractedBookMetadata> {
    const extractor = source ?? await this.source(fileType); const native = await extractor.extract(file); const title = this.titles.detect(native, file.name); const author = this.authors.detect(native, title.value);
    const genre = this.genres.classify(native, title.value, author?.value); const collection = author?.confidence === "high" ? { value: author.value, confidence: "high" as const } : undefined;
    return { title, author, genre, collection, sourceText: native.firstPageText ?? "" };
  }
  private async source(type: BookFileType): Promise<MetadataSourceExtractor> { return type === "pdf" ? new (await import("./PdfMetadataExtractor")).PdfMetadataExtractor() : new (await import("./EpubMetadataExtractor")).EpubMetadataExtractor(); }
}
