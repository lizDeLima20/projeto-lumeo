/** Accent-insensitive search that accepts the beginning of each title/author word. */
export function matchesCatalogText(query: string, fields: readonly (string | null | undefined)[]): boolean {
  const normalize = (value: string): string => value.normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const text = normalize(fields.filter((field): field is string => typeof field === "string").join(" "));
  const words = text.split(/\s+/);
  return terms.every((term) => words.some((word) => word.startsWith(term)) || text.includes(term));
}
