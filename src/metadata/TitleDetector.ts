import type { DetectedValue, NativeBookMetadata } from "./MetadataTypes";
export class TitleDetector {
  public detect(metadata: NativeBookMetadata, filename: string): DetectedValue {
    const native = this.clean(metadata.title ?? ""); if (this.reliable(native)) return { value: native, confidence: "high" };
    const lines = this.lines(metadata.firstPageText ?? "").filter(line => !/^(por|autor(?:a)?\s*:)/i.test(line));
    const candidate = lines.find(line => line.length >= 3 && line.length <= 100);
    if (candidate) return { value: this.titleCase(candidate), confidence: "medium" };
    return { value: this.titleCase(filename.replace(/\.(pdf|epub)$/i, "").replace(/[_-]+/g, " ").trim()), confidence: "low" };
  }
  private reliable(value: string): boolean { return value.length >= 2 && !/^(untitled|sem título|microsoft word)/i.test(value); }
  private clean(value: string): string { return value.replace(/\s+/g, " ").trim(); }
  private lines(text: string): string[] { return text.split(/\r?\n|\s{3,}/).map(line => this.clean(line)).filter(Boolean); }
  private titleCase(value: string): string { return value === value.toUpperCase() ? value.toLocaleLowerCase().replace(/(^|\s)\p{L}/gu, char => char.toLocaleUpperCase()) : value; }
}
