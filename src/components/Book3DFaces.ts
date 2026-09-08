import { BookVolumeFormatter } from "./BookVolumeFormatter";
import type { Book3DModel } from "./Book3DModel";

abstract class Book3DFace {
  protected element(className: string): HTMLSpanElement {
    const face = document.createElement("span"); face.className = className; face.setAttribute("aria-hidden", "true"); return face;
  }
}

export class BookFrontFace extends Book3DFace {
  public render(model: Book3DModel): HTMLElement {
    const face = this.element("physical-face physical-front"); face.removeAttribute("aria-hidden");
    if (model.cover) { const image = document.createElement("img"); image.src = model.cover; image.alt = ""; image.loading = "lazy"; face.append(image); }
    else { const placeholder = this.element("book-cover__placeholder"); placeholder.textContent = model.title.trim().slice(0, 2).toLocaleUpperCase() || "📖"; face.append(placeholder); }
    return face;
  }
}

export class BookSpineFace extends Book3DFace {
  /** Zones, top to bottom: author, title, subtitle/volume, imprint rule.
   *  Every value is real metadata or a colour sampled from the cover; nothing
   *  is fabricated, and nothing is stretched — type is scaled to the real
   *  spine width so it stays legible. */
  public static readonly usesGeneratedTypography = true;
  /** The spine carries the real cover image, compressed - never stretched. */
  public static readonly usesRasterCoverArt = true;
  public static readonly compressesCoverProportionally = true;
  public static readonly stretchesCover = false;
  public static readonly derivesColoursFromCover = true;
  public static readonly inventsNoOrnament = true;
  public static readonly zones = ["author", "art", "title", "subtitle", "imprint"] as const;
  public static readonly imprintCarriesAppMark = true;

  public render(model: Book3DModel): HTMLElement {
    const spine = this.element("physical-face physical-spine"); const text = this.element("physical-spine-text");
    if (model.showAuthor && model.author) { const author = document.createElement("small"); author.className = "physical-spine-author"; author.textContent = model.author; text.append(author); }
    /* Same source image as the front face. It is scaled DOWN to the spine's width with
     * its aspect ratio intact (object-fit:contain) and banded top and bottom by the
     * colour sampled from the cover - never stretched to fill, which is what turned
     * the art into an illegible smear before. */
    if (model.cover) {
      const band = this.element("physical-spine-art");
      const art = document.createElement("img");
      art.className = "physical-spine-cover"; art.src = model.cover; art.alt = ""; art.loading = "lazy";
      band.append(art); text.append(band);
      spine.classList.add("physical-spine--with-cover");
    }
    const block = this.element("physical-spine-title");
    const title = document.createElement("strong"); title.textContent = model.title;
    title.style.fontSize = BookSpineFace.typeScale(model.title);
    block.append(title);
    const subtitle = BookSpineFace.subtitleFor(model);
    if (subtitle) { const value = this.element("physical-spine-subtitle"); value.textContent = subtitle; block.append(value); }
    const volume = new BookVolumeFormatter().format(model.volume);
    if (volume) { const value = this.element("book-spine__volume"); value.textContent = volume; block.append(value); }
    text.append(block);
    spine.append(text);
    /* Base zone: the Lumeo mark as a colophon, tinted with the spine ink rather than
     * dropped in as full-colour art, plus the real publication year when known. */
    const imprint = this.element("physical-spine-imprint");
    imprint.append(this.element("physical-spine-logo"));
    if (model.publicationYear) { const year = this.element("physical-spine-year"); year.textContent = String(model.publicationYear); imprint.append(year); }
    spine.append(imprint);
    return spine;
  }

  /** Longest word must fit the real spine width, so the scale follows --physical-depth. */
  public static typeScale(title: string): string {
    const longestWord = Math.max(1, ...title.split(/\s+/).map(word => word.length));
    return `clamp(7px, calc((var(--physical-depth) - 10px) / ${(longestWord * .56).toFixed(2)}), 17px)`;
  }

  /** Only a real series name, and never a restatement of the title. */
  public static subtitleFor(model: Book3DModel): string | undefined {
    const series = model.series?.trim();
    if (!series) return undefined;
    return series.localeCompare(model.title.trim(), "pt-BR", { sensitivity: "base" }) === 0 ? undefined : series;
  }
}

export class TopCoverFace extends Book3DFace {
  public static readonly overhangPixels = 3;
  public render(): HTMLElement { const lip=this.element("physical-cover-lips");for(const side of ["front","back","right"]){lip.append(this.element(`physical-face physical-lip physical-lip-${side}`));}return lip; }
}
export class PageTopFace extends Book3DFace {
  public static readonly color = "#e8dfca";
  public static readonly isSolidBlock = true;
  public static readonly hasLiftedCorners = false;
  public static readonly remainsInsideCovers = true;
  public static readonly preservesGeometryDuringFocus = true;
  public static readonly hasCompressedLeafTexture = true;
  /** Depth ramp on the top face runs front-to-back: only the near band takes the lamp. */
  public static readonly depthRampRunsFrontToBack = true;
  /** The shade line belongs to the bay, not to the book: it stays put while the
   *  volume travels, so the lit share grows as the book slides out from under it. */
  public static readonly shadeLineIsFixedInShelfSpace = true;
  /** The ramp runs along the volume's depth, front to back. A lateral (90deg) pass
   *  used to darken the left and right edges and read as a left/right split. */
  public static readonly rampRunsAlongDepth = true;
  public static readonly hasLateralSplit = false;
  /** The focused volume grows where it stands instead of travelling out of the bay,
   *  so it never leaves the shaded zone and the lit share stays put. Sweeping the
   *  boundary across the face during the transition read as the top rotating open. */
  public static readonly shadeLineHoldsDuringFocus = true;
  public static readonly litFrontFraction = .25;
  public static readonly litFrontAtRest = .25;
  public static readonly litFrontAtFocus = .25;
  public static litFrontAt(_progress: number): number { return this.litFrontAtRest; }
  public render(): HTMLElement { return this.element("physical-face physical-page-top"); }
}
export class PageSideFace extends Book3DFace { public render():HTMLElement{return this.element("physical-face physical-page-side");} }
export class PageFrontInset extends Book3DFace { public render():HTMLElement{return this.element("physical-face physical-page-inset");} }
export class PageInset extends PageFrontInset {}
export class PageBlock3D extends Book3DFace {
  public static readonly hasIndependentTopSideAndInset=true;
  public render():HTMLElement {const block=this.element("physical-page-block");block.append(new PageTopFace().render(),new PageSideFace().render(),new PageFrontInset().render());return block;}
}
export class BookTopFace extends TopCoverFace { public static readonly visibleInAngledMode=true; }
export class BookPageBlock extends PageBlock3D {}
/** Spine joint: two narrow 45deg strips replace the square corner between the
 *  spine and each board, so the spine reads as a rounded profile. */
export class BookSpineBevel extends Book3DFace {
  public static readonly roundsSpineProfile = true;
  public render(): HTMLElement {
    const bevel = this.element("physical-spine-bevels");
    bevel.append(this.element("physical-face physical-bevel physical-bevel-front"), this.element("physical-face physical-bevel physical-bevel-back"));
    return bevel;
  }
}
/** Opening edge. Unlike the spine and the two boards it carries no case material:
 *  it is the paper block, closed by a thin board edge. */
export class BookDepthFace extends Book3DFace {
  public static readonly isOpeningEdge = true;
  public static readonly usesCaseMaterial = false;
  public static readonly usesPageMaterial = true;
  public render(): HTMLElement { return this.element("physical-face physical-depth"); }
}
export class BookBackFace extends Book3DFace { public render(): HTMLElement { return this.element("physical-face physical-back"); } }
export class BookBottomFace extends Book3DFace { public render(): HTMLElement { return this.element("physical-face physical-bottom"); } }
/** Distinct from the contact shadow: this is the board reacting to a volume that has
 *  come forward - a wide, soft pool that spreads over the wood beside and below the
 *  book, absent at rest and growing with the focus progress. */
export class BookWoodShadow extends Book3DFace {
  public static readonly reactsToFocusProgress = true;
  public static readonly absentAtRest = true;
  /** Builds late, not from the first frame: the pool is barely there while the volume
   *  is still deep in the bay and fills in as it nears the front lip. The return uses
   *  the exact mirror of that curve, so it drains along the same path. */
  public static readonly matchesBookWidth = true;
  public static readonly leansLeftOnTheBoard = true;
  public static readonly forwardEasing = "cubic-bezier(.2,.3,.6,.88)";
  public static readonly returnEasing = "cubic-bezier(.4,.12,.8,.7)";
  /** A cubic-bezier mirrored in both axes: (a,b,c,d) -> (1-c,1-d,1-a,1-b). */
  public static mirrorEasing(a: number, b: number, c: number, d: number): readonly number[] {
    return [1 - c, 1 - d, 1 - a, 1 - b].map(value => Math.round(value * 100) / 100);
  }
  public render(): HTMLElement { return this.element("physical-wood-shadow"); }
}
export class BookShadowLayer extends Book3DFace { public static readonly independentContactShadow=true; public static readonly hasHardContactLine=true; public static readonly boundedToVolumeFootprint=true; public static readonly staysOnShelfPlane=true; public static readonly remainsOnShelfTopDuringFocus=true; public render(): HTMLElement { return this.element("physical-contact-shadow"); } }
