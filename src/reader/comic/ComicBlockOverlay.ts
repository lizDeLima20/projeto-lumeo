import { ComicBlockSelection } from "./ComicBlockSelection";
import type { ComicTextBlock } from "./ComicTextTypes";

/** The invisible layer over the artwork. For every block it mounts two things at once: a
 *  transparent hotspot over the original region, and the enlarged HTML version of that
 *  block, already built and already hidden. Tapping only flips a class - nothing is
 *  recognized, laid out or fetched at that moment. */
export class ComicBlockOverlay {
  private readonly selection = new ComicBlockSelection();
  private root: HTMLElement | null = null;
  private readonly panels = new Map<string, HTMLElement>();
  private readonly hotspots = new Map<string, HTMLElement>();

  public render(): HTMLElement {
    const root = document.createElement("div");
    root.className = "comic-overlay";
    // A tap on the artwork itself, outside any open block, puts the page back as it was.
    root.addEventListener("pointerdown", event => { if (event.target === root) this.apply(this.selection.close()); });
    this.root = root; return root;
  }

  public get openBlockId(): string | null { return this.selection.openId; }
  public get blockCount(): number { return this.panels.size; }

  public setBlocks(blocks: readonly ComicTextBlock[]): void {
    this.clear();
    const root = this.root; if (!root) return;
    blocks.forEach(block => {
      const hotspot = document.createElement("button");
      hotspot.type = "button"; hotspot.className = "comic-hotspot"; hotspot.dataset.blockId = block.id;
      hotspot.setAttribute("aria-label", block.text.slice(0, 120));
      hotspot.setAttribute("aria-expanded", "false");
      this.place(hotspot, block);
      hotspot.addEventListener("click", event => { event.stopPropagation(); this.apply(this.selection.toggle(block.id)); });

      const panel = document.createElement("div");
      panel.className = `comic-block comic-block--${block.shape}`; panel.dataset.blockId = block.id;
      panel.hidden = true; panel.setAttribute("aria-hidden", "true");
      panel.style.setProperty("--comic-block-background", block.background);
      panel.style.setProperty("--comic-block-ink", block.ink);
      panel.style.top = `${this.clampPercent(block.y + block.height / 2)}%`;
      const text = document.createElement("p"); text.className = "comic-block__text";
      block.lines.forEach((line, index) => { if (index) text.append(document.createElement("br")); text.append(line); });
      panel.append(text);
      panel.addEventListener("click", event => { event.stopPropagation(); this.apply(this.selection.toggle(block.id)); });

      this.hotspots.set(block.id, hotspot); this.panels.set(block.id, panel);
      root.append(hotspot, panel);
    });
  }

  /** Turning the page closes whatever was open before the new page is prepared. */
  public clear(): void {
    this.selection.close();
    this.panels.forEach(panel => panel.remove()); this.hotspots.forEach(hotspot => hotspot.remove());
    this.panels.clear(); this.hotspots.clear();
    this.root?.classList.remove("comic-overlay--open");
  }

  public close(): void { this.apply(this.selection.close()); }

  private apply(openId: string | null): void {
    this.panels.forEach((panel, id) => {
      const open = id === openId;
      panel.hidden = !open; panel.setAttribute("aria-hidden", String(!open));
      panel.classList.toggle("comic-block--open", open);
      this.hotspots.get(id)?.setAttribute("aria-expanded", String(open));
    });
    this.root?.classList.toggle("comic-overlay--open", openId !== null);
  }

  private place(hotspot: HTMLElement, block: ComicTextBlock): void {
    hotspot.style.left = `${block.x * 100}%`; hotspot.style.top = `${block.y * 100}%`;
    hotspot.style.width = `${block.width * 100}%`; hotspot.style.height = `${block.height * 100}%`;
  }
  private clampPercent(value: number): number { return Math.min(92, Math.max(8, value * 100)); }
}
