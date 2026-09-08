import { unzipSync } from "fflate";

export interface ZipSecurityLimits {
  maxFiles: number;
  maxExpandedBytes: number;
  maxExpansionRatio: number;
}

export class ZipSecurityValidator {
  public constructor(private readonly limits: ZipSecurityLimits = { maxFiles: 1000, maxExpandedBytes: 250 * 1024 * 1024, maxExpansionRatio: 100 }) {}

  public validatePath(path: string): void {
    const normalized = path.replace(/\\/g, "/");
    if (normalized.startsWith("/") || normalized.includes("../") || normalized === ".." || /^[a-zA-Z]:\//.test(normalized)) throw new Error("zipTraversal");
  }

  public validate(bytes: Uint8Array): void {
    const archive = unzipSync(bytes);
    const entries = Object.entries(archive);
    if (entries.length > this.limits.maxFiles) throw new Error("zipTooManyFiles");
    let expanded = 0;
    entries.forEach(([path, content]) => {
      this.validatePath(path);
      expanded += content.byteLength;
    });
    if (expanded > this.limits.maxExpandedBytes || expanded / Math.max(bytes.byteLength, 1) > this.limits.maxExpansionRatio) throw new Error("zipBomb");
  }
}
