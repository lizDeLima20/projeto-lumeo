import type { ComicBalloonQualityMetrics } from "./ComicBalloonQuality";

/** How hard to work on this one balloon, and in what way - derived once from its own
 *  measured quality (and, when available, how confident the one OCR pass already run on
 *  it was), never a single setting applied to every balloon alike. A clean modern print
 *  ends up close to all-zero here; a sun-faded sixty-year-old scan does not. */
export interface ComicBalloonEnhancementPlan {
  /** 0..1: how much of the local-contrast/unsharp step to apply. */
  sharpen: number;
  /** 0..1: how much of the background-adjacent smoothing to apply. */
  denoise: number;
  /** 0..1: how far to stretch the measured contrast range back toward full black/white. */
  contrast: number;
  /** 0..1: how far to push a neutral, pale background toward clean white. 0 outside a
   *  neutral background - a drawn, coloured panel is never whitened. */
  whiten: number;
  neutralBackground: boolean;
  darkOnLight: boolean;
  backgroundLuminance: number;
}

/** Turns measured quality into an adaptive plan. Already-good scores push every amount
 *  toward zero - "already excellent" means the upscale the caller already did is the whole
 *  answer - and a stored OCR confidence from the one recognition pass already spent on this
 *  region, when there is one, nudges the plan without ever being asked to re-read anything:
 *  a region recognition was confident about rarely benefits from heavier processing, and
 *  one it struggled with usually does. */
export function comicPlanBalloonEnhancement(metrics: ComicBalloonQualityMetrics, ocrConfidence?: number): ComicBalloonEnhancementPlan {
  const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
  // -0.3..+0.2: a struggling pass (low confidence) asks for a little more; a confident one
  // asks for a little less. Modest on purpose - pixel evidence still leads the decision.
  const confidenceNudge = ocrConfidence === undefined ? 0 : clamp01(1 - ocrConfidence) * .3 - .1;
  const need = clamp01((1 - metrics.contrast) * .7 + (1 - metrics.sharpness) * .3 + confidenceNudge);
  const denoise = clamp01((metrics.noise - .25) * .8);
  // Sharpening a still-noisy image amplifies the noise it was just asked to calm; the two
  // trade off against each other rather than stacking at full strength together.
  const sharpen = clamp01((1 - metrics.sharpness) * .6 + confidenceNudge) * (1 - denoise * .5);
  const contrast = clamp01(need * .85);
  const whiten = metrics.neutralBackground && metrics.darkOnLight ? clamp01((1 - metrics.contrast) * .75 + confidenceNudge) : 0;
  return { sharpen, denoise, contrast, whiten, neutralBackground: metrics.neutralBackground,
    darkOnLight: metrics.darkOnLight, backgroundLuminance: metrics.backgroundLuminance };
}

const luminanceOf = (r: number, g: number, b: number): number => 0.299 * r + 0.587 * g + 0.114 * b;
const clampByte = (value: number): number => value < 0 ? 0 : value > 255 ? 255 : value;

/** Background-adjacent smoothing only - a 3x3 box average blended in near the balloon's
 *  own background tone, and left alone everywhere ink is (anything far enough from that
 *  tone to be a letter, a tail, an outline). Grain in a scanned background is smoothed;
 *  a thin stroke is never touched, so it can never be softened into illegibility. */
function denoiseBackground(image: ImageData, amount: number, backgroundLuminance: number): void {
  if (amount <= 0) return;
  const { width, height, data } = image;
  const source = new Uint8ClampedArray(data);
  const at = (x: number, y: number, channel: number): number => source[(y * width + x) * 4 + channel]!;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    const luminance = luminanceOf(source[i]!, source[i + 1]!, source[i + 2]!);
    if (Math.abs(luminance - backgroundLuminance) > 26) continue; // Ink: left exactly as it was.
    const x0 = Math.max(0, x - 1), x1 = Math.min(width - 1, x + 1), y0 = Math.max(0, y - 1), y1 = Math.min(height - 1, y + 1);
    for (let channel = 0; channel < 3; channel++) {
      let sum = 0, count = 0;
      for (let ny = y0; ny <= y1; ny++) for (let nx = x0; nx <= x1; nx++) { sum += at(nx, ny, channel); count++; }
      const averaged = sum / count;
      data[i + channel] = clampByte(source[i + channel]! + (averaged - source[i + channel]!) * amount);
    }
  }
}

/** Stretches the measured luminance range back toward full black/white, applied through a
 *  per-pixel luminance ratio so hue and saturation carry through untouched - a coloured
 *  balloon keeps its colour, a black-and-white one gets cleaner blacks and whites. */
function stretchContrast(image: ImageData, amount: number): void {
  if (amount <= 0) return;
  const { data } = image;
  const low = 16 * amount, high = 255 - 16 * amount; // Headroom: never a hard 0..255 clip.
  const span = Math.max(1, high - low);
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
    const luminance = luminanceOf(r, g, b);
    const stretched = clampByte(((luminance - low) / span) * 255);
    const ratio = luminance > 0 ? stretched / luminance : 1;
    const blended = 1 + (ratio - 1) * amount;
    data[i] = clampByte(r * blended); data[i + 1] = clampByte(g * blended); data[i + 2] = clampByte(b * blended);
  }
}

/** Pushes a pale, low-saturation background toward clean white, in a ramp that reaches
 *  full strength only well above the ink threshold and fades to none right at it - an
 *  aged, yellowed page reads cleaner without the outline, the tail or a thin letter ever
 *  being touched, because nothing within reach of ink ever moves. */
function whitenBackground(image: ImageData, amount: number, backgroundLuminance: number): void {
  if (amount <= 0) return;
  const { data } = image;
  const inkThreshold = backgroundLuminance * .72;
  const rampSpan = Math.max(1, backgroundLuminance - inkThreshold);
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
    const luminance = luminanceOf(r, g, b);
    if (luminance <= inkThreshold) continue;
    const ramp = Math.min(1, (luminance - inkThreshold) / rampSpan);
    const strength = amount * ramp;
    data[i] = clampByte(r + (255 - r) * strength); data[i + 1] = clampByte(g + (255 - g) * strength); data[i + 2] = clampByte(b + (255 - b) * strength);
  }
}

/** A classic unsharp mask - original plus a share of (original minus a soft blur) - run on
 *  luminance and carried to RGB by ratio, with the per-pixel push capped regardless of
 *  `amount` so a maximum-strength pass still cannot ring a hard halo around a letter. */
function sharpen(image: ImageData, amount: number): void {
  if (amount <= 0) return;
  const { width, height, data } = image;
  const source = new Uint8ClampedArray(data);
  const luminanceAt = (x: number, y: number): number => {
    const i = (y * width + x) * 4;
    return luminanceOf(source[i]!, source[i + 1]!, source[i + 2]!);
  };
  const MAX_DELTA = 36;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const x0 = Math.max(0, x - 1), x1 = Math.min(width - 1, x + 1), y0 = Math.max(0, y - 1), y1 = Math.min(height - 1, y + 1);
    let blurred = 0, count = 0;
    for (let ny = y0; ny <= y1; ny++) for (let nx = x0; nx <= x1; nx++) { blurred += luminanceAt(nx, ny); count++; }
    blurred /= count;
    const i = (y * width + x) * 4;
    const luminance = luminanceOf(source[i]!, source[i + 1]!, source[i + 2]!);
    const delta = Math.max(-MAX_DELTA, Math.min(MAX_DELTA, (luminance - blurred) * amount * 1.6));
    const target = luminance + delta;
    const ratio = luminance > 0 ? target / luminance : 1;
    data[i] = clampByte(source[i]! * ratio); data[i + 1] = clampByte(source[i + 1]! * ratio); data[i + 2] = clampByte(source[i + 2]! * ratio);
  }
}

/** The whole adaptive pass, in the order a reader's eye would forgive: clean up grain
 *  first, so sharpening next does not amplify it; normalize and, where it belongs, whiten
 *  the background; sharpen last, once there is nothing left to sharpen but the art itself.
 *  Mutates and returns the same ImageData - the caller already owns a disposable copy
 *  (a fresh canvas read-back), never the cached original asset. */
export function comicEnhanceBalloonImage(image: ImageData, plan: ComicBalloonEnhancementPlan): ImageData {
  denoiseBackground(image, plan.denoise, plan.backgroundLuminance);
  stretchContrast(image, plan.contrast);
  if (plan.whiten > 0) whitenBackground(image, plan.whiten, plan.backgroundLuminance);
  sharpen(image, plan.sharpen);
  return image;
}
