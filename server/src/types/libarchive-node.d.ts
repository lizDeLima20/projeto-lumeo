// libarchive.js ships its Node build as a bare subpath with no co-located declaration file
// (only the browser entry is wired through the package's own "types" field, at
// dist/build/compiled/libarchive-node.d.ts - which itself is just `export * from
// "./libarchive"`). Declared here directly, self-contained, rather than re-exporting from
// the "libarchive.js" package specifier: only the handful of members this codebase actually
// calls, matching dist/build/compiled/archive-reader.d.ts's own (loosely typed) signatures.
declare module "libarchive.js/dist/libarchive-node.mjs" {
  export class Archive {
    static open(file: File): Promise<{
      hasEncryptedData(): Promise<boolean | null>;
      getFilesArray(): Promise<unknown[]>;
      close(): Promise<void>;
    }>;
  }
}
