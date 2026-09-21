import type { ComicBlockShape } from "./ComicTextTypes";

export interface SampledPixels { width: number; height: number; data: ArrayLike<number>; }
export interface ComicBlockStyle { background: string; ink: string; }

/** Reads the colours a block already has on the page so the enlarged version looks like it
 *  belongs there: a white balloon stays white, a red caption stays red. This samples what is
 *  actually painted - it never looks for a balloon by its colour. */
export class ComicBlockStyleSampler {
  private readonly fallback: ComicBlockStyle = { background: "#f7f5ef", ink: "#16161a" };

  public sample(pixels: SampledPixels | null, region: { x: number; y: number; width: number; height: number }): ComicBlockStyle {
    if (!pixels || pixels.width < 1 || pixels.height < 1) return this.fallback;
    const left = Math.max(0, Math.floor(region.x * pixels.width));
    const top = Math.max(0, Math.floor(region.y * pixels.height));
    const right = Math.min(pixels.width, Math.ceil((region.x + region.width) * pixels.width));
    const bottom = Math.min(pixels.height, Math.ceil((region.y + region.height) * pixels.height));
    if (right - left < 2 || bottom - top < 2) return this.fallback;
    const step = Math.max(1, Math.floor(Math.sqrt(((right - left) * (bottom - top)) / 1800)));
    const counts = new Map<number, { count: number; r: number; g: number; b: number }>();
    for (let y = top; y < bottom; y += step) for (let x = left; x < right; x += step) {
      const offset = (y * pixels.width + x) * 4;
      const r = Number(pixels.data[offset] ?? 0), g = Number(pixels.data[offset + 1] ?? 0), b = Number(pixels.data[offset + 2] ?? 0);
      const key = (r >> 4 << 8) | (g >> 4 << 4) | (b >> 4);
      const entry = counts.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
      counts.set(key, { count: entry.count + 1, r: entry.r + r, g: entry.g + g, b: entry.b + b });
    }
    const ranked = [...counts.values()].sort((a, b) => b.count - a.count).map(entry => ({
      count: entry.count, r: Math.round(entry.r / entry.count), g: Math.round(entry.g / entry.count), b: Math.round(entry.b / entry.count),
    }));
    const background = ranked[0]; if (!background) return this.fallback;
    // The ink is the most frequent colour that still reads against the background: the
    // lettering, not the anti-aliased halo one shade away from it.
    const ink = ranked.slice(1).find(entry => Math.abs(this.luminance(entry) - this.luminance(background)) > 0.35)
      ?? (this.luminance(background) > 0.55 ? { r: 18, g: 18, b: 22 } : { r: 245, g: 244, b: 238 });
    return { background: this.css(background), ink: this.css(ink) };
  }

  public shape(region: { width: number; height: number }, lines: number): ComicBlockShape {
    return lines <= 2 && region.width > region.height * 3.2 ? "caption" : "balloon";
  }

  private luminance(color: { r: number; g: number; b: number }): number { return (0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b) / 255; }
  private css(color: { r: number; g: number; b: number }): string { return `rgb(${color.r}, ${color.g}, ${color.b})`; }
}
