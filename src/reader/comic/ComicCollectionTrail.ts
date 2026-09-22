import type { Book } from "../../models/Book";

export interface TrailStep { id: string; name: string; }

/** "Capítulo 2" before "Capítulo 10", accents where a reader expects them. */
const collator = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });
export const compareNaturally = (left: string, right: string): number => collator.compare(left, right);

/** Where a comic sits in its Drive collection: root first, the folder holding the file last.
 *  Stored on the book (in collectionPath), so the shelf can group and order comics with
 *  no network at all.
 *
 *  collectionPath once held bare ids ("root/sw/v1"); that form is still read, it just
 *  carries no names. */
export class ComicCollectionTrail {
  private constructor(public readonly steps: readonly TrailStep[]) {}

  public static fromBreadcrumb(breadcrumb: readonly { id: string; name: string }[]): ComicCollectionTrail {
    return new ComicCollectionTrail(breadcrumb.map(step => ({ id: step.id, name: step.name.trim() })));
  }

  public static parse(value: string | undefined | null): ComicCollectionTrail | null {
    if (!value) return null;
    if (value.trim().startsWith("[")) {
      try {
        const steps = JSON.parse(value) as unknown;
        if (!Array.isArray(steps)) return null;
        return new ComicCollectionTrail(steps.flatMap(step => step && typeof step === "object" && typeof step.id === "string"
          ? [{ id: step.id, name: typeof step.name === "string" ? step.name : "" }] : []));
      } catch { return null; }
    }
    return new ComicCollectionTrail(value.split("/").filter(Boolean).map(id => ({ id, name: "" })));
  }

  public serialize(): string { return JSON.stringify(this.steps); }

  /** The first folder under the root: "Fênix", "Deadpool", "Guerras Secretas". */
  public get collection(): string | null { return this.steps[1]?.name || null; }
  public get collectionId(): string | null { return this.steps[1]?.id ?? null; }
  /** The folders between the collection and the file: arcs, years, volumes. */
  public get arcs(): readonly string[] { return this.steps.slice(2).map(step => step.name).filter(Boolean); }
  public get folderId(): string | null { return this.steps.at(-1)?.id ?? null; }
  public get ids(): readonly string[] { return this.steps.map(step => step.id); }
}

export interface ComicShelfRow { key: string; title: string; books: Book[]; }

/** Groups comics by the collection they belong to in Drive and orders each group the way
 *  the tree does - arc by arc, chapter by chapter, naturally. When a comic was added never
 *  matters: Fênix 01, Deadpool 01, Fênix 03, Fênix 02 is still one Fênix row, 01-02-03. */
export class ComicShelfGrouping {
  public rows(books: readonly Book[]): ComicShelfRow[] {
    const rows = new Map<string, ComicShelfRow>();
    for (const book of books) {
      const trail = ComicCollectionTrail.parse(book.collectionPath);
      const title = trail?.collection ?? book.series?.trim() ?? "";
      const key = trail?.collectionId ?? (title ? `name:${title.toLocaleLowerCase()}` : "other");
      const row = rows.get(key) ?? { key, title: title || "Outras HQs", books: [] };
      row.books.push(book); rows.set(key, row);
    }
    const ordered = [...rows.values()];
    ordered.forEach(row => row.books.sort((left, right) => compareNaturally(this.position(left), this.position(right))));
    return ordered.sort((left, right) => compareNaturally(left.title, right.title));
  }

  /** Arc names, then the file's own name: the order of the tree, not of the import. */
  public position(book: Book): string {
    const trail = ComicCollectionTrail.parse(book.collectionPath);
    const file = book.fileName.replace(/\.(pdf|epub)$/i, "");
    return [...(trail?.arcs ?? []), file].join(" / ");
  }
}
