/** Case/accent/punctuation-insensitive, token-based search: every query term - split on
 *  whitespace after folding accents, hyphens, underscores and punctuation to spaces - must
 *  prefix some whole word across the given fields, in any order, in any field. A term only
 *  matches at a word's start, never anywhere inside it: "art" must not match "Martin" just
 *  because the letters occur there, so a short, real word ("Art") is never lost among
 *  longer, unrelated ones. */
export function matchesCatalogText(query: string, fields: readonly (string | null | undefined)[]): boolean {
  const normalize = (value: string): string => value.normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const words = normalize(fields.filter((field): field is string => typeof field === "string").join(" ")).split(/\s+/);
  return terms.every((term) => words.some((word) => word.startsWith(term)));
}
