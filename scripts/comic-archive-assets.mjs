import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "node_modules/libarchive.js/dist");
const target = resolve(root, "public/vendor/libarchive");
await mkdir(target, { recursive: true });
for (const name of ["worker-bundle.js", "libarchive.wasm"]) {
  await copyFile(resolve(source, name), resolve(target, name));
}
