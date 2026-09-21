#!/usr/bin/env node
/* Copies the local Tesseract runtime into public/ocr so the comic reader can run OCR from
 * the app's own origin: no page ever leaves the device and the strict connect-src CSP is
 * respected. Opt-in - the app reads comics fine without it, just without tappable blocks.
 *
 * Usage: npm run ocr:assets [-- <language> ...]   (default: por eng) */
import { cp, mkdir, writeFile, access } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const root = process.cwd();
const outputDirectory = join(root, "public", "ocr");
const languages = process.argv.slice(2).filter(value => !value.startsWith("-"));
const wanted = languages.length ? languages : ["por", "eng"];
const TESSDATA = process.env.LUMEO_TESSDATA ?? "https://tessdata.projectnaptha.com/4.0.0_fast";

async function main() {
  await mkdir(join(outputDirectory, "core"), { recursive: true });
  await mkdir(join(outputDirectory, "lang"), { recursive: true });

  const worker = require.resolve("tesseract.js/dist/worker.min.js");
  await cp(worker, join(outputDirectory, "worker.min.js"));
  console.log("ocr:assets worker.min.js");

  const core = dirname(require.resolve("tesseract.js-core/package.json"));
  // tesseract.js/src/worker-script/browser/getCore.js picks exactly one file: with
  // legacyCore:false it loads <relaxedsimd|simd|plain>-lstm.wasm.js and nothing else. The
  // standalone .wasm binaries and the asm.js builds are never requested, so shipping them
  // would add ~8.8 MB to every artefact for nothing. All three variants stay, because which
  // one a device picks depends on its WebAssembly SIMD support.
  await cp(core, join(outputDirectory, "core"), { recursive: true,
    filter: source => !/tesseract-core/.test(source) || /-lstm\.wasm\.js$/.test(source) });
  console.log("ocr:assets core/");

  // Stored uncompressed, on purpose. Android's asset packager gunzips any ".gz" it finds
  // and drops the suffix, so a packaged app would ask for "por.traineddata.gz" and get a
  // 404 while the web build worked. One name, both platforms.
  for (const language of wanted) {
    const target = join(outputDirectory, "lang", `${language}.traineddata`);
    if (await access(target).then(() => true, () => false)) { console.log(`ocr:assets ${language} (already present)`); continue; }
    const response = await fetch(`${TESSDATA}/${language}.traineddata.gz`);
    if (!response.ok) { console.error(`ocr:assets ${language} FAILED http ${response.status}`); process.exitCode = 1; continue; }
    await writeFile(target, gunzipSync(Buffer.from(await response.arrayBuffer())));
    console.log(`ocr:assets ${language}.traineddata`);
  }
  // The manifest is what the app probes at runtime: one small same-origin GET that says
  // which languages were packaged. A missing manifest means "no OCR here", which is a
  // normal, supported state - comics still open, just without tappable blocks.
  await writeFile(join(outputDirectory, "manifest.json"),
    JSON.stringify({ engine: "tesseract.js", languages: wanted, tessdata: TESSDATA, generatedAt: new Date().toISOString() }, null, 2));
  console.log("ocr:assets manifest.json", wanted.join("+"));
  console.log("ocr:assets done ->", outputDirectory);
}

main().catch(error => { console.error("ocr:assets failed:", error.message); process.exitCode = 1; });
