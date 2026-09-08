export type GoogleDriveUrlResult = { kind: "file"; fileId: string } | { kind: "folder"; folderId: string } | { kind: "invalid" };

export class GoogleDriveUrlParser {
  public parse(value: string | URL): GoogleDriveUrlResult {
    let url: URL;
    try { url = value instanceof URL ? value : new URL(value.trim()); } catch { return { kind: "invalid" }; }
    const host = url.hostname.toLowerCase();
    if (host !== "drive.google.com" && host !== "docs.google.com") return { kind: "invalid" };
    const parts = url.pathname.split("/").filter(Boolean); const folderIndex = parts.indexOf("folders");
    if (folderIndex >= 0) return this.validId(parts[folderIndex + 1]) ? { kind: "folder", folderId: parts[folderIndex + 1]! } : { kind: "invalid" };
    const fileIndex = parts.indexOf("d"); const pathId = fileIndex >= 0 ? parts[fileIndex + 1] : undefined;
    const fileId = pathId ?? url.searchParams.get("id") ?? undefined;
    return this.validId(fileId) ? { kind: "file", fileId: fileId! } : { kind: "invalid" };
  }
  private validId(value: string | undefined): boolean { return Boolean(value && /^[a-zA-Z0-9_-]{10,}$/.test(value)); }
}
