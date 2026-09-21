/** "Capítulo 2" before "Capítulo 10", and accents where a reader expects them. A plain
 *  string sort puts 10 before 2, which is exactly wrong for chapters and volumes. */
const collator = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });

export function compareNaturally(left: string, right: string): number {
  return collator.compare(left, right);
}

/** Folders first, then files, each group in natural order: a reader scanning a saga wants
 *  its arcs before its loose issues. */
export function sortEntries<T extends { name: string; kind: "folder" | "file" }>(entries: readonly T[]): T[] {
  return [...entries].sort((left, right) =>
    (left.kind === right.kind ? 0 : left.kind === "folder" ? -1 : 1) || compareNaturally(left.name, right.name));
}
