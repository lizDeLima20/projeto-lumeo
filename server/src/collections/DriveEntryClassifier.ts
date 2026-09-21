import type { DriveEntryFormat } from "./types.js";

const FOLDER_MIME = "application/vnd.google-apps.folder";

/** Drive hands out a specific type for most things. When it does, it wins: a file named
 *  "Capítulo 01" with no extension is still a PDF, and a file named "Cap 1.pdf" that is
 *  really a RAR is still a CBR. */
const BY_MIME = new Map<string, DriveEntryFormat>([
  ["application/pdf", "pdf"],
  ["application/epub+zip", "epub"],
  ["application/x-cbr", "cbr"],
  ["application/vnd.comicbook-rar", "cbr"],
  ["application/x-rar-compressed", "cbr"],
  ["application/vnd.rar", "cbr"],
  ["application/x-cbz", "cbz"],
  ["application/vnd.comicbook+zip", "cbz"],
]);

/** Types Drive uses when it simply does not know. Only for these does the filename get a
 *  vote - and a missing extension then means "unknown", never "discard". */
const GENERIC_MIMES = new Set(["", "application/octet-stream", "binary/octet-stream", "application/binary", "text/plain", "application/x-download"]);

const BY_EXTENSION = new Map<string, DriveEntryFormat>([
  ["pdf", "pdf"], ["epub", "epub"], ["cbr", "cbr"], ["cbz", "cbz"],
]);

export class DriveEntryClassifier {
  public isFolder(mimeType: string): boolean { return mimeType === FOLDER_MIME; }

  public format(mimeType: string, name: string): DriveEntryFormat {
    const known = BY_MIME.get(mimeType.toLowerCase());
    if (known) return known;
    if (!GENERIC_MIMES.has(mimeType.toLowerCase())) {
      // A specific type Lumeo does not know about: trusting the filename here is how a
      // .docx named "Capítulo 01.pdf" would get opened as a book.
      return this.extension(name) === "pdf" && mimeType.includes("pdf") ? "pdf" : "unknown";
    }
    return this.extension(name) ?? "unknown";
  }

  /** What Lumeo can actually open today. CBR and CBZ are recognized so the reader sees the
   *  file and knows what it is, but there is no comic-archive reader yet. */
  public isSupported(format: DriveEntryFormat): boolean { return format === "pdf" || format === "epub"; }

  private extension(name: string): DriveEntryFormat | null {
    const match = /\.([A-Za-z0-9]{1,5})$/.exec(name.trim());
    return match ? BY_EXTENSION.get(match[1]!.toLowerCase()) ?? null : null;
  }
}
