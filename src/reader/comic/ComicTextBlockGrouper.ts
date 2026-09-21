import type { ComicTextFragment } from "./ComicTextTypes";

export interface ComicFragmentCluster {
  x: number; y: number; width: number; height: number;
  lines: string[];
  text: string;
  confidence?: number;
}

/** Turns loose words and lines into the visual regions a reader actually taps.
 *
 *  The rule is proximity, never colour: two fragments join when their columns overlap (or
 *  nearly touch) and the vertical gap between them is smaller than about one line. That is
 *  what makes three stacked lines inside one balloon a single block, while two balloons on
 *  opposite sides of a panel stay apart - and it works the same for a white balloon, a red
 *  caption box or a plain rectangle of colour. */
export class ComicTextBlockGrouper {
  public constructor(
    private readonly verticalGapRatio = 1.1,
    private readonly horizontalGapRatio = 0.9,
    private readonly minimumFragmentHeight = 0.004,
  ) {}

  public group(fragments: readonly ComicTextFragment[]): ComicFragmentCluster[] {
    const usable = fragments
      .filter(fragment => fragment.text.trim().length > 0 && fragment.height >= this.minimumFragmentHeight)
      .map(fragment => this.cluster(fragment))
      .sort((a, b) => a.y - b.y || a.x - b.x);
    const clusters: ComicFragmentCluster[] = [];
    usable.forEach(fragment => {
      const host = clusters.find(candidate => this.near(candidate, fragment));
      if (host) this.absorb(host, fragment); else clusters.push(fragment);
    });
    // A fragment added late can bridge two clusters that were not neighbours when they were
    // created, so clusters are merged again until the set stops changing.
    let merged = true;
    while (merged) {
      merged = false;
      for (let index = 0; index < clusters.length && !merged; index++) {
        for (let other = index + 1; other < clusters.length && !merged; other++) {
          if (!this.near(clusters[index]!, clusters[other]!)) continue;
          this.absorb(clusters[index]!, clusters[other]!); clusters.splice(other, 1); merged = true;
        }
      }
    }
    return clusters.sort((a, b) => a.y - b.y || a.x - b.x);
  }

  private cluster(fragment: ComicTextFragment): ComicFragmentCluster {
    const text = fragment.text.trim();
    return { x: fragment.x, y: fragment.y, width: fragment.width, height: fragment.height, lines: [text], text, confidence: fragment.confidence };
  }

  private near(a: ComicFragmentCluster, b: ComicFragmentCluster): boolean {
    const reference = Math.max(a.height / Math.max(1, a.lines.length), b.height / Math.max(1, b.lines.length));
    const verticalGap = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.height, b.y + b.height));
    const horizontalGap = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width));
    return verticalGap <= reference * this.verticalGapRatio && horizontalGap <= reference * this.horizontalGapRatio;
  }

  private absorb(host: ComicFragmentCluster, other: ComicFragmentCluster): void {
    const right = Math.max(host.x + host.width, other.x + other.width);
    const bottom = Math.max(host.y + host.height, other.y + other.height);
    host.x = Math.min(host.x, other.x); host.y = Math.min(host.y, other.y);
    host.width = right - host.x; host.height = bottom - host.y;
    const sameLine = Math.abs(host.y - other.y) < Math.min(host.height, other.height) * 0.5 && host.lines.length === 1 && other.lines.length === 1;
    if (sameLine) host.lines = [`${host.lines[0]} ${other.lines[0]}`.trim()];
    else host.lines = [...host.lines, ...other.lines];
    host.text = host.lines.join(" ");
    const confidences = [host.confidence, other.confidence].filter((value): value is number => typeof value === "number");
    host.confidence = confidences.length ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length : undefined;
  }
}
