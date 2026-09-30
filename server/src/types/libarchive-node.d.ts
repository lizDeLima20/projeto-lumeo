// libarchive.js ships its Node build as a bare subpath with no co-located declaration file
// (only the browser entry is wired through the package's own "types" field). Both builds
// compile from the same source and share the exact same public shape - only wiring the
// worker differs - so this simply borrows the already-typed main package export.
declare module "libarchive.js/dist/libarchive-node.mjs" {
  export * from "libarchive.js";
}
