import { createClient } from "@supabase/supabase-js";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { StructuredDriveCatalogProvider } from "../../../server/src/catalog/StructuredDriveCatalogProvider.js";
import { opdsAutoajudaSource } from "../../../server/src/opds/OpdsSources.js";
import { CalibreConverter } from "./CalibreConverter.js";
import { MemoryEditionQueue, SupabaseEditionQueue, SupabaseEditionStorage, type EditionStorage } from "./EditionQueue.js";
import { KindleConversionWorker, jsonLog, type WatchedSource } from "./KindleConversionWorker.js";

/**
 * Kindle conversion worker (Docker, outside Vercel).
 *   (no flag)      keeps running: scans Drive, converts the queue, waits, repeats
 *   --once         scans, converts everything queued, exits
 *   --dry-run      in memory, nothing written to Supabase; with --limit N converts N books and
 *                  keeps the AZW3s in KINDLE_DRY_RUN_DIR (or only checks them when it is unset)
 */
const env = process.env, args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const int = (value: string | undefined, fallback: number) => { const parsed = Number.parseInt(value ?? "", 10); return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback; };

const autoajuda = opdsAutoajudaSource({ opdsCatalogLocale: env.OPDS_CATALOG_LOCALE?.trim() || "pt-BR", opdsAutoajudaFolderId: env.OPDS_AUTOAJUDA_FOLDER_ID?.trim() || undefined });
// The Autoajuda folder first; other folders join this list with a higher number.
const sources: WatchedSource[] = [{ sourceId: autoajuda.sourceId, priority: 10, locale: autoajuda.locale, catalog: new StructuredDriveCatalogProvider(autoajuda) }];

const converter = new CalibreConverter({
  calibreBin: env.CALIBRE_BIN ?? "/opt/calibre",
  maxEpubBytes: int(env.KINDLE_MAX_EPUB_MB, 200) * 1048576,
  convertTimeoutMs: int(env.KINDLE_CONVERT_TIMEOUT_SECONDS, 900) * 1000,
  downloadTimeoutMs: int(env.KINDLE_DOWNLOAD_TIMEOUT_SECONDS, 600) * 1000,
  tempDir: env.KINDLE_TEMP_DIR,
});
const settings = { workerId: env.KINDLE_WORKER_ID ?? `kindle-${hostname()}-${process.pid}`, maxAttempts: int(env.KINDLE_MAX_ATTEMPTS, 3), staleAfterMinutes: int(env.KINDLE_STALE_AFTER_MINUTES, 30) };

async function main(): Promise<void> {
  if (flag("--dry-run")) return dryRun();
  const url = env.SUPABASE_URL, key = env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Defina SUPABASE_URL e SUPABASE_SECRET_KEY (ou SUPABASE_SERVICE_ROLE_KEY) no ambiente do worker.");
  const database = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const worker = new KindleConversionWorker(sources, new SupabaseEditionQueue(database), new SupabaseEditionStorage(database), converter, settings);
  jsonLog("KINDLE_WORKER_STARTED", { workerId: settings.workerId, sources: sources.map((source) => source.sourceId) });
  if (flag("--once")) { await worker.scan(); while (await worker.processNext()) { /* drain */ } return; }
  const stop = new AbortController();
  for (const signal of ["SIGTERM", "SIGINT"] as const) process.once(signal, () => { jsonLog("KINDLE_WORKER_STOPPING", { signal }); stop.abort(); });
  await worker.run(stop.signal, { scanIntervalMs: int(env.KINDLE_SCAN_INTERVAL_MINUTES, 30) * 60_000, idleMs: int(env.KINDLE_IDLE_SECONDS, 60) * 1000 });
}

/** Converts real books from the real folder without touching Supabase. */
async function dryRun(): Promise<void> {
  const limit = int(option("--limit"), 3), keep = env.KINDLE_DRY_RUN_DIR;
  const queue = new MemoryEditionQueue();
  const storage: EditionStorage = {
    upload: async (path, bytes) => { if (keep) { await mkdir(dirname(join(keep, path)), { recursive: true }); await writeFile(join(keep, path), bytes); } },
    remove: async (path) => { if (keep) await rm(join(keep, path), { force: true }); },
  };
  const worker = new KindleConversionWorker(sources, queue, storage, converter, settings);
  await worker.scan();
  const pick = option("--books")?.split(",").map((id) => id.trim()).filter(Boolean);
  // Only the chosen books (or the first N) stay in the queue.
  let kept = 0;
  for (const row of [...queue.rows.values()]) if (pick ? !pick.includes(row.bookId) : kept++ >= limit) queue.rows.delete(row.bookId);
  while (await worker.processNext()) { /* drain */ }
  const rows = [...queue.rows.values()];
  jsonLog("KINDLE_DRY_RUN_DONE", { converted: rows.filter((row) => row.status === "ready").length, failed: rows.filter((row) => row.status !== "ready").map((row) => ({ bookId: row.bookId, title: row.metadata.title, reason: row.lastError })) });
}

main().catch((error: unknown) => { jsonLog("KINDLE_WORKER_CRASHED", { reason: error instanceof Error ? error.message : String(error) }); process.exitCode = 1; });
