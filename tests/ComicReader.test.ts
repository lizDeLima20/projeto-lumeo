import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { Book } from "../src/models/Book";
import { ComicContentTypeResolver } from "../src/reader/comic/ComicContentType";
import { ComicLayout } from "../src/reader/comic/ComicLayout";
import { ComicTextBlockGrouper } from "../src/reader/comic/ComicTextBlockGrouper";
import { ComicPageBlockCache } from "../src/reader/comic/ComicPageBlockCache";
import { ComicBlockSelection } from "../src/reader/comic/ComicBlockSelection";
import { ComicPagePrefetchPlanner } from "../src/reader/comic/ComicPagePrefetchPlanner";
import { ComicBlockStyleSampler } from "../src/reader/comic/ComicBlockStyleSampler";
import { ComicPageProcessor } from "../src/reader/comic/ComicPageProcessor";
import type { ComicPageSample, ComicTextFragmentSource } from "../src/reader/comic/ComicTextFragmentSource";
import type { ComicTextFragment, ComicTextSourceName } from "../src/reader/comic/ComicTextTypes";

const source = (path: string): string => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
const repoFile = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function book(contentType?: "book" | "comic", fileType: "pdf" | "epub" = "pdf"): Book {
  return new Book({ id: "b1", title: "T", author: "A", genreId: "g", cover: "", fileType, fileName: "f", fileSize: 1,
    mimeType: fileType === "pdf" ? "application/pdf" : "application/epub+zip", readingStatus: "unread", contentType });
}
function fragment(text: string, x: number, y: number, width = 0.12, height = 0.02): ComicTextFragment {
  return { text, x, y, width, height };
}
class FakeSource implements ComicTextFragmentSource {
  public calls = 0;
  public constructor(public readonly name: ComicTextSourceName, private readonly fragments_: ComicTextFragment[],
    private readonly ready = true, private readonly fails = false) {}
  public async available(): Promise<boolean> { return this.ready; }
  public async fragments(_sample: ComicPageSample): Promise<ComicTextFragment[]> {
    this.calls++; if (this.fails) throw new Error("ocr exploded"); return this.fragments_;
  }
}
const sample = (pageNumber: number): ComicPageSample => ({ pageNumber, page: null, canvas: null });

describe("comic detection keeps the two readers apart", () => {
  it("1. comicPdfOpensInComicReader", () => {
    assert.equal(new ComicContentTypeResolver().resolve(book("comic")), "comic");
    const registration = source("core/App.ts");
    assert.match(registration, /ComicContentTypeResolver\(\)\.isComic\(this\.findBook\(id\)\)/);
    assert.match(registration, /return new ComicReaderView\(/);
  });
  it("2. plainPdfStaysInBookReader", () => {
    const resolver = new ComicContentTypeResolver();
    assert.equal(resolver.resolve(book()), "book");
    assert.equal(resolver.resolve(book(undefined)), "book");
    assert.equal(new Book({ ...book(), contentType: undefined } as never).contentType, "book");
    assert.match(source("core/App.ts"), /return new ReaderView\(id, this\.readerManager,/);
  });
  it("15. epubAndMobiAreNeverComics", () => {
    const resolver = new ComicContentTypeResolver();
    assert.equal(resolver.resolve(book("comic", "epub")), "book");
    assert.equal(resolver.isComic(null), false);
    // The comic reader is a separate view: nothing in the book reader changed shape.
    assert.doesNotMatch(source("views/ReaderView.ts"), /comic/i);
    assert.doesNotMatch(source("reader/ReaderManager.ts"), /comic/i);
  });
  it("contentTypeSurvivesEverySaveThatRebuildsABook", () => {
    assert.match(source("repositories/BookRepository.ts"), /contentType:book\.contentType/);
    assert.match(source("reader/ReadingProgressService.ts"), /contentType:book\.contentType/);
    assert.match(source("core/App.ts"), /contentType: local\.contentType/);
  });
});

describe("comic page presentation", () => {
  it("3. wholePageKeepsItsProportions", () => {
    const engine = source("reader/comic/ComicPageEngine.ts");
    // contain: the smaller ratio of the two, never a crop and never a stretch.
    assert.match(engine, /Math\.min\(stage\.width \/ base\.width, stage\.height \/ base\.height\)/);
    // Drawn into its slot by the same contain rule.
    const drawn = ComicLayout.contain({ x: 0, y: 0, width: 400, height: 600 }, 1500, 2306);
    assert.ok(Math.abs(drawn.width / drawn.height - 1500 / 2306) < 1e-9);
    // No text pipeline anywhere in the comic reader: no reflow engine, no pagination, no
    // paragraph rendering. The only shared call is the progress save.
    const view = source("views/ComicReaderView.ts");
    assert.doesNotMatch(view, /ReflowReaderEngine|PaginationEngine|renderParagraph|reader-page/);
    assert.match(view, /ComicTurnController/);
  });
  it("4. pageIsMountedBeforeAnyRecognitionStarts", () => {
    const view = source("views/ComicReaderView.ts");
    const arrived = view.slice(view.indexOf("private arrived("));
    const drawn = arrived.indexOf("this.drawRest();");
    const scheduled = arrived.indexOf("this.scheduleProcessing(this.currentPage)");
    assert.ok(drawn > 0 && scheduled > drawn, "processing must be scheduled after the page is drawn");
    // Scheduled, not awaited: the draw path never blocks on recognition.
    assert.match(view, /private scheduleProcessing\(pageNumber: number\): void/);
    assert.match(view, /requestIdleCallback/);
  });
});

describe("comic text recognition", () => {
  it("5. fragmentsCarryNormalizedCoordinates", async () => {
    const processor = new ComicPageProcessor([new FakeSource("pdf-text-layer", [fragment("Bem, o mundo", 0.42, 0.16, 0.18, 0.08)])], new ComicPageBlockCache());
    const [block] = (await processor.process(sample(1))).blocks;
    assert.ok(block);
    assert.deepEqual([block.x, block.y, block.width, block.height], [0.42, 0.16, 0.18, 0.08]);
    assert.ok(block.x >= 0 && block.x <= 1 && block.height <= 1);
    assert.equal(block.pageNumber, 1);
  });
  it("6. nearbyLinesBecomeOneBlock", () => {
    const grouper = new ComicTextBlockGrouper();
    const balloon = [fragment("linha 1", 0.30, 0.100), fragment("linha 2", 0.30, 0.125), fragment("linha 3", 0.30, 0.150)];
    const far = fragment("outro balão", 0.70, 0.620);
    const clusters = grouper.group([...balloon, far]);
    assert.equal(clusters.length, 2, "three stacked lines are one balloon, the distant one is another");
    assert.equal(clusters[0]!.lines.length, 3);
    assert.equal(clusters[0]!.text, "linha 1 linha 2 linha 3");
    assert.ok(clusters[0]!.height >= 0.06, "the block spans all three lines");
    assert.equal(clusters[1]!.text, "outro balão");
  });
  it("6b. wordsOnTheSameLineDoNotEachBecomeAHotspot", () => {
    const words = [fragment("BEM", 0.30, 0.10, 0.05, 0.02), fragment("O", 0.36, 0.10, 0.02, 0.02), fragment("MUNDO", 0.39, 0.10, 0.07, 0.02)];
    const clusters = new ComicTextBlockGrouper().group(words);
    assert.equal(clusters.length, 1);
    assert.equal(clusters[0]!.text, "BEM O MUNDO");
  });
  it("14. ocrFailureStillLeavesTheComicReadable", async () => {
    const processor = new ComicPageProcessor([new FakeSource("ocr", [], true, true)], new ComicPageBlockCache());
    const result = await processor.process(sample(3));
    assert.deepEqual(result.blocks, []);
    assert.equal(result.source, "none");
    // The reader shows the page regardless: nothing in the draw path depends on blocks.
    assert.match(source("views/ComicReaderView.ts"), /const canvas = await this\.engine\.render\(page, size\)\.catch\(\(\) => null\);\s*if \(canvas && !this\.disposed\) this\.bitmaps\.set/);
  });
  it("unavailableOcrIsSkippedAndTextLayerWins", async () => {
    const ocr = new FakeSource("ocr", [fragment("nunca", 0.1, 0.1)], false);
    const text = new FakeSource("pdf-text-layer", [fragment("daqui", 0.1, 0.1)]);
    const result = await new ComicPageProcessor([text, ocr], new ComicPageBlockCache()).process(sample(1));
    assert.equal(result.source, "pdf-text-layer");
    assert.equal(ocr.calls, 0, "OCR must not run when the page already has real text");
  });
  it("ocrPreparesTheBitmapBeforeRecognizing", () => {
    const ocr = source("reader/comic/TesseractComicOcrSource.ts");
    // Measured on a colour page: as drawn it returns noise at ~42% confidence, in greyscale
    // with a declared DPI every line comes back at 94-96%. Both steps are load-bearing.
    assert.match(ocr, /user_defined_dpi: "300"/);
    // Sparse-text segmentation (PSM 11) read nothing on an Android device for pages with a
    // single balloon; automatic (PSM 3) read every page there and on the desktop.
    assert.match(ocr, /tessedit_pageseg_mode: "3"/);
    assert.match(ocr, /private prepare\(canvas: HTMLCanvasElement\)/);
    assert.match(ocr, /0\.2126 \* image\.data\[index\]/);
    assert.match(ocr, /maxOcrSide = 1800/);
    // The page being read is never altered - preparation happens on a copy.
    assert.match(ocr, /const target = document\.createElement\("canvas"\)/);
  });
  it("ocrNeverSendsPagesToAnExternalService", () => {
    const ocr = source("reader/comic/TesseractComicOcrSource.ts");
    assert.doesNotMatch(ocr, /https?:\/\//);
    assert.match(ocr, /workerPath: "\/ocr\/worker\.min\.js"/);
    assert.match(ocr, /langPath: "\/ocr\/lang"/);
  });
});

describe("comic blocks are pre-rendered and hidden", () => {
  it("7. blocksArePreparedWithStyleAndStayHidden", async () => {
    const processor = new ComicPageProcessor([new FakeSource("pdf-text-layer", [fragment("Olá", 0.2, 0.2)])], new ComicPageBlockCache());
    const [block] = (await processor.process(sample(4))).blocks;
    assert.ok(block);
    assert.ok(block.background.startsWith("#") || block.background.startsWith("rgb"));
    assert.ok(block.ink);
    assert.ok(["balloon", "caption"].includes(block.shape));
    const overlay = source("reader/comic/ComicBlockOverlay.ts");
    assert.match(overlay, /panel\.hidden = true;/, "the panel is built up front and mounted hidden");
    assert.match(overlay, /root\.append\(hotspot, panel\)/, "hotspot and its panel are mounted together");
    // Real HTML text, not a crop of the artwork.
    assert.match(overlay, /text\.className = "comic-block__text"/);
    assert.doesNotMatch(overlay, /drawImage|toDataURL|background-image/);
  });
  it("wideShortRegionsReadAsCaptions", () => {
    const sampler = new ComicBlockStyleSampler();
    assert.equal(sampler.shape({ width: 0.6, height: 0.05 }, 1), "caption");
    assert.equal(sampler.shape({ width: 0.2, height: 0.15 }, 3), "balloon");
  });
  it("blockColoursComeFromThePageItself", () => {
    const red = new Uint8ClampedArray(4 * 4 * 4);
    for (let index = 0; index < 16; index++) { red[index * 4] = 200; red[index * 4 + 1] = 20; red[index * 4 + 2] = 20; red[index * 4 + 3] = 255; }
    for (let index = 0; index < 4; index++) { red[index * 4] = 250; red[index * 4 + 1] = 250; red[index * 4 + 2] = 250; }
    const style = new ComicBlockStyleSampler().sample({ width: 4, height: 4, data: red }, { x: 0, y: 0, width: 1, height: 1 });
    assert.match(style.background, /^rgb\(/);
    assert.notEqual(style.background, style.ink);
  });
});

describe("comic block interaction", () => {
  it("8. tapOpensABlock", () => {
    const selection = new ComicBlockSelection();
    assert.equal(selection.openId, null);
    assert.equal(selection.toggle("p1-b0"), "p1-b0");
    assert.equal(selection.isOpen, true);
  });
  it("9. secondTapCloses", () => {
    const selection = new ComicBlockSelection();
    selection.toggle("p1-b0");
    assert.equal(selection.toggle("p1-b0"), null);
    assert.equal(selection.isOpen, false);
  });
  it("10. tapOutsideCloses", () => {
    const selection = new ComicBlockSelection();
    selection.toggle("p1-b2");
    assert.equal(selection.close(), null);
    assert.match(source("reader/comic/ComicBlockOverlay.ts"),
      /root\.addEventListener\("pointerdown", event => \{ if \(event\.target === root\) this\.apply\(this\.selection\.close\(\)\); \}\)/);
  });
  it("11. openingBClosesA", () => {
    const selection = new ComicBlockSelection();
    selection.toggle("A");
    assert.equal(selection.toggle("B"), "B", "only one block is ever open");
    assert.equal(selection.openId, "B");
    // The overlay hides every panel that is not the open one, so they cannot stack.
    assert.match(source("reader/comic/ComicBlockOverlay.ts"), /panel\.hidden = !open;/);
  });
  it("12. changingPageClosesTheOpenBlock", () => {
    const view = source("views/ComicReaderView.ts");
    const arrived = view.slice(view.indexOf("private arrived("));
    const clear = arrived.indexOf("this.overlay.clear();");
    const draw = arrived.indexOf("this.drawRest();");
    assert.ok(clear > 0 && clear < draw, "the open block is closed before the next page is drawn");
    // And a turn in progress closes it before the leaf moves.
    assert.match(view, /turning: \(active: boolean\): void => \{[\s\S]{0,200}if \(active\) \{ this\.overlay\.close\(\); this\.bubble\?\.closeNow\(\); this\.hints\?\.interrupt\(\); \}/);
    assert.match(source("reader/comic/ComicBlockOverlay.ts"), /public clear\(\): void \{\s*this\.selection\.close\(\);/);
  });
});

describe("OCR é empacotado no build, nunca baixado em runtime", () => {
  it("ocrAssetsAreProvisionedBeforeEveryBuild", () => {
    const scripts = JSON.parse(repoFile("package.json")).scripts as Record<string, string>;
    assert.match(scripts.build!, /^npm run ocr:assets && /);
    assert.match(scripts["build:android"]!, /^npm run ocr:assets && /);
    // Vercel runs the same script, so the deployed artefact carries them too.
    assert.equal(JSON.parse(repoFile("vercel.json")).buildCommand, "npm run build");
  });
  it("ocrAssetsAreNotVersionedButAreServed", () => {
    assert.match(repoFile(".gitignore"), /^public\/ocr\/$/m);
    // The SPA rewrite must not swallow /ocr/*, or every asset would answer with index.html.
    const rewrite = JSON.parse(repoFile("vercel.json")).rewrites.at(-1).source as string;
    assert.ok(rewrite.includes("ocr/.*"), `rewrite não exclui /ocr/: ${rewrite}`);
  });
  it("wasmIsAllowedByBothContentSecurityPolicies", () => {
    // Chrome checks WebAssembly compilation against script-src. Measured: without this the
    // engine never starts - and Tesseract neither resolves nor rejects.
    const vercel = JSON.parse(repoFile("vercel.json")).headers[0].headers
      .find((header: { key: string }) => header.key === "Content-Security-Policy").value as string;
    assert.match(vercel, /script-src 'self' 'wasm-unsafe-eval'/);
    assert.match(repoFile("server/src/middleware/SecurityHeaders.ts"), /"script-src 'self' 'wasm-unsafe-eval'"/);
    // wasm only: JavaScript eval stays closed.
    assert.doesNotMatch(vercel, /'unsafe-eval'(?! )/);
  });
  it("runtimeOnlyProbesASmallLocalManifest", () => {
    const ocr = source("reader/comic/TesseractComicOcrSource.ts");
    assert.match(ocr, /manifestPath: "\/ocr\/manifest\.json"/);
    assert.match(ocr, /fetch\(this\.assets\.manifestPath, \{ cache: "force-cache" \}\)/);
    // Every path is same-origin: nothing is downloaded from a CDN on the phone.
    assert.doesNotMatch(ocr, /https?:\/\//);
    assert.match(repoFile("scripts/ocr-assets.mjs"), /manifest\.json/);
  });
  it("aBlockedEngineGivesUpInsteadOfHanging", () => {
    const ocr = source("reader/comic/TesseractComicOcrSource.ts");
    assert.match(ocr, /startTimeoutMs = 20_000/);
    assert.match(ocr, /Promise\.race\(\[/);
    assert.match(ocr, /if \(this\.unavailable\) return Promise\.resolve\(false\);/);
  });
  it("languageFilesAreShippedUngzippedSoAndroidFindsThem", () => {
    // Android's asset packager gunzips every ".gz" asset and drops the suffix: the APK held
    // "por.traineddata" while the app asked for "por.traineddata.gz" and got a 404. Both
    // halves of the fix have to stay together.
    assert.match(repoFile("scripts/ocr-assets.mjs"), /\$\{language\}\.traineddata`\)/);
    assert.match(repoFile("scripts/ocr-assets.mjs"), /gunzipSync/);
    assert.match(source("reader/comic/TesseractComicOcrSource.ts"), /gzip: false/);
  });
  it("onlyTheCoreFilesTheEngineActuallyLoadsArePackaged", () => {
    // getCore.js loads exactly one <variant>-lstm.wasm.js; the standalone .wasm binaries
    // and asm.js builds are never requested.
    assert.match(repoFile("scripts/ocr-assets.mjs"), /-lstm\\\.wasm\\\.js\$/);
  });
  it("serviceWorkerKeepsTheOcrRuntimeForOffline", () => {
    const worker = repoFile("public/sw.js");
    assert.match(worker, /const OCR_CACHE = `lumeo-ocr-\$\{SW_VERSION\}`;/);
    assert.match(worker, /LUMEO_CACHES = \[[^\]]*OCR_CACHE\]/, "senão o activate apagaria o cache recém-criado");
    assert.match(worker, /url\.pathname\.startsWith\("\/ocr\/"\)/);
  });
});

describe("comic page cache and prefetch", () => {
  it("13. returningToAProcessedPageReusesTheCache", async () => {
    const fake = new FakeSource("pdf-text-layer", [fragment("página 7", 0.2, 0.2)]);
    const processor = new ComicPageProcessor([fake], new ComicPageBlockCache());
    await processor.process(sample(7));
    await processor.process(sample(8));
    await processor.process(sample(7));
    assert.equal(fake.calls, 2, "page 7 is recognized once, not again on the way back");
    assert.equal(processor.isProcessed(7), true);
    assert.ok(processor.cached(7)?.blocks.length);
  });
  it("emptyPagesAreRememberedToo", async () => {
    const fake = new FakeSource("pdf-text-layer", []);
    const processor = new ComicPageProcessor([fake], new ComicPageBlockCache());
    await processor.process(sample(2)); await processor.process(sample(2));
    assert.equal(fake.calls, 1);
  });
  it("cacheKeepsTheMostRecentPages", () => {
    const cache = new ComicPageBlockCache(2);
    [1, 2, 3].forEach(pageNumber => cache.set({ pageNumber, blocks: [], source: "none" }));
    assert.equal(cache.size, 2);
    assert.equal(cache.has(1), false);
    assert.equal(cache.has(3), true);
  });
  it("9b. currentPageComesFirstThenNextThenPrevious", () => {
    assert.deepEqual(new ComicPagePrefetchPlanner().order(7, 20), [7, 8, 6]);
    assert.deepEqual(new ComicPagePrefetchPlanner().order(1, 20), [1, 2]);
    assert.deepEqual(new ComicPagePrefetchPlanner().order(20, 20), [20, 19]);
    // Never the whole album.
    assert.equal(new ComicPagePrefetchPlanner().order(10, 300).length, 3);
  });
});

describe("página responsiva da HQ", () => {
  it("a escala é contain por página, e a nitidez segue a densidade real até 3x", () => {
    const engine = source("reader/comic/ComicPageEngine.ts");
    assert.match(engine, /Math\.min\(stage\.width \/ base\.width, stage\.height \/ base\.height\)/);
    assert.match(engine, /const ratio = Math\.min\(globalThis\.devicePixelRatio \|\| 1, 3\);/);
    // The memory guard stays: the pixel budget still caps the bitmap.
    assert.match(engine, /maxCanvasPixels = 18_000_000/);
    assert.match(engine, /Math\.sqrt\(this\.maxCanvasPixels \/ Math\.max\(1, viewport\.width \* viewport\.height\)\)/);
  });
  it("um bitmap desenhado para o tamanho antigo nunca volta do cache depois de girar", () => {
    const engine = source("reader/comic/ComicPageEngine.ts");
    assert.match(engine, /if \(cached && this\.bitmapStage\.get\(pageNumber\) === size\) return cached\.canvas;/);
    assert.match(engine, /if \(generation === this\.generation\) \{ this\.cache\.set/);
    assert.match(engine, /public invalidate\(\): void \{ this\.generation\+\+;/);
  });
});
