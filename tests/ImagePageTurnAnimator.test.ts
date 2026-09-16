import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ImagePageTurnAnimator } from "../src/reader/image/ImagePageTurnAnimator";

describe("ImagePageTurnAnimator", () => {
  it("keeps an opaque leaf above the already-rendered destination page", () => {
    assert.equal(ImagePageTurnAnimator.usesOpaqueFrontAndBackFaces, true);
    assert.equal(ImagePageTurnAnimator.keepsDestinationPageUnderLeaf, true);
  });
});
