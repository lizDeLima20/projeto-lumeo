import assert from "node:assert/strict";
import { test } from "node:test";
import { comicScaleCutoutStencil } from "../src/reader/comic/interaction/ComicOriginalCutoutSource";
import { comicMaskedPixels } from "../src/reader/comic/interaction/ComicObjectCutout";

test("original-resolution stencil preserves separate X/Y rounding",()=>{
  const source={data:new Uint8Array([1,0,0,1]),width:2,height:2,step:2,x:10,y:20};
  const scaled=comicScaleCutoutStencil(source,2,3);
  assert.equal(scaled.width,8);assert.equal(scaled.height,12);
  assert.equal(scaled.x,20);assert.equal(scaled.y,60);
  assert.equal(scaled.data[3*8+3],1);assert.equal(scaled.data[3*8+5],0);
  assert.equal(scaled.data[7*8+3],0);assert.equal(scaled.data[7*8+5],1);
  assert.deepEqual([...source.data],[1,0,0,1]);
});
test("cutout preserves original RGB even for dark lettering and coloured artwork",()=>{
  const data=new Uint8ClampedArray([1,2,3,255,255,220,15,255]);
  const result=comicMaskedPixels({width:2,height:1,data} as ImageData,new Uint8Array([255,255]));
  assert.deepEqual([...result],[...data]);
});
