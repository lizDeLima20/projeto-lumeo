import type { ReaderCoverPage } from "../reader/reflow/ReaderDocument";

/**
 * The cover is a real leaf in the reader, shared by the single-page and spread
 * renderers.  Sampling three horizontal bands keeps any space created by a crop
 * visually tied to the imported cover instead of falling back to generic paper.
 */
export class ReaderCoverPageView {
  public render(cover: ReaderCoverPage): HTMLElement {
    const frame = document.createElement("div");
    frame.className = "reader-cover-page";
    this.setPalette(frame, "#161319", "#24202a", "#101014");
    if (!cover.image) {
      const fallback = document.createElement("div");
      fallback.className = "reader-cover-page__fallback";
      fallback.textContent = cover.title.slice(0, 2).toUpperCase();
      frame.append(fallback);
      return frame;
    }
    const image = document.createElement("img");
    image.src = cover.image;
    image.alt = `Capa de ${cover.title}`;
    image.addEventListener("load", () => this.samplePalette(image, frame), { once: true });
    frame.append(image);
    return frame;
  }

  private samplePalette(image: HTMLImageElement, frame: HTMLElement): void {
    try {
      const width = Math.max(1, Math.min(48, image.naturalWidth));
      const height = Math.max(3, Math.min(96, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return;
      context.drawImage(image, 0, 0, width, height);
      const band = Math.max(1, Math.floor(height / 3));
      this.setPalette(
        frame,
        this.average(context.getImageData(0, 0, width, band).data),
        this.average(context.getImageData(0, band, width, Math.min(band, height - band)).data),
        this.average(context.getImageData(0, Math.min(height - band, band * 2), width, band).data),
      );
    } catch {
      // A remote image can be canvas-tainted. The actual cover remains visible and the
      // neutral dark palette still avoids paper-coloured bars around it.
    }
  }

  private average(data: Uint8ClampedArray): string {
    let red = 0, green = 0, blue = 0, count = 0;
    for (let index = 0; index < data.length; index += 4) {
      const alpha = data[index + 3] ?? 0;
      if (!alpha) continue;
      red += data[index] ?? 0; green += data[index + 1] ?? 0; blue += data[index + 2] ?? 0; count++;
    }
    if (!count) return "#161319";
    return `rgb(${Math.round(red / count)} ${Math.round(green / count)} ${Math.round(blue / count)})`;
  }

  private setPalette(frame: HTMLElement, top: string, middle: string, bottom: string): void {
    frame.style.setProperty("--cover-color-top", top);
    frame.style.setProperty("--cover-color-middle", middle);
    frame.style.setProperty("--cover-color-bottom", bottom);
  }
}
