/** How a crop is prepared before it is read.
 *
 *  `photo` keeps the greyscale artwork as it is, which suits clean black on white. `ink`
 *  separates letters from their background by brightness, which is what rescues dark text
 *  on yellow, red or blue. `inverted` does the same for pale text on a dark box, since
 *  recognition expects dark letters on a light page either way. */
export type ComicCropMode = "photo" | "ink" | "inverted";

export interface ComicCropPlan {
  mode: ComicCropMode;
  /** Enlargement applied to the crop. Small boxes are read far better when magnified. */
  scale: number;
  /** Quiet border added around the crop, in prepared pixels. */
  margin: number;
}

/** The attempts to make for one region, best guess first.
 *
 *  A region is read more than once only while it is still unconvincing, so a clean balloon
 *  costs a single pass and a hard caption gets the alternatives it needs. */
export function comicCropPlans(width: number, height: number, darkOnLight: boolean): ComicCropPlan[] {
  const shortest = Math.max(1, Math.min(width, height));
  // Tesseract reads best around 30px of letter height; a caption box is roughly six lines.
  const scale = shortest < 40 ? 4 : shortest < 90 ? 3 : shortest < 180 ? 2 : 1.5;
  const margin = 14;
  return darkOnLight
    ? [{ mode: "photo", scale, margin }, { mode: "ink", scale, margin }, { mode: "inverted", scale, margin }]
    : [{ mode: "inverted", scale, margin }, { mode: "ink", scale, margin }, { mode: "photo", scale, margin }];
}

/** Greyscale, enlarged, and separated into letters and background - never touching the
 *  page image itself, which stays exactly as the artist drew it. */
export function comicPrepareCrop(source: ImageData, plan: ComicCropPlan): ImageData {
  const grey = greyscale(source);
  const scaled = plan.scale === 1 ? grey : enlarge(grey, source.width, source.height, plan.scale);
  const width = plan.scale === 1 ? source.width : Math.max(1, Math.round(source.width * plan.scale));
  const height = plan.scale === 1 ? source.height : Math.max(1, Math.round(source.height * plan.scale));
  const prepared = plan.mode === "photo" ? scaled : separate(scaled, plan.mode === "inverted");
  return frame(prepared, width, height, Math.max(0, Math.round(plan.margin)));
}

/** The brightness that best splits a crop into two groups (Otsu). */
export function comicInkThreshold(values: Uint8Array): number {
  const histogram = new Float64Array(256);
  for (const value of values) histogram[value]!++;
  const total = values.length;
  let sum = 0;
  for (let level = 0; level < 256; level++) sum += level * histogram[level]!;
  let background = 0, weight = 0, first = 0, last = 0, bestScore = -1;
  for (let level = 0; level < 256; level++) {
    weight += histogram[level]!;
    if (weight === 0) continue;
    const rest = total - weight;
    if (rest === 0) break;
    background += level * histogram[level]!;
    const meanBelow = background / weight, meanAbove = (sum - background) / rest;
    const score = weight * rest * (meanBelow - meanAbove) * (meanBelow - meanAbove);
    if (score > bestScore) { bestScore = score; first = last = level; }
    else if (score === bestScore) last = level;
  }
  // Flat artwork and solid lettering leave a wide plateau of equally good cuts - between
  // the ink and the paper there is simply nothing. Taking its middle keeps the cut away
  // from the letters themselves, which is where a soft edge would grey them out.
  return Math.round((first + last) / 2);
}

/** Which way round a crop reads: dark letters on a light box, or the reverse. */
export function comicCropPolarity(source: ImageData): { darkOnLight: boolean; threshold: number } {
  const grey = greyscale(source), threshold = comicInkThreshold(grey);
  let dark = 0;
  for (const value of grey) if (value <= threshold) dark++;
  // Letters cover less of a box than its background does, whichever colour they are.
  return { darkOnLight: dark <= grey.length / 2, threshold };
}

function greyscale(source: ImageData): Uint8Array {
  const grey = new Uint8Array(source.width * source.height);
  for (let index = 0; index < grey.length; index++) {
    const offset = index * 4;
    grey[index] = (source.data[offset]! * 54 + source.data[offset + 1]! * 183 + source.data[offset + 2]! * 19) >> 8;
  }
  return grey;
}

function enlarge(grey: Uint8Array, width: number, height: number, scale: number): Uint8Array {
  const target = Math.max(1, Math.round(width * scale)), lines = Math.max(1, Math.round(height * scale));
  const out = new Uint8Array(target * lines);
  for (let y = 0; y < lines; y++) {
    const sourceY = Math.min(height - 1, Math.max(0, (y + .5) / scale - .5));
    const y0 = Math.floor(sourceY), y1 = Math.min(height - 1, y0 + 1), fy = sourceY - y0;
    for (let x = 0; x < target; x++) {
      const sourceX = Math.min(width - 1, Math.max(0, (x + .5) / scale - .5));
      const x0 = Math.floor(sourceX), x1 = Math.min(width - 1, x0 + 1), fx = sourceX - x0;
      const top = grey[y0 * width + x0]! * (1 - fx) + grey[y0 * width + x1]! * fx;
      const bottom = grey[y1 * width + x0]! * (1 - fx) + grey[y1 * width + x1]! * fx;
      out[y * target + x] = Math.round(top * (1 - fy) + bottom * fy);
    }
  }
  return out;
}

/** Letters black, background white - inverting first when the box is a dark one. */
function separate(grey: Uint8Array, inverted: boolean): Uint8Array {
  const source = inverted ? grey.map(value => 255 - value) : grey;
  const threshold = comicInkThreshold(source);
  const out = new Uint8Array(source.length);
  // A soft edge around each stroke keeps thin letters legible instead of breaking them.
  const soft = Math.max(6, Math.round(threshold * .12));
  for (let index = 0; index < source.length; index++) {
    const value = source[index]!;
    out[index] = value <= threshold - soft ? 0 : value >= threshold + soft ? 255
      : Math.round(((value - (threshold - soft)) / (soft * 2)) * 255);
  }
  return out;
}

function frame(grey: Uint8Array, width: number, height: number, margin: number): ImageData {
  const outWidth = width + margin * 2, outHeight = height + margin * 2;
  const data = new Uint8ClampedArray(outWidth * outHeight * 4).fill(255);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const value = grey[y * width + x]!, offset = ((y + margin) * outWidth + x + margin) * 4;
    data[offset] = data[offset + 1] = data[offset + 2] = value;
  }
  // A browser canvas only accepts the real thing; tests run where there is no such class.
  return typeof ImageData === "function" ? new ImageData(data, outWidth, outHeight)
    : { width: outWidth, height: outHeight, data, colorSpace: "srgb" } as ImageData;
}
