import type { DetectedValue, NativeBookMetadata } from "./MetadataTypes";
export class AuthorDetector {
  public detect(metadata: NativeBookMetadata, title: string): DetectedValue | undefined {
    const native = this.clean(metadata.author ?? ""); if (this.reliable(native, title)) return { value: native, confidence: "high" };
    const text = metadata.firstPageText ?? ""; const labelled = text.match(/(?:^|\n)\s*(?:por|autor(?:a)?\s*:)\s*([\p{L}][\p{L}.'’-]+(?:\s+[\p{L}][\p{L}.'’-]+){1,4})/imu)?.[1];
    if (labelled && this.reliable(labelled, title)) return { value: this.clean(labelled), confidence: "medium" };
    return undefined;
  }
  private reliable(value: string, title: string): boolean { return value.length >= 4 && value.toLocaleLowerCase() !== title.toLocaleLowerCase() && !/^(unknown|desconhecido|admin)$/i.test(value); }
  private clean(value: string): string { return value.replace(/\s+/g, " ").trim(); }
}
