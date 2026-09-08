export interface BookRotationComponents { rotateX: string; rotateY: string; rotateZ: string; }
export interface BookFocusTransformPair { resting: BookRotationComponents; focused: BookRotationComponents; }

/** Permanent guard against the rotation regression: focus must reuse the resting
 *  rotation verbatim. Reads the stylesheet text rather than a live DOM so it can run
 *  in the standard suite on every branch, and fails the moment any edit makes the
 *  focused transform rotate differently from the resting one. */
export class BookFocusTransformAudit {
  public static readonly restingSelector = ".book-3d--physical > .book-3d__volume";
  public static readonly focusedSelector = ".book-card--selected .book-3d--physical > .book-3d__volume";

  public rotationOf(declaration: string): BookRotationComponents {
    const read = (fn: "rotateX" | "rotateY" | "rotateZ"): string => {
      const match = declaration.match(new RegExp(`${fn}\\(([^)]*)\\)`));
      return match?.[1]?.trim() ?? "";
    };
    return { rotateX: read("rotateX"), rotateY: read("rotateY"), rotateZ: read("rotateZ") };
  }

  /** Pulls the transform declaration that follows a selector in the stylesheet. */
  public transformFor(css: string, selector: string): string {
    const at = css.indexOf(selector);
    if (at < 0) throw new Error(`selector not found: ${selector}`);
    const body = css.slice(css.indexOf("{", at) + 1, css.indexOf("}", at));
    const declaration = body.split(";").map(part => part.trim()).find(part => part.startsWith("transform:"));
    if (!declaration) throw new Error(`no transform declared for: ${selector}`);
    return declaration;
  }

  public audit(css: string): BookFocusTransformPair {
    return {
      resting: this.rotationOf(this.transformFor(css, BookFocusTransformAudit.restingSelector)),
      focused: this.rotationOf(this.transformFor(css, BookFocusTransformAudit.focusedSelector)),
    };
  }

  public rotationIsIdentical(css: string): boolean {
    const { resting, focused } = this.audit(css);
    return resting.rotateX === focused.rotateX && resting.rotateY === focused.rotateY && resting.rotateZ === focused.rotateZ;
  }
}
