/**
 * The desktop reader has one physical page size.  The cover uses the exact
 * same rectangle as the right-hand page of an open spread, so opening a book
 * cannot cause a visible resize or jump.
 */
export interface DesktopReaderGeometryValue {
  pageWidth: number;
  pageHeight: number;
  spreadWidth: number;
  spineX: number;
}

export class DesktopReaderGeometry {
  public static readonly pageRatio = 0.68;
  public static readonly minimumPageHeight = 420;

  public forViewport(viewportWidth: number, viewportHeight: number): DesktopReaderGeometryValue {
    const usableHeight = Math.max(DesktopReaderGeometry.minimumPageHeight, viewportHeight - 168);
    const usableWidth = Math.max(560, viewportWidth - 220);
    const pageHeight = Math.min(usableHeight, usableWidth / (DesktopReaderGeometry.pageRatio * 2));
    const pageWidth = pageHeight * DesktopReaderGeometry.pageRatio;
    return { pageWidth, pageHeight, spreadWidth: pageWidth * 2, spineX: pageWidth };
  }
}
