import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from "fflate";

/**
 * Checks on the files the worker handles, so nothing broken reaches a Kindle: the EPUB that came
 * from Drive (not an HTML error page), and the AZW3/PDF that Calibre wrote (a real KF8 book with
 * its title, author and cover inside; a complete PDF).
 */

export interface FileCheck { ok: boolean; reason?: string; }

/** A real EPUB: a zip whose first entry is "mimetype" = application/epub+zip, with an OPF package. */
export function checkEpub(bytes: Uint8Array): FileCheck {
  if (bytes.length < 64) return { ok: false, reason: "EPUB vazio ou truncado" };
  const head = new TextDecoder().decode(bytes.subarray(0, 64)).toLowerCase();
  if (head.includes("<!doctype html") || head.includes("<html")) return { ok: false, reason: "o Drive devolveu uma página HTML em vez do EPUB" };
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) return { ok: false, reason: "o arquivo não é um zip (EPUB)" };
  let entries: Record<string, Uint8Array>;
  try { entries = unzipSync(bytes, { filter: (file) => file.name === "mimetype" || file.name === "META-INF/container.xml" }); }
  catch { return { ok: false, reason: "EPUB corrompido (zip ilegível)" }; }
  if (!entries["META-INF/container.xml"]) return { ok: false, reason: "EPUB sem META-INF/container.xml" };
  const mimetype = entries.mimetype ? new TextDecoder().decode(entries.mimetype).trim() : null;
  if (mimetype !== null && mimetype !== "application/epub+zip") return { ok: false, reason: `mimetype inesperado: ${mimetype.slice(0, 40)}` };
  return { ok: true };
}

/** Whether a download looks like an HTML page (Drive's quota or permission pages). */
export function looksLikeHtml(bytes: Uint8Array): boolean {
  const head = new TextDecoder().decode(bytes.subarray(0, 512)).trimStart().toLowerCase();
  return head.startsWith("<!doctype html") || head.startsWith("<html");
}

export interface Kf8Info extends FileCheck { title?: string; author?: string; language?: string; hasCover?: boolean; documentType?: string; }

/** EXTH record types (MobileRead wiki "MOBI" format). */
const EXTH = { author: 100, coverOffset: 201, documentType: 501, updatedTitle: 503, language: 524, kf8Boundary: 121 } as const;

/**
 * Reads the PalmDB/MOBI header of an AZW3: "BOOKMOBI", a MOBI header of version 8 (KF8) - or a
 * joint MOBI6+KF8 file with a KF8 boundary - and its EXTH metadata. The Kindle library lists the
 * book from these records: title (503), author (100), cover (201), type (501).
 */
export function inspectKf8(bytes: Uint8Array): Kf8Info {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 86) return { ok: false, reason: "arquivo AZW3 truncado" };
  const type = new TextDecoder("latin1").decode(bytes.subarray(60, 68));
  if (type !== "BOOKMOBI") return { ok: false, reason: `não é um livro MOBI/KF8 (${type.replace(/[^\x20-\x7e]/g, "?")})` };
  const records = view.getUint16(76);
  if (records < 2) return { ok: false, reason: "AZW3 sem registros" };
  const record0 = view.getUint32(78);
  if (record0 + 16 + 24 > bytes.length) return { ok: false, reason: "cabeçalho MOBI fora do arquivo" };
  const mobi = record0 + 16;
  if (new TextDecoder("latin1").decode(bytes.subarray(mobi, mobi + 4)) !== "MOBI") return { ok: false, reason: "cabeçalho MOBI ausente" };
  const headerLength = view.getUint32(mobi + 4), version = view.getUint32(mobi + 20);
  const flags = mobi + 0x70 <= bytes.length - 4 ? view.getUint32(mobi + 0x70) : 0;
  const exthStart = mobi + headerLength;
  const exth = new Map<number, Uint8Array[]>();
  if (flags & 0x40 && exthStart + 12 <= bytes.length && new TextDecoder("latin1").decode(bytes.subarray(exthStart, exthStart + 4)) === "EXTH") {
    const count = view.getUint32(exthStart + 8);
    let position = exthStart + 12;
    for (let index = 0; index < count && position + 8 <= bytes.length; index++) {
      const recordType = view.getUint32(position), length = view.getUint32(position + 4);
      if (length < 8 || position + length > bytes.length) return { ok: false, reason: "metadados EXTH corrompidos" };
      exth.set(recordType, [...(exth.get(recordType) ?? []), bytes.subarray(position + 8, position + length)]);
      position += length;
    }
  }
  const text = (record: number) => { const value = exth.get(record)?.[0]; return value ? new TextDecoder().decode(value).trim() : undefined; };
  const kf8 = version === 8 || exth.has(EXTH.kf8Boundary);
  if (!kf8) return { ok: false, reason: `MOBI versão ${version}, não KF8 (AZW3)` };
  const fullName = (() => {
    const offset = view.getUint32(mobi + 0x44 - 16 + 16), length = view.getUint32(mobi + 0x48 - 16 + 16);
    const start = record0 + offset;
    return offset > 0 && start + length <= bytes.length ? new TextDecoder().decode(bytes.subarray(start, start + length)).trim() : undefined;
  })();
  const title = text(EXTH.updatedTitle) ?? fullName, author = text(EXTH.author);
  const hasCover = exth.has(EXTH.coverOffset) && view.getUint32(exth.get(EXTH.coverOffset)![0]!.byteOffset - bytes.byteOffset) !== 0xffffffff;
  const info: Kf8Info = { ok: true, title, author, language: text(EXTH.language), hasCover, documentType: text(EXTH.documentType) };
  if (!title) return { ...info, ok: false, reason: "AZW3 sem título interno" };
  if (!author) return { ...info, ok: false, reason: "AZW3 sem autor interno" };
  return info;
}

/** A complete PDF: header at the start and an end-of-file marker at the end. */
export function checkPdf(bytes: Uint8Array): FileCheck {
  if (bytes.length < 64 || new TextDecoder("latin1").decode(bytes.subarray(0, 5)) !== "%PDF-") return { ok: false, reason: "o arquivo não é um PDF" };
  if (!new TextDecoder("latin1").decode(bytes.subarray(Math.max(0, bytes.length - 1024))).includes("%%EOF")) return { ok: false, reason: "PDF truncado (sem %%EOF)" };
  return { ok: true };
}

export interface EpubRepair { bytes: Uint8Array; fixed: number; missing: string[]; }

const decodeHref = (href: string) => { try { return decodeURIComponent(href); } catch { return href; } };
const directory = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "");
/** Resolves `href` (relative, possibly with ../) against `base` (a folder inside the zip). */
export function resolveZipPath(base: string, href: string): string {
  const parts = (base + decodeHref(href.split("#")[0]!)).split("/"), out: string[] = [];
  for (const part of parts) { if (part === "..") out.pop(); else if (part !== "." && part !== "") out.push(part); }
  return out.join("/");
}
function relativeZipPath(from: string, to: string): string {
  const source = from.split("/").filter(Boolean), target = to.split("/");
  let common = 0;
  while (common < source.length && common < target.length - 1 && source[common] === target[common]) common++;
  return [...Array(source.length - common).fill(".."), ...target.slice(common)].join("/");
}

/**
 * Fixes EPUBs whose package points at files under the wrong folder (e.g. the manifest says
 * "Text/Text/part0131.html" and the file is "Text/part0131.html"): Calibre would silently drop
 * every such chapter. A missing file is matched with the one file in the book with the same
 * name; the package (and its NCX table of contents) is rewritten to point at it. Files that
 * cannot be matched are reported in `missing`.
 */
export function repairEpub(bytes: Uint8Array): EpubRepair {
  const files = unzipSync(bytes), names = Object.keys(files);
  const container = files["META-INF/container.xml"] ? strFromU8(files["META-INF/container.xml"]) : "";
  const opfPath = /full-path\s*=\s*"([^"]+)"/.exec(container)?.[1];
  if (!opfPath || !files[opfPath]) return { bytes, fixed: 0, missing: [] };
  const base = directory(opfPath);
  let opf = strFromU8(files[opfPath]);
  const byName = new Map<string, string[]>();
  for (const name of names) { const short = name.slice(name.lastIndexOf("/") + 1).toLowerCase(); byName.set(short, [...(byName.get(short) ?? []), name]); }
  const replacements = new Map<string, string>(), missing: string[] = [];
  for (const match of opf.matchAll(/<item\b[^>]*\bhref\s*=\s*"([^"]+)"[^>]*>/g)) {
    const href = match[1]!, target = resolveZipPath(base, href);
    if (files[target] || replacements.has(href)) continue;
    const exact = names.find((name) => name.toLowerCase() === target.toLowerCase());
    const candidates = exact ? [exact] : byName.get(target.slice(target.lastIndexOf("/") + 1).toLowerCase()) ?? [];
    if (candidates.length === 1) replacements.set(href, relativeZipPath(base, candidates[0]!));
    else missing.push(target);
  }
  if (replacements.size === 0) return { bytes, fixed: 0, missing };
  const rewrite = (text: string) => text.replace(/(\b(?:href|src)\s*=\s*")([^"#]+)(#[^"]*)?"/g, (whole, start: string, href: string, anchor = "") => replacements.has(href) ? `${start}${replacements.get(href)}${anchor}"` : whole);
  opf = rewrite(opf);
  const out: Zippable = {};
  // "mimetype" first and stored, as the EPUB format asks.
  if (files.mimetype) out.mimetype = [files.mimetype, { level: 0 }];
  for (const name of names) {
    if (name === "mimetype") continue;
    // The NCX table of contents next to the package uses the same relative paths.
    const sameFolderToc = name.toLowerCase().endsWith(".ncx") && directory(name) === base;
    out[name] = name === opfPath ? strToU8(opf) : sameFolderToc ? strToU8(rewrite(strFromU8(files[name]!))) : files[name]!;
  }
  return { bytes: zipSync(out, { level: 6 }), fixed: replacements.size, missing };
}

/** The content files Calibre reported as absent ("Manifest item '...' not found"). */
export function calibreMissingItems(log: string): string[] {
  return [...log.matchAll(/Manifest item '([^']+)' not found/g)].map((match) => match[1]!);
}
