export class FileSecurityValidator {
  private static readonly MAX_SIZE = 1024 * 1024 * 1024 * 2;

  public async validate(file: File, type: "pdf" | "epub"): Promise<void> {
    if (file.size <= 0) throw new Error("emptyFile");
    if (file.size > FileSecurityValidator.MAX_SIZE) throw new Error("fileTooLarge");
    const header = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    if (type === "pdf" && !this.startsWith(header, [0x25, 0x50, 0x44, 0x46])) throw new Error("invalidPdfSignature");
    if (type === "epub" && !this.startsWith(header, [0x50, 0x4b])) throw new Error("invalidZipSignature");
  }

  private startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
    return signature.every((value, index) => bytes[index] === value);
  }
}
