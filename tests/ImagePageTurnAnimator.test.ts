import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { ImagePageTurnAnimator } from "../src/reader/image/ImagePageTurnAnimator";

describe("ImagePageTurnAnimator", () => {
  it("keeps an opaque leaf above the already-rendered destination page", () => {
    assert.equal(ImagePageTurnAnimator.usesOpaqueFrontAndBackFaces, true);
    assert.equal(ImagePageTurnAnimator.keepsDestinationPageUnderLeaf, true);
  });

  it("uses the rendered destination as the opaque verso without flattening its 3D plane", () => {
    const source = readFileSync("src/reader/image/ImagePageTurnAnimator.ts", "utf8");
    const css = readFileSync("src/styles/reader.css", "utf8");
    assert.match(source, /const verso = this\.capture\(source\) \?\? image/);
    assert.match(source, /this\.face\(image, "front"\), this\.face\(verso, "back"\)/);
    assert.match(css, /\.reader-image-turn-leaf__front,\.reader-image-turn-leaf__back\{[^}]*opacity:1[^}]*backface-visibility:hidden[^}]*background-color:var\(--reader-paper-lit,#fff\)/);
    assert.doesNotMatch(css, /reader-image-leaf-next\{[^}]*filter:drop-shadow/);
    assert.doesNotMatch(css, /reader-image-leaf-previous\{[^}]*filter:drop-shadow/);
  });
});
