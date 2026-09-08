import type { Book3DModel } from "./Book3DModel";

export class Book3DGeometry {
  public constructor(
    public readonly frontWidth: number,
    public readonly height: number,
    public readonly spineWidth: number,
    public readonly depth: number,
    public readonly coverThickness: number,
    public readonly pageInset: number,
  ) {}

  public static from(model: Book3DModel): Book3DGeometry {
    const frontWidth = model.dimensions.widthRem;
    return new Book3DGeometry(frontWidth, frontWidth / model.dimensions.aspectRatio,
      model.dimensions.spineRem, model.dimensions.depthRem, .25, .1875);
  }

  public applyTo(element: HTMLElement): void {
    element.style.setProperty("--book-front-width", `${this.frontWidth}rem`);
    element.style.setProperty("--book-height", `${this.height}rem`);
    element.style.setProperty("--spine-width", `${this.spineWidth}rem`);
    element.style.setProperty("--book-depth", `${this.depth}rem`);
    element.style.setProperty("--cover-thickness", `${this.coverThickness}rem`);
    element.style.setProperty("--page-inset", `${this.pageInset}rem`);
  }

  public get spineRatio(): number { return this.spineWidth / this.frontWidth; }
  public get pageBlockDepth(): number { return this.depth - this.coverThickness * 2; }
  public get formsClosedVolume(): boolean { return this.pageBlockDepth > 0 && this.spineWidth > 0 && this.depth > this.coverThickness * 2; }
  public static readonly trueThreeDimensionalGeometry = true;
}
