import { unzipSync } from "fflate";
import { ComicPdfConverter } from "./ComicPdfConverter";
import { drawComicInteractionDebug } from "./ComicInteractionDebug";
import { ComicInteractionEngine } from "./ComicInteractionEngine";
import type { ComicConversionResult } from "./ComicConverter";

// Only the explicit development HTML entry imports this module.
if (!import.meta.env.DEV) throw new Error("Development only");
const element = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
let result: ComicConversionResult | undefined;
let controller: AbortController | undefined;
const engine = new ComicInteractionEngine();
const draw = async (): Promise<void> => {
  if (!result) return;
  const index = Number(element<HTMLInputElement>("page").value) - 1;
  const page = result.document.pages[index]; if (!page) return;
  const bytes = unzipSync(result.bytes, { filter: entry => entry.name === page.imagePath })[page.imagePath]!;
  const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: page.mimeType }));
  const canvas = element<HTMLCanvasElement>("art"); canvas.width = bitmap.width; canvas.height = bitmap.height;
  const context = canvas.getContext("2d")!; context.drawImage(bitmap, 0, 0); bitmap.close();
  drawComicInteractionDebug(context, page.regions, { x: 0, y: 0, width: canvas.width, height: canvas.height }, element<HTMLInputElement>("debug").checked);
};
element("convert").onclick = async () => {
  const file = element<HTMLInputElement>("file").files?.[0]; if (!file) return;
  controller = new AbortController(); result = undefined;
  element<HTMLButtonElement>("convert").disabled = true;
  element<HTMLButtonElement>("cancel").disabled = false;
  element<HTMLButtonElement>("download").disabled = true;
  try {
    result = await new ComicPdfConverter().convert({ contentType: "comic", blob: file, title: file.name, fileName: file.name,
      coverPages: element<HTMLInputElement>("cover").checked ? [0] : [] }, {
      signal: controller.signal,
      onProgress: value => { element("progress").textContent = `${value.stage} ${value.currentPage}/${value.totalPages}`; },
    });
    engine.open(result.document);
    Object.assign(window, { comicDebugResult: result, comicDebugEngine: engine });
    element<HTMLInputElement>("page").max = String(result.document.pages.length);
    element<HTMLButtonElement>("download").disabled = false;
    await draw();
  } catch (error) { element("progress").textContent = `FAILED: ${String(error)}`; }
  finally { element<HTMLButtonElement>("convert").disabled = false; element<HTMLButtonElement>("cancel").disabled = true; }
};
element("cancel").onclick = () => controller?.abort();
element("page").onchange = element("debug").onchange = () => { void draw(); };
element("dark").onchange = () => document.body.classList.toggle("dark", element<HTMLInputElement>("dark").checked);
element("download").onclick = () => {
  if (!result) return;
  const url = URL.createObjectURL(new Blob([new Uint8Array(result.bytes)], { type: "application/octet-stream" }));
  const link = document.createElement("a"); link.href = url; link.download = "hq.lima"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
