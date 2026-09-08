import { BookBackFace, BookBottomFace, BookDepthFace, BookFrontFace, BookPageBlock, BookShadowLayer, BookSpineBevel, BookWoodShadow, BookSpineFace, BookTopFace } from "./Book3DFaces";
import { Book3DGeometry } from "./Book3DGeometry";
import type { Book3DModel } from "./Book3DModel";
import { BookSpineColorService, BookSpinePaletteService } from "./BookSpineColorService";

export class Book3D {
  public static readonly usesPreserve3D = true;
  public static readonly isPhysicalBook = true;
  public constructor(private readonly model: Book3DModel, colors = new BookSpineColorService(), private readonly palettes = new BookSpinePaletteService(colors)) {}
  public render(): HTMLElement {
    const object = document.createElement("span"); object.className = "book-3d book-3d--physical"; object.dataset.mode = this.model.mode;
    object.style.setProperty("--spine-color", this.model.spineColor); Book3DGeometry.from(this.model).applyTo(object);
    const volume=document.createElement("span");volume.className="book-3d__volume";volume.append(new BookFrontFace().render(this.model));
    if (this.model.mode !== "FRONT") volume.append(new BookSpineFace().render(this.model),new BookSpineBevel().render(),new BookTopFace().render(),new BookPageBlock().render(),new BookDepthFace().render(),new BookBackFace().render(),new BookBottomFace().render());
    object.append(new BookWoodShadow().render(),volume,new BookShadowLayer().render());
    if (this.model.cover && this.model.mode !== "FRONT") void this.palettes.palette(this.model.cover, this.model.spineColor).then(palette => {
      object.style.setProperty("--spine-color", palette.background);
      object.style.setProperty("--spine-ink", palette.ink);
    });
    return object;
  }
}
