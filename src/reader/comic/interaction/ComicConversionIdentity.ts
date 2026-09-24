/** Bumped whenever detection or recognition changes what a page yields, so a comic that
 *  was converted by an older pipeline is read again instead of served from the cache. */
export const COMIC_CONVERSION_VERSION = "comic-cutout-23-groups-por-3072";

export async function comicSourceKey(blob: Blob, coverPages: readonly number[] = [0]): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return `${COMIC_CONVERSION_VERSION}:${[...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("")}:${[...new Set(coverPages)].sort((a, b) => a - b).join(",")}`;
}
