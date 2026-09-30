import { inflateSync } from "fflate";
import { comicPageCollator, isComicPageImagePath, isSafeArchivePath, sniffComicPageMime } from "./ComicArchiveEntryFilter";

/** Reads one byte range of a remote file, inclusive on both ends - the same contract as an
 *  HTTP `Range: bytes=start-end` header. */
export type ByteRangeFetcher = (start: number, end: number) => Promise<Uint8Array>;

const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const EOCD_FIXED_SIZE = 22;
const MAX_EOCD_COMMENT = 65_535;
/** A pathologically large entry table is refused rather than fetched - real comics have at
 *  most a few hundred pages. */
const MAX_CENTRAL_DIRECTORY_BYTES = 4 * 1024 * 1024;
/** Local headers repeat the filename/extra fields with possibly different lengths than the
 *  central directory's own copy; this margin is fetched alongside the compressed data so
 *  the real data offset can be found without a second round trip in the common case. */
const LOCAL_HEADER_MARGIN = 1024;

interface CentralDirectoryEntry { name: string; method: number; compressedSize: number; localHeaderOffset: number }

/** Finds and returns just the first real page of a CBZ (a plain ZIP), fetching only the
 *  byte ranges its own directory structure requires - never the archive itself. ZIP keeps
 *  its file list at the end (the "central directory"), so this reads the tail first, then
 *  only the one entry's own compressed bytes once natural order says which page is first.
 *  Returns null (never throws) whenever the archive can't be read this way - the caller's
 *  placeholder stands in either way. */
export async function extractFirstCbzPage(totalSize: number, fetchRange: ByteRangeFetcher): Promise<Blob | null> {
  try {
    return await extractFirstCbzPageOrThrow(totalSize, fetchRange);
  } catch { return null; }
}

async function extractFirstCbzPageOrThrow(totalSize: number, fetchRange: ByteRangeFetcher): Promise<Blob | null> {
  if (totalSize <= EOCD_FIXED_SIZE) return null;
  const tailSize = Math.min(totalSize, EOCD_FIXED_SIZE + MAX_EOCD_COMMENT);
  const tailStart = totalSize - tailSize;
  const tail = await fetchRange(tailStart, totalSize - 1);
  const eocdOffset = findEocd(tail);
  if (eocdOffset < 0) return null;

  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  const entryCount = view.getUint16(eocdOffset + 10, true);
  const centralDirSize = view.getUint32(eocdOffset + 12, true);
  const centralDirOffset = view.getUint32(eocdOffset + 16, true);
  if (entryCount === 0 || centralDirSize === 0 || centralDirSize > MAX_CENTRAL_DIRECTORY_BYTES) return null;

  // Most comics have a small enough entry table that it already sits inside the tail this
  // just fetched - only archives with many pages need a second, targeted request for it.
  const centralDirectory = centralDirOffset >= tailStart
    ? tail.subarray(centralDirOffset - tailStart, centralDirOffset - tailStart + centralDirSize)
    : await fetchRange(centralDirOffset, centralDirOffset + centralDirSize - 1);
  if (centralDirectory.length < centralDirSize) return null;

  const entries = parseCentralDirectory(centralDirectory, entryCount);
  const pages = entries.filter(entry => isSafeArchivePath(entry.name) && isComicPageImagePath(entry.name))
    .sort((a, b) => comicPageCollator.compare(a.name, b.name));
  const first = pages[0];
  if (!first) return null;
  return extractEntry(first, fetchRange);
}

function findEocd(tail: Uint8Array): number {
  // The comment (if any) sits after the signature, so it is not necessarily the last 22
  // bytes - this has to search backwards, not read one fixed offset.
  for (let i = tail.length - EOCD_FIXED_SIZE; i >= 0; i--) {
    if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) return i;
  }
  return -1;
}

function parseCentralDirectory(buffer: Uint8Array, expectedCount: number): CentralDirectoryEntry[] {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const decoder = new TextDecoder();
  const entries: CentralDirectoryEntry[] = [];
  let offset = 0;
  while (offset + 46 <= buffer.length && entries.length < expectedCount) {
    if (view.getUint32(offset, true) !== CENTRAL_DIR_SIGNATURE) break;
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const nameBytes = buffer.subarray(offset + 46, offset + 46 + nameLength);
    entries.push({ name: decoder.decode(nameBytes), method, compressedSize, localHeaderOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function extractEntry(entry: CentralDirectoryEntry, fetchRange: ByteRangeFetcher): Promise<Blob | null> {
  // Store (0) and Deflate (8) cover the overwhelming majority of real CBZ files, and are
  // the only methods this narrow extractor - not a general unzip - needs to support.
  if (entry.method !== 0 && entry.method !== 8) return null;
  const headerAndData = await fetchRange(
    entry.localHeaderOffset,
    entry.localHeaderOffset + 30 + LOCAL_HEADER_MARGIN + entry.compressedSize - 1,
  );
  if (headerAndData.length < 30) return null;
  const view = new DataView(headerAndData.buffer, headerAndData.byteOffset, headerAndData.byteLength);
  if (view.getUint32(0, true) !== LOCAL_HEADER_SIGNATURE) return null;
  const nameLength = view.getUint16(26, true);
  const extraLength = view.getUint16(28, true);
  const dataStart = 30 + nameLength + extraLength;
  const compressed = headerAndData.subarray(dataStart, dataStart + entry.compressedSize);
  if (compressed.length < entry.compressedSize) return null;
  const raw = entry.method === 0 ? compressed : inflate(compressed);
  if (!raw) return null;
  const mime = sniffComicPageMime(raw);
  if (!mime) return null;
  return new Blob([new Uint8Array(raw)], { type: mime });
}

function inflate(compressed: Uint8Array): Uint8Array | null {
  // fflate's raw-deflate inflate - the same "just decompress these bytes" primitive
  // already bundled for EPUB covers, so this needs no new dependency.
  try { return inflateSync(compressed); } catch { return null; }
}
