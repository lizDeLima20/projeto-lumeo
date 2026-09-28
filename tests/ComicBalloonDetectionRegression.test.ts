import assert from "node:assert/strict";
import { test } from "node:test";
import { comicRegionsDuplicate } from "../src/reader/comic/interaction/ComicRegionDedup";
import { comicGrowStencil } from "../src/reader/comic/interaction/ComicObjectCutout";
import type { ComicTextRegion } from "../src/reader/comic/interaction/ComicInteractionTypes";

const region = (x: number, y: number, width: number, height: number): ComicTextRegion => ({
  id: "test", pageIndex: 0, text: "Olá!", x, y, width, height,
  visualBounds: { x, y, width, height }, type: "speech", shape: "balloon", tailDirection: "none",
});

test("small central balloon survives complete overlap with a large bounding box", () => {
  assert.equal(comicRegionsDuplicate(region(.1,.1,.7,.5),region(.4,.3,.08,.06)), false);
});
test("close but separate balloons survive partial rectangle overlap", () => {
  assert.equal(comicRegionsDuplicate(region(.1,.2,.2,.15),region(.24,.2,.2,.15)), false);
});
test("near-identical candidates of one balloon are suppressed", () => {
  assert.equal(comicRegionsDuplicate(region(.1,.2,.2,.15),region(.102,.201,.2,.15)), true);
});
test("enclosed lettering and icons remain opaque in an expanded art stencil", () => {
  const data = new Uint8Array(81); for(let y=1;y<8;y++)for(let x=1;x<8;x++)data[y*9+x]=1;
  data[4*9+4]=0; data[3*9+4]=0;
  const grown = comicGrowStencil({data,width:9,height:9,step:2,x:0,y:0},0);
  assert.equal(grown.data[4*9+4],1); assert.equal(grown.data[3*9+4],1);
  assert.equal(grown.data[0],0);
});
