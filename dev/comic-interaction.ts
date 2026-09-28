/** A bench for the parts of the reader that only a real browser can answer for: what a
 *  click lands on once the enlarged balloon is clipped to its own outline, where that
 *  balloon is placed when its neighbours are in the way, and how big it gets on a desktop.
 *
 *  It uses the reader's own modules and its own stylesheet - no copies, no stand-ins - and
 *  a drawn page instead of a converted comic, so the geometry under test is exact and the
 *  run costs nothing. The end-to-end proof stays where it belongs: the real comic on the
 *  phone and on the desktop app. */
import { ComicHitMap, type ComicPageArt } from "../src/reader/comic/interaction/ComicHitMap";
import { ComicInteractionEngine } from "../src/reader/comic/interaction/ComicInteractionEngine";
import { ComicBubbleView } from "../src/reader/comic/interaction/ComicBubbleView";
import { comicBubbleZoom } from "../src/reader/comic/interaction/ComicBubbleLayout";
import type { ComicDocument, ComicTextRegion } from "../src/reader/comic/interaction/ComicInteractionTypes";

const stage = document.querySelector<HTMLElement>("#stage")!;
const bubbles = document.querySelector<HTMLElement>("#bubbles")!;
const log = document.querySelector<HTMLElement>("#log")!;
const art = { x: 50, y: 50, width: 800, height: 600 };

/** A balloon drawn as two lobes that run into each other, and a separate small balloon
 *  sitting inside the rectangle around them - the case from the reported page. */
const group: ComicTextRegion = {
  id: "grupo", pageIndex: 0, text: "EU... NÃO SEI O NOME\nVERDADEIRO DELE", shape: "balloon",
  tailDirection: "down", type: "speech", segmentationMethod: "component-mask",
  x: .30, y: .25, width: .40, height: .34, visualBounds: { x: .30, y: .25, width: .40, height: .34 },
  hitBounds: { x: .30, y: .25, width: .40, height: .34 }, typography: { capHeight: .012, lines: 2 },
  contour: [{ x: .30, y: .25 }, { x: .54, y: .25 }, { x: .54, y: .37 }, { x: .70, y: .37 },
    { x: .70, y: .59 }, { x: .50, y: .59 }, { x: .50, y: .43 }, { x: .30, y: .43 }],
};

const neighbour: ComicTextRegion = {
  id: "vizinho", pageIndex: 0, text: "“ELE”?", shape: "balloon", tailDirection: "down", type: "speech",
  segmentationMethod: "component-mask", x: .57, y: .26, width: .11, height: .09,
  visualBounds: { x: .57, y: .26, width: .11, height: .09 }, hitBounds: { x: .57, y: .26, width: .11, height: .09 },
  typography: { capHeight: .012, lines: 1 },
  contour: [{ x: .57, y: .26 }, { x: .68, y: .26 }, { x: .68, y: .35 }, { x: .57, y: .35 }],
};

const engine = new ComicInteractionEngine();
engine.open({ manifest: {} as ComicDocument["manifest"], metadata: {} as ComicDocument["metadata"],
  pages: [{ index: 0, id: "page-1", imagePath: "pages/001.webp", mimeType: "image/webp", cover: false, regions: [group, neighbour] }] });
const pages: ComicPageArt[] = [{ pageIndex: 0, rect: art }];
const map = (): ComicHitMap => new ComicHitMap(pages, engine);

/** Stand-in artwork: a canvas the size of the region, filled so the balloon is visible. */
function artworkFor(region: ComicTextRegion): { image: HTMLCanvasElement; x: number; y: number; width: number; height: number } {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(region.width * 1000); canvas.height = Math.round(region.height * 1000);
  const context = canvas.getContext("2d")!;
  context.fillStyle = region.id === "grupo" ? "#f4f4ef" : "#ffe9a8";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#222"; context.font = "16px sans-serif"; context.fillText(region.id, 8, 24);
  return { image: canvas, x: 0, y: 0, width: canvas.width, height: canvas.height };
}

const bubble = new ComicBubbleView(bubbles, {
  compact: () => false,
  art: region => artworkFor(region),
  obstacles: region => pages.flatMap(page => engine.regionsForPage(page.pageIndex)
    .filter(other => other.id !== region.id).map(other => ComicHitMap.visualRect(page.rect, other))),
});

/** The reader's own routing of a still click, minus the page turn. */
function clickAt(x: number, y: number): void {
  const hit = map().hit({ x, y });
  if (bubble.isOpen) {
    if (hit && hit.region.id !== bubble.activeRegion?.id) void bubble.open(hit.region, hit.source);
    else if (!hit) bubble.close();
    return;
  }
  if (hit) void bubble.open(hit.region, hit.source);
}

stage.addEventListener("click", event => {
  const box = stage.getBoundingClientRect();
  const point = { x: event.clientX - box.x, y: event.clientY - box.y };
  // A click that landed on the enlarged balloon is answered by the page underneath, which
  // is what keeps a covered neighbour reachable.
  clickAt(point.x, point.y);
});

interface Bench {
  hit(x: number, y: number): string | null;
  click(x: number, y: number): Promise<string>;
  open(): string;
  rect(): number[] | null;
  elementAt(x: number, y: number): string;
  zoom(compact: boolean): number;
  regionRect(id: string): number[];
}

const bench: Bench = {
  hit: (x, y) => map().hit({ x, y })?.region.id ?? null,
  click: async (x, y) => {
    const box = stage.getBoundingClientRect();
    const target = document.elementFromPoint(box.x + x, box.y + y) as HTMLElement | null;
    target?.dispatchEvent(new MouseEvent("click", { clientX: box.x + x, clientY: box.y + y, bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 60));
    return bench.open();
  },
  open: () => bubble.activeRegion?.id ?? "nenhum",
  rect: () => {
    const element = bubbles.querySelector<HTMLElement>(".comic-bubble:not(.comic-bubble--leaving)");
    if (!element) return null;
    const box = element.getBoundingClientRect(), stageBox = stage.getBoundingClientRect();
    return [box.x - stageBox.x, box.y - stageBox.y, box.width, box.height].map(Math.round);
  },
  elementAt: (x, y) => {
    const box = stage.getBoundingClientRect();
    const element = document.elementFromPoint(box.x + x, box.y + y) as HTMLElement | null;
    return element ? `${element.className || element.tagName}${element.dataset.regionId ? `#${element.dataset.regionId}` : ""}` : "nada";
  },
  zoom: compact => comicBubbleZoom(ComicHitMap.visualRect(art, group), { width: innerWidth, height: innerHeight }, compact, group),
  regionRect: id => {
    const region = id === "grupo" ? group : neighbour;
    const rect = ComicHitMap.visualRect(art, region);
    return [rect.x, rect.y, rect.width, rect.height].map(Math.round);
  },
};

(window as unknown as { bench: Bench }).bench = bench;
log.textContent = "bancada pronta";
