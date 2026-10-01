/** What an already-cropped balloon image looks like, measured from its own pixels - never
 *  from OCR, never from a label the detector attached to it. The same few numbers the rest
 *  of this file's enhancement pipeline uses to decide how hard, if at all, to work on a
 *  given balloon: a clean modern print and a sun-faded sixty-year-old scan are not read the
 *  same way, and neither should be processed the same way. */
export interface ComicBalloonQualityMetrics {
  /** 0..1: how much of the page's dark-to-light range this crop actually uses, from the
   *  5th to the 95th luminance percentile. Low on a washed-out scan; close to 1 on a clean
   *  modern print, where blacks are black and the paper is bright. */
  contrast: number;
  /** 0..1: grain/compression noise, estimated from how much pixels near the background's
   *  own tone still wobble from their immediate neighbours - real background is flat, so
   *  any wobble there is noise, not art. */
  noise: number;
  /** 0..1: edge energy across the crop, relative to a sharp scan's. Low on a soft or
   *  blurred source; a hard, clean letterform scores close to 1. */
  sharpness: number;
  /** The single most common luminance in the crop, 0..255 - the balloon's own background
   *  tone, whatever it is (bright white, aged cream, a mid-grey caption). */
  backgroundLuminance: number;
  /** Whether that background reads as a flat, low-saturation tint - white, cream, grey -
   *  rather than a drawn, colourful panel. Only a neutral background is ever whitened. */
  neutralBackground: boolean;
  /** True for ink darker than its own background (almost every balloon); false for pale
   *  lettering reversed out of a dark fill (a black caption, a shout on a night panel). */
  darkOnLight: boolean;
}

interface Sample { r: number; g: number; b: number; luminance: number; }

const luminanceOf = (r: number, g: number, b: number): number => 0.299 * r + 0.587 * g + 0.114 * b;

/** Reads the crop on a bounded grid, never every pixel - metrics only need to be
 *  representative, and a balloon crop can run into the hundreds of thousands of pixels
 *  once it is upscaled for display. */
function sample(image: ImageData, target = 6000): Sample[] {
  const total = image.width * image.height;
  const stride = Math.max(1, Math.floor(Math.sqrt(total / target)));
  const samples: Sample[] = [];
  for (let y = 0; y < image.height; y += stride) for (let x = 0; x < image.width; x += stride) {
    const i = (y * image.width + x) * 4;
    const r = image.data[i]!, g = image.data[i + 1]!, b = image.data[i + 2]!, a = image.data[i + 3]!;
    if (a < 16) continue; // Outside the balloon's own mask: not this balloon's tone.
    samples.push({ r, g, b, luminance: luminanceOf(r, g, b) });
  }
  return samples;
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[index]!;
}

/** The dominant luminance, read off a coarse histogram - robust to a crop that is mostly
 *  background and only sparsely inked, which a plain mean or median is not: a balloon that
 *  is 85% paper and 15% ink has a mean pulled dark by the ink, but its background is still
 *  exactly as bright as it looks. */
function dominantLuminance(samples: readonly Sample[]): number {
  if (samples.length === 0) return 255;
  const buckets = new Array<number>(32).fill(0);
  for (const value of samples) buckets[Math.min(31, Math.floor(value.luminance / 8))]!++;
  let best = 0;
  for (let i = 1; i < buckets.length; i++) if (buckets[i]! > buckets[best]!) best = i;
  return best * 8 + 4;
}

/** How colourful the average tone near the background actually looks - the spread between
 *  its strongest and weakest channel, as a share of the full 0..255 range. Plain HSL
 *  saturation is the wrong tool here: its own formula inflates toward 1 for any tint at
 *  all once lightness sits near white, so a barely-yellowed page would score as "vividly
 *  saturated" purely for being pale. This raw channel spread tracks what a reader actually
 *  sees - aged paper reads as a small spread, a drawn orange caption box as a much bigger
 *  one - which is the "flat white/cream/grey paper" versus "a drawn, coloured panel" test
 *  this whole module needs. */
function backgroundChroma(samples: readonly Sample[], backgroundLuminance: number): number {
  const near = samples.filter(value => Math.abs(value.luminance - backgroundLuminance) < 24);
  const pool = near.length >= 8 ? near : samples;
  if (pool.length === 0) return 0;
  let r = 0, g = 0, b = 0;
  for (const value of pool) { r += value.r; g += value.g; b += value.b; }
  r /= pool.length; g /= pool.length; b /= pool.length;
  return (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
}

/** Edge energy on the same coarse grid the other metrics read, as a simple centred
 *  gradient magnitude - cheap enough to run on every balloon a reader opens, and only ever
 *  compared to itself (sharper beats softer), never asked to be an absolute measurement. */
function edgeEnergy(image: ImageData, stride: number): number {
  const { width, height, data } = image;
  let total = 0, count = 0;
  for (let y = stride; y < height - stride; y += stride) for (let x = stride; x < width - stride; x += stride) {
    const at = (px: number, py: number): number => {
      const i = (py * width + px) * 4;
      return luminanceOf(data[i]!, data[i + 1]!, data[i + 2]!);
    };
    const gx = at(x + stride, y) - at(x - stride, y), gy = at(x, y + stride) - at(x, y - stride);
    total += Math.hypot(gx, gy); count++;
  }
  return count > 0 ? total / count : 0;
}

/** Local wobble near the background's own tone: a real flat background barely moves from
 *  one pixel to its neighbour, so any variance found there is grain or compression, not
 *  the art - ink itself is excluded, so a crisp letterform is never mistaken for noise. */
function backgroundWobble(image: ImageData, stride: number, backgroundLuminance: number): number {
  const { width, height, data } = image;
  let total = 0, count = 0;
  for (let y = stride; y < height - stride; y += stride) for (let x = stride; x < width - stride; x += stride) {
    const i = (y * width + x) * 4;
    const centre = luminanceOf(data[i]!, data[i + 1]!, data[i + 2]!);
    if (Math.abs(centre - backgroundLuminance) > 20) continue;
    const right = ((y * width) + x + 1) * 4, down = (((y + 1) * width) + x) * 4;
    const neighbourX = luminanceOf(data[right]!, data[right + 1]!, data[right + 2]!);
    const neighbourY = luminanceOf(data[down]!, data[down + 1]!, data[down + 2]!);
    total += Math.abs(centre - neighbourX) + Math.abs(centre - neighbourY); count++;
  }
  return count > 0 ? total / (2 * count) : 0;
}

/** A sharp, clean, high-contrast scan's typical edge energy on this grid - the yardstick
 *  `sharpness` is read against. Not a universal constant, just a working reference high
 *  enough that real sharp art saturates near 1 and a soft scan reads well under it. */
const SHARP_EDGE_REFERENCE = 48;
/** Background wobble at or above this is read as fully noisy (sharpness-independent). */
const NOISE_REFERENCE = 10;

export function comicAnalyzeBalloonQuality(image: ImageData): ComicBalloonQualityMetrics {
  const samples = sample(image);
  const luminances = samples.map(value => value.luminance).sort((a, b) => a - b);
  const low = percentile(luminances, .05), high = percentile(luminances, .95);
  const contrast = Math.max(0, Math.min(1, (high - low) / 255));
  const backgroundLuminance = dominantLuminance(samples);
  const chroma = backgroundChroma(samples, backgroundLuminance);
  const stride = Math.max(1, Math.floor(Math.sqrt((image.width * image.height) / 4000)));
  const sharpness = Math.max(0, Math.min(1, edgeEnergy(image, stride) / SHARP_EDGE_REFERENCE));
  const noise = Math.max(0, Math.min(1, backgroundWobble(image, stride, backgroundLuminance) / NOISE_REFERENCE));
  // Whichever way the actual ink - the pixels that are clearly not the background tone -
  // leans, darker or lighter than that background: direct evidence of which this balloon
  // is, rather than assuming every balloon is dark letters on a pale fill.
  const ink = samples.filter(value => Math.abs(value.luminance - backgroundLuminance) > 30);
  const darkOnLight = ink.length > 0
    ? ink.filter(value => value.luminance < backgroundLuminance).length >= ink.length / 2
    : backgroundLuminance >= 128;
  return {
    contrast, noise, sharpness, backgroundLuminance,
    // .22 comfortably covers a yellowed, foxed or sepia-toned old page (a mild, pervasive
    // tint) while still excluding a deliberately drawn, saturated caption or panel colour.
    neutralBackground: chroma < .22,
    darkOnLight,
  };
}
