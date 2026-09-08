import { strFromU8, unzipSync } from "fflate";
import type { MetadataSourceExtractor, NativeBookMetadata } from "./MetadataTypes";
import { EpubSanitizer } from "../security/EpubSanitizer";
export class EpubMetadataExtractor implements MetadataSourceExtractor {
  public constructor(private readonly sanitizer = new EpubSanitizer()) {}
  public async extract(file: File): Promise<NativeBookMetadata> {
    const archive = unzipSync(new Uint8Array(await file.arrayBuffer())); const container = archive["META-INF/container.xml"];
    if (!container) return {}; const opfPath = this.attribute(strFromU8(container), "full-path"); const opfBytes = archive[opfPath]; if (!opfBytes) return {};
    const opf = this.sanitizer.sanitize(strFromU8(opfBytes)); return { title: this.element(opf, "title"), author: this.element(opf, "creator"), subject: this.element(opf, "subject"), keywords: this.element(opf, "description") };
  }
  private element(xml: string, name: string): string | undefined { const value = xml.match(new RegExp(`<[^>]*:?${name}\\b[^>]*>([\\s\\S]*?)<\\/[^>]*:?${name}>`, "i"))?.[1]; return value ? this.decode(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()) : undefined; }
  private attribute(xml: string, name: string): string { return xml.match(new RegExp(`${name}=["']([^"']+)["']`, "i"))?.[1] ?? ""; }
  private decode(value: string): string { return this.sanitizer.decodeEntities(value); }
}
