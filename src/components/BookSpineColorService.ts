import type{Book}from"../models/Book";
export class BookSpineColorService { public fallback(fileType:Book["fileType"]):string{return fileType==="epub"?"#633424":"#302b59";}public async derive(source:string,fallback:string):Promise<string>{try{const image=new Image();image.src=source;await image.decode();const canvas=document.createElement("canvas");canvas.width=2;canvas.height=12;const context=canvas.getContext("2d",{willReadFrequently:true});if(!context)return fallback;context.drawImage(image,0,0,2,12);return this.fromPixels(context.getImageData(0,0,2,12).data,fallback);}catch{return fallback;}}public fromPixels(data:ArrayLike<number>,fallback="#302b59"):string{if(data.length<4)return fallback;let red=0,green=0,blue=0,count=0;for(let index=0;index<data.length;index+=4){const alpha=(data[index+3]??0)/255;if(alpha<.2)continue;red+=(data[index]??0)*alpha;green+=(data[index+1]??0)*alpha;blue+=(data[index+2]??0)*alpha;count+=alpha;}if(!count)return fallback;return`rgb(${Math.round(red/count*.68)}, ${Math.round(green/count*.68)}, ${Math.round(blue/count*.68)})`;}}

export interface BookSpinePalette { background: string; ink: string; }

/** Both spine colours come from the cover itself: the dominant tone becomes the
 *  board, and the most contrasting sampled tone becomes the ink. Gold/oxblood are
 *  only the fallback when the cover offers nothing legible. */
export class BookSpinePaletteService {
  public static readonly darkInk = "#4c241a";
  public static readonly lightInk = "#e9cf91";
  public constructor(private readonly colors = new BookSpineColorService()) {}

  public async palette(source: string, fallback: string): Promise<BookSpinePalette> {
    try {
      const image = new Image(); image.src = source; await image.decode();
      const canvas = document.createElement("canvas"); canvas.width = 8; canvas.height = 24;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return this.fallbackPalette(fallback);
      context.drawImage(image, 0, 0, 8, 24);
      const data = context.getImageData(0, 0, 8, 24).data;
      return this.fromSamples(data, this.colors.fromPixels(data, fallback));
    } catch { return this.fallbackPalette(fallback); }
  }

  public fromSamples(data: ArrayLike<number>, background: string): BookSpinePalette {
    const board = this.channels(background);
    if (!board) return this.fallbackPalette(background);
    const boardLuma = this.luminance(board);
    let best: number[] | undefined, bestScore = 0;
    for (let index = 0; index + 3 < data.length; index += 4) {
      if ((data[index + 3] ?? 0) < 200) continue;
      const pixel = [data[index] ?? 0, data[index + 1] ?? 0, data[index + 2] ?? 0];
      const score = Math.abs(this.luminance(pixel) - boardLuma) + this.chroma(pixel) * .35;
      if (score > bestScore) { bestScore = score; best = pixel; }
    }
    if (!best || bestScore < 60) return this.fallbackPalette(background);
    const ink = this.legible(best, boardLuma);
    return { background: this.readableBoard(board, boardLuma), ink };
  }

  /** Push the ink away from the board until the pair is comfortably readable. */
  private legible(pixel: readonly number[], boardLuma: number): string {
    const target = boardLuma > 105 ? 0 : 255;
    let ink = [...pixel];
    for (let step = 0; step < 6 && Math.abs(this.luminance(ink) - boardLuma) < 96; step += 1) {
      ink = ink.map(value => Math.round(value + (target - value) * .28));
    }
    return `rgb(${ink.map(value => Math.min(255, Math.max(0, value))).join(", ")})`;
  }

  /** Ceiling for a spine on the shelf. Bookbinding cloth never reads as paper white
   *  under a shelf lamp, and the old rule did the opposite - it BRIGHTENED light
   *  covers to as much as 245, which turned pale spines into glowing slabs. Light
   *  boards are now damped into cloth range instead; legibility is bought back on
   *  the ink side, in legible(). */
  public static readonly boardLuminanceCeiling = 178;
  public static readonly brightensLightBoards = false;
  private readableBoard(board: readonly number[], boardLuma: number): string {
    if (boardLuma <= 105) return `rgb(${board.join(", ")})`;
    const ceiling = BookSpinePaletteService.boardLuminanceCeiling;
    const scale = Math.min(1, ceiling / Math.max(1, boardLuma));
    return `rgb(${board.map(value => Math.round(value * scale)).join(", ")})`;
  }

  public fallbackPalette(background: string): BookSpinePalette {
    const board = this.channels(background);
    const luma = board ? this.luminance(board) : 0;
    return { background: board ? this.readableBoard(board, luma) : background,
      ink: luma > 105 ? BookSpinePaletteService.darkInk : BookSpinePaletteService.lightInk };
  }

  private channels(color: string): number[] | undefined {
    const parts = color.match(/\d+/g)?.map(Number);
    return parts?.length === 3 ? parts : undefined;
  }
  private luminance(pixel: readonly number[]): number { return .2126 * (pixel[0] ?? 0) + .7152 * (pixel[1] ?? 0) + .0722 * (pixel[2] ?? 0); }
  private chroma(pixel: readonly number[]): number { return Math.max(...pixel) - Math.min(...pixel); }
}
