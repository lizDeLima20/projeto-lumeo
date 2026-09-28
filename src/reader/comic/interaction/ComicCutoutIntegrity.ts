import { sealComicArtMask } from "./ComicShapeMask";

/** Fill enclosed alpha holes after ALL stencil operations, not only before carving
 * neighbours. Never recolour pixels or paint an independent neighbouring balloon. */
export function comicSealCutoutAlpha(alpha: Uint8Array, width: number, height: number,
  excluded?: Uint8Array): { alpha: Uint8Array; holesFilled: number } {
  if (alpha.length !== width * height || (excluded && excluded.length !== alpha.length)) throw new Error("Invalid cutout dimensions");
  const body = Uint8Array.from(alpha, value => value ? 1 : 0);
  const sealed = sealComicArtMask({ width, height, data: body }, 0);
  const result = new Uint8Array(alpha); let holesFilled = 0;
  for (let i = 0; i < result.length; i++) {
    if (excluded?.[i]) { result[i] = 0; continue; }
    if (!result[i] && sealed.data[i]) { result[i] = 255; holesFilled++; }
  }
  return { alpha: result, holesFilled };
}
