import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FlexiblePageCurl } from "../src/reader/page-turn/FlexiblePageCurl";

type CurlGeometry = {
  width: number;
  height: number;
  progress: number;
  direction: 1 | -1;
  touchX: number;
  touchY: number;
  speed: number;
  columns: number;
  rows: number;
  vertices(): Float32Array;
};

function geometry(progress: number, y: number, direction: 1 | -1 = 1): { data: Float32Array; rows: number; columns: number } {
  const curl = new FlexiblePageCurl() as unknown as CurlGeometry;
  curl.width = 400;
  curl.height = 600;
  curl.progress = progress;
  curl.direction = direction;
  curl.touchX = direction === 1 ? .85 : .15;
  curl.touchY = y;
  curl.speed = .1;
  return { data: curl.vertices(), rows: curl.rows, columns: curl.columns };
}

function edgeAt(mesh: ReturnType<typeof geometry>, row: number): number {
  return mesh.data[(row * (mesh.columns + 1) + mesh.columns) * 6]!;
}

describe("FlexiblePageCurl geometry", () => {
  it("keeps one connected, finite mesh from rest through landing in both directions", () => {
    for (const direction of [1, -1] as const) for (let frame = 0; frame <= 20; frame++) {
      const mesh = geometry(frame / 20, .5, direction);
      assert.equal(mesh.data.length, (mesh.columns + 1) * (mesh.rows + 1) * 6);
      assert.ok(mesh.data.every(Number.isFinite));
      for (let row = 0; row <= mesh.rows; row++) {
        const spine = mesh.data[(row * (mesh.columns + 1)) * 6]!;
        assert.equal(spine, 0, "the bound edge never moves");
      }
    }
  });

  it("the top and bottom gestures bend opposite corners first", () => {
    const top = geometry(.45, .08), middle = geometry(.45, .5), bottom = geometry(.45, .92);
    const topDifference = edgeAt(top, 0) - edgeAt(top, top.rows);
    const bottomDifference = edgeAt(bottom, 0) - edgeAt(bottom, bottom.rows);
    assert.ok(topDifference * bottomDifference < 0, "the leading corner must reverse with the finger");
    assert.ok(Math.abs(topDifference) > .05 && Math.abs(bottomDifference) > .05);
    assert.ok(Math.abs(edgeAt(middle, 0) - edgeAt(middle, middle.rows)) < .01, "center pull is balanced");
  });

  it("rest and landing lie flat, while the intermediate paper bows", () => {
    for (const progress of [0, 1]) {
      const mesh = geometry(progress, .08);
      assert.ok(Math.abs(edgeAt(mesh, 0) - edgeAt(mesh, mesh.rows)) < .01);
    }
    const mesh = geometry(.45, .08);
    assert.ok(Math.abs(edgeAt(mesh, 0) - edgeAt(mesh, Math.floor(mesh.rows / 2))) > .02);
  });
});
