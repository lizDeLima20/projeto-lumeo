export interface PublicDriveFolderFile { fileId: string; name: string; }

/** Reads the public HTML representation used by legacy Drive shares. */
export class PublicDriveFolderReader {
  public constructor(private readonly fetcher: typeof fetch = fetch) {}

  public async files(folderId: string): Promise<readonly PublicDriveFolderFile[]> {
    const response = await this.fetcher(`https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}`, { headers: { "User-Agent": "Lumeo catalog public reader" } });
    if (!response.ok) throw new Error("CATALOG_PUBLIC_SOURCE_UNAVAILABLE");
    return this.parse(await response.text());
  }

  private parse(html: string): readonly PublicDriveFolderFile[] {
    const values: PublicDriveFolderFile[] = [], seen = new Set<string>();
    const pattern = /<tr[^>]*data-id="([A-Za-z0-9_-]{10,})"[\s\S]*?aria-label="([^"]+)"/gi;
    for (let match; (match = pattern.exec(html));) {
      const fileId = match[1]!;
      if (seen.has(fileId)) continue;
      seen.add(fileId);
      values.push({ fileId, name: this.decode(match[2]!).replace(/\s+(?:PDF|EPUB|JSON|Unknown)\s+Shared$/i, "").trim() });
    }
    return values;
  }

  private decode(value: string): string { return value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&"); }
}
