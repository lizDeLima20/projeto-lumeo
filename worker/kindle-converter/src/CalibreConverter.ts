import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { opdsDownloadUrl } from "../../../server/src/opds/OpdsDownloadService.js";
import { OpdsCoverService } from "../../../server/src/opds/OpdsCoverService.js";
import { calibreMissingItems, checkEpub, inspectKf8, looksLikeHtml, repairEpub, type Kf8Info } from "./KindleFiles.js";
import type { EditionJob, EditionMetadata } from "./EditionQueue.js";

/** A failure that will not go away by trying again (a broken EPUB, a book Calibre cannot convert). */
export class PermanentConversionError extends Error {}

export interface ConvertedEdition { format: "azw3"; bytes: Uint8Array; sha256: string; info: Kf8Info; coverSource: "catalog" | "epub"; repairedPaths: number; }
export interface EditionConverter { convert(job: EditionJob): Promise<ConvertedEdition>; }

export interface CalibreSettings {
  /** Folder with ebook-convert (the official Calibre install: /opt/calibre in the image). */
  calibreBin: string;
  maxEpubBytes: number;
  convertTimeoutMs: number;
  downloadTimeoutMs: number;
  tempDir?: string;
}

/**
 * Calibre's command line for an AZW3 that the Kindle library lists properly: the catalog's title,
 * author, language, synopsis and cover written inside the file (EXTH records), sized for the
 * Kindle's screen. Every value is its own argument: nothing goes through a shell.
 */
export function ebookConvertArgs(input: string, output: string, metadata: EditionMetadata, cover: string | null): string[] {
  const args = [input, output, "--output-profile", "kindle_pw3", "--title", metadata.title, "--book-producer", "Lumeo"];
  // Calibre splits authors on "&". A catalog without the author keeps the EPUB's own.
  if (metadata.author.trim() && !UNKNOWN_AUTHORS.has(metadata.author.trim().toLocaleLowerCase("pt-BR"))) args.push("--authors", metadata.author.replace(/\s*&\s*/g, " e "));
  if (metadata.language) args.push("--language", metadata.language);
  if (metadata.synopsis) args.push("--comments", metadata.synopsis);
  if (metadata.publisher) args.push("--publisher", metadata.publisher);
  if (metadata.collection) {
    args.push("--series", metadata.collection);
    const index = Number((metadata.volume ?? "").replace(",", "."));
    if (Number.isFinite(index) && index > 0) args.push("--series-index", String(index));
  }
  if (cover) args.push("--cover", cover);
  return args;
}

/** Placeholders the catalog uses when it has no author. */
const UNKNOWN_AUTHORS = new Set(["autor não informado", "autor desconhecido", "desconhecido", "unknown"]);

/** Runs ebook-convert with a time limit; its output is kept (last lines) for the error message. */
export function runEbookConvert(bin: string, args: readonly string[], timeoutMs: number): Promise<{ code: number | null; log: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(join(bin, "ebook-convert"), args, { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, QT_QPA_PLATFORM: process.env.QT_QPA_PLATFORM ?? "offscreen" } });
    let log = "", timedOut = false;
    const keep = (chunk: Buffer) => { log = (log + chunk.toString()).slice(-4000); };
    child.stdout.on("data", keep); child.stderr.on("data", keep);
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeoutMs);
    child.on("error", (error) => { clearTimeout(timer); resolve({ code: null, log: `${log}\n${error.message}`, timedOut }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, log, timedOut }); });
  });
}

/**
 * EPUB (from Drive, exactly as the catalog downloads it) → AZW3 with Calibre. Each book gets its
 * own temporary folder, always removed, so a full disk or a crash never leaves files behind.
 */
export class CalibreConverter implements EditionConverter {
  public constructor(private readonly settings: CalibreSettings, private readonly fetcher: typeof fetch = fetch) {}

  public async convert(job: EditionJob): Promise<ConvertedEdition> {
    const folder = await mkdtemp(join(this.settings.tempDir ?? tmpdir(), "lumeo-kindle-"));
    try {
      const downloaded = await this.download(job);
      // Chapters filed under the wrong folder would be dropped by Calibre without an error.
      let repair: ReturnType<typeof repairEpub>;
      try { repair = repairEpub(downloaded); } catch { throw new PermanentConversionError("EPUB corrompido (não foi possível ler o pacote)"); }
      const input = join(folder, "livro.epub"), output = join(folder, "livro.azw3");
      await writeFile(input, repair.bytes);
      const cover = await this.cover(job.metadata.coverUrl, folder);
      const result = await runEbookConvert(this.settings.calibreBin, ebookConvertArgs(input, output, job.metadata, cover), this.settings.convertTimeoutMs);
      if (result.timedOut) throw new PermanentConversionError(`o Calibre passou de ${Math.round(this.settings.convertTimeoutMs / 1000)} s convertendo este livro`);
      if (result.code !== 0) throw new PermanentConversionError(`o Calibre não converteu o livro (código ${result.code}): ${lastLines(result.log)}`);
      const missing = calibreMissingItems(result.log).filter((item) => /\.x?html?$/i.test(item));
      if (missing.length) throw new PermanentConversionError(`EPUB com ${missing.length} capítulo(s) ausente(s) no pacote (ex.: ${missing[0]}); o AZW3 ficaria incompleto`);
      const bytes = new Uint8Array(await readFile(output).catch(() => { throw new PermanentConversionError("o Calibre terminou sem gerar o AZW3"); }));
      const info = inspectKf8(bytes);
      if (!info.ok) throw new PermanentConversionError(`AZW3 inválido: ${info.reason}`);
      if (!info.hasCover) throw new PermanentConversionError("AZW3 sem capa interna");
      return { format: "azw3", bytes, sha256: createHash("sha256").update(bytes).digest("hex"), info, coverSource: cover ? "catalog" : "epub", repairedPaths: repair.fixed };
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  }

  /** The catalog's EPUB, through the same Drive address the OPDS download redirects to. */
  private async download(job: EditionJob): Promise<Uint8Array> {
    const expected = job.metadata.fileSize;
    if (expected && expected > this.settings.maxEpubBytes) throw new PermanentConversionError(`EPUB de ${Math.round(expected / 1048576)} MB passa do limite de ${Math.round(this.settings.maxEpubBytes / 1048576)} MB`);
    const response = await this.fetcher(opdsDownloadUrl({ driveFileId: job.epubDriveFileId, resourceKey: job.metadata.resourceKey ?? null }), { redirect: "follow", signal: AbortSignal.timeout(this.settings.downloadTimeoutMs) });
    if (!response.ok) throw new Error(`o Drive respondeu ${response.status} ao baixar o EPUB`);
    const bytes = await readLimited(response, this.settings.maxEpubBytes);
    // Drive answers its quota and permission problems with an HTML page: try again later.
    if (looksLikeHtml(bytes)) throw new Error("o Drive devolveu uma página HTML em vez do EPUB (cota ou permissão); nova tentativa depois");
    if (job.epubSha256) {
      const actual = createHash("sha256").update(bytes).digest("hex");
      if (actual !== job.epubSha256) throw new Error(`o EPUB baixado não confere com o sha256 do catálogo (${actual.slice(0, 12)}…)`);
    }
    const check = checkEpub(bytes);
    if (!check.ok) throw new PermanentConversionError(check.reason!);
    return bytes;
  }

  /** The catalog's own cover, as a JPEG for Calibre. Without it Calibre keeps the EPUB's cover. */
  private async cover(url: string | null | undefined, folder: string): Promise<string | null> {
    if (!url) return null;
    try {
      const response = await this.fetcher(OpdsCoverService.sourceFor(url, 800), { redirect: "follow", signal: AbortSignal.timeout(20_000) });
      if (!response.ok) return null;
      const bytes = await readLimited(response, 10 * 1048576);
      const jpeg = await sharp(bytes).rotate().resize({ height: 1600, withoutEnlargement: true }).flatten({ background: "#ffffff" }).jpeg({ quality: 88 }).toBuffer();
      const path = join(folder, "capa.jpg");
      await writeFile(path, jpeg);
      return path;
    } catch {
      return null;
    }
  }
}

async function readLimited(response: Response, limit: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length"));
  if (declared > limit) throw new PermanentConversionError(`arquivo de ${Math.round(declared / 1048576)} MB passa do limite`);
  if (!response.body) return new Uint8Array(await response.arrayBuffer());
  const chunks: Uint8Array[] = []; let total = 0;
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    total += chunk.length;
    if (total > limit) throw new PermanentConversionError(`arquivo passa do limite de ${Math.round(limit / 1048576)} MB`);
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

const lastLines = (log: string) => log.trim().split("\n").slice(-3).join(" | ").slice(0, 600);
