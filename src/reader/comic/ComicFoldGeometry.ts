import type { ComicRect } from "./ComicLayout";

export interface ComicPoint { x: number; y: number; }

/** One frame of a turning leaf, in stage pixels.
 *
 *  The leaf is the page in `slot` (hinged on its left edge, the spine). The reader holds a
 *  point of its free edge, `grab`, and has carried it to `to`. Paper does not stretch, so
 *  the leaf folds along the line of points equidistant from both: everything on the grab's
 *  side of that line is lifted and laid over, mirrored across it. */
export interface ComicFold {
  progress: number;
  grab: ComicPoint;
  to: ComicPoint;
  /** A point on the fold line and the unit normal pointing to the lifted side. */
  origin: ComicPoint;
  normal: ComicPoint;
  /** The part of the front still lying flat. */
  front: ComicPoint[];
  /** The lifted part, in the leaf's own (unfolded) coordinates. */
  flap: ComicPoint[];
  /** Maps leaf coordinates onto where the lifted part lies: the reflection across the fold. */
  reflection: Affine;
  /** The reflection, then the arch: a lifted leaf bows up off the book, so seen from above
   *  it is narrower than it lies flat. Exactly the reflection at 0 and at 1. */
  placement: Affine;
  /** The lifted part where it is seen, in stage pixels. */
  laid: ComicPoint[];
}

export type Affine = [number, number, number, number, number, number];

/** How much narrower the leaf looks at the top of its arc. */
export const COMIC_ARCH = .2;

export class ComicFoldGeometry {
  public constructor(private readonly slot: ComicRect) {}

  private get left(): number { return this.slot.x; }
  private get right(): number { return this.slot.x + this.slot.width; }

  /** The grab height on the free edge, kept off the very corners. */
  public grabAt(y: number): ComicPoint {
    const margin = this.slot.height * .04;
    return { x: this.right, y: Math.min(this.slot.y + this.slot.height - margin, Math.max(this.slot.y + margin, y)) };
  }

  /** Where the grabbed point is at `progress` (0 = flat, 1 = laid on the left), with the
   *  hand's vertical offset `lift`. The offset fades to nothing at both ends, so the leaf
   *  always leaves from and lands on exactly the page's own rectangle. */
  public carry(grab: ComicPoint, progress: number, lift: number): ComicPoint {
    const t = Math.min(1, Math.max(0, progress));
    const limit = this.slot.height * .35;
    const offset = Math.max(-limit, Math.min(limit, lift)) * Math.sin(Math.PI * t);
    return this.hinge(grab, { x: this.right - 2 * this.slot.width * t, y: grab.y + offset });
  }

  /** The inverse used while dragging: how far a grabbed point at `to` has turned. */
  public progressOf(to: ComicPoint): number {
    return Math.min(1, Math.max(0, (this.right - to.x) / (2 * this.slot.width)));
  }

  public fold(grab: ComicPoint, progress: number, lift: number): ComicFold {
    const to = this.carry(grab, progress, lift);
    const dx = grab.x - to.x, dy = grab.y - to.y, length = Math.hypot(dx, dy);
    const corners = this.corners();
    if (length < .5) {
      return { progress: 0, grab, to, origin: grab, normal: { x: 1, y: 0 }, front: corners, flap: [],
        reflection: [1, 0, 0, 1, 0, 0], placement: [1, 0, 0, 1, 0, 0], laid: [] };
    }
    const normal = { x: dx / length, y: dy / length };
    const origin = { x: (grab.x + to.x) / 2, y: (grab.y + to.y) / 2 };
    const side = (point: ComicPoint): number => (point.x - origin.x) * normal.x + (point.y - origin.y) * normal.y;
    // Reflection across the line through `origin` with unit normal n: p' = p - 2((p-o).n)n.
    const a = 1 - 2 * normal.x * normal.x, b = -2 * normal.x * normal.y, d = 1 - 2 * normal.y * normal.y;
    const shift = 2 * (origin.x * normal.x + origin.y * normal.y);
    const reflection: Affine = [a, b, b, d, shift * normal.x, shift * normal.y];
    // The arch: distances from the fold line shrink by `keep`, the fold line itself stays.
    const t = Math.min(1, Math.max(0, progress)), keep = 1 - COMIC_ARCH * Math.sin(Math.PI * t), squeeze = 1 - keep;
    const along = origin.x * normal.x + origin.y * normal.y;
    const arch: Affine = [1 - squeeze * normal.x * normal.x, -squeeze * normal.x * normal.y, -squeeze * normal.x * normal.y,
      1 - squeeze * normal.y * normal.y, squeeze * along * normal.x, squeeze * along * normal.y];
    const placement = ComicFoldGeometry.compose(arch, reflection);
    const flap = ComicFoldGeometry.clip(corners, side);
    return {
      progress: t, grab, to, origin, normal,
      front: ComicFoldGeometry.clip(corners, point => -side(point)),
      flap, reflection, placement, laid: flap.map(point => ComicFoldGeometry.apply(placement, point)),
    };
  }

  /** The leaf is hinged on the spine: the spine's two ends may never be lifted. A grabbed
   *  point can only come as close to each end as it started, which keeps both ends on the
   *  flat side of the fold (the fold never crosses the spine). */
  private hinge(grab: ComicPoint, to: ComicPoint): ComicPoint {
    const ends = [{ x: this.left, y: this.slot.y }, { x: this.left, y: this.slot.y + this.slot.height }];
    let point = { ...to };
    for (let pass = 0; pass < 4; pass++) {
      for (const end of ends) {
        const reach = Math.hypot(grab.x - end.x, grab.y - end.y);
        const distance = Math.hypot(point.x - end.x, point.y - end.y);
        if (distance > reach && distance > 0) point = { x: end.x + (point.x - end.x) * reach / distance, y: end.y + (point.y - end.y) * reach / distance };
      }
    }
    return point;
  }

  private corners(): ComicPoint[] {
    const { x, y, width, height } = this.slot;
    return [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }];
  }

  public static apply(m: Affine, point: ComicPoint): ComicPoint {
    return { x: m[0] * point.x + m[2] * point.y + m[4], y: m[1] * point.x + m[3] * point.y + m[5] };
  }

  /** `outer` after `inner`, in canvas setTransform order. */
  public static compose(outer: Affine, inner: Affine): Affine {
    const [a1, b1, c1, d1, e1, f1] = outer, [a2, b2, c2, d2, e2, f2] = inner;
    return [a1 * a2 + c1 * b2, b1 * a2 + d1 * b2, a1 * c2 + c1 * d2, b1 * c2 + d1 * d2,
      a1 * e2 + c1 * f2 + e1, b1 * e2 + d1 * f2 + f1];
  }

  /** The part of a convex polygon where `side(p) >= 0` (one Sutherland-Hodgman pass). */
  public static clip(polygon: readonly ComicPoint[], side: (point: ComicPoint) => number): ComicPoint[] {
    const result: ComicPoint[] = [];
    polygon.forEach((current, index) => {
      const next = polygon[(index + 1) % polygon.length]!;
      const a = side(current), b = side(next);
      if (a >= 0) result.push(current);
      if ((a >= 0) !== (b >= 0)) {
        const t = a / (a - b);
        result.push({ x: current.x + (next.x - current.x) * t, y: current.y + (next.y - current.y) * t });
      }
    });
    return result.length >= 3 ? result : [];
  }
}
