import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { detectComicContainers } from "./ComicContainerDetector";
import { drawComicInteractionDebug } from "./ComicInteractionDebug";
import { comicReadPageRegions } from "./ComicPageRegionReader";
import { ComicRegionOcr } from "./ComicRegionOcr";
import type { ComicTextRegion } from "./ComicInteractionTypes";

// Only the explicit development HTML entry imports this module.
if (!import.meta.env.DEV) throw new Error("Development only");

const element = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const say = (message: string): void => { element("progress").textContent = message; };
const ocr = new ComicRegionOcr();
let regions: ComicTextRegion[] = [];
let rendered: HTMLCanvasElement | undefined;

/** Renders one page of a comic and shows what the interaction layer found on it: the
 *  containers, the three rectangles of each region, and the text that was read.
 *
 *  It exists for the question a region count cannot answer - is there text on this page
 *  that has no region at all? - which is why the page is shown, not summarized. */
async function run(): Promise<void> {
  const file = element<HTMLInputElement>("file").files?.[0];
  if (!file) { say("Escolha um PDF."); return; }
  const index = Math.max(1, Number(element<HTMLInputElement>("page").value)) - 1;
  say("Renderizando…");
  GlobalWorkerOptions.workerSrc = workerUrl;
  const loading = getDocument({ data: await file.arrayBuffer() });
  try {
    const pdf = await loading.promise;
    const page = await pdf.getPage(Math.min(pdf.numPages, index + 1));
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: 2400 / Math.max(base.width, base.height) });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true })!;
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    rendered = canvas;

    const started = performance.now();
    const containers = detectComicContainers(context.getImageData(0, 0, canvas.width, canvas.height));
    const detected = performance.now();
    regions = await comicReadPageRegions(canvas, index, ocr);
    const read = performance.now();
    say(`página ${index + 1}/${pdf.numPages}: ${containers.length} containers, ${regions.length} regiões`
      + ` (${regions.filter(region => region.recognitionStatus === "needs-review").length} para revisão)`
      + ` · detecção ${Math.round(detected - started)}ms · leitura ${Math.round(read - detected)}ms`);
    Object.assign(window, { comicDebugRegions: regions, comicDebugContainers: containers });
    element("texts").textContent = regions.map(region =>
      `${region.id} ${region.type}/${region.shape} ${Math.round((region.ocrConfidence ?? 0) * 100)}%`
      + `${region.recognitionStatus === "needs-review" ? " ⚑" : ""} :: ${JSON.stringify(region.text)}`).join("\n");
    draw();
  } catch (error) { say(`FALHOU: ${String(error)}`); }
  finally { await loading.destroy(); }
}

function draw(): void {
  if (!rendered) return;
  const view = element<HTMLCanvasElement>("art");
  view.width = rendered.width; view.height = rendered.height;
  const context = view.getContext("2d")!;
  context.drawImage(rendered, 0, 0);
  drawComicInteractionDebug(context, regions, { x: 0, y: 0, width: view.width, height: view.height },
    element<HTMLInputElement>("debug").checked);
}

element("run").onclick = () => { void run(); };
element("debug").onchange = () => draw();
element("dark").onchange = () => document.body.classList.toggle("dark", element<HTMLInputElement>("dark").checked);
