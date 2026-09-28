import assert from "node:assert/strict";
import { test } from "node:test";
import { createCanvas } from "@napi-rs/canvas";
import { detectComicContainers } from "../src/reader/comic/interaction/ComicContainerDetector";
import { comicEncodedMatchesCanvas, detectComicContainersMultiScale } from "../src/reader/comic/interaction/ComicMultiScaleDetector";

test("OCR reuses encoded art only in the same coordinate space", () => {
  assert.equal(comicEncodedMatchesCanvas({width:4000,height:6000},2048,3072),false);
  assert.equal(comicEncodedMatchesCanvas({width:2048,height:3072},2048,3072),true);
  assert.equal(comicEncodedMatchesCanvas({},2048,3072),false);
});

test("full-page multiscale scan keeps central and small containers separate", async () => {
  const canvas=createCanvas(600,900), c=canvas.getContext("2d");
  c.fillStyle="#222222";c.fillRect(0,0,600,900);
  const boxes=[{x:220,y:210,w:170,h:90},{x:275,y:320,w:64,h:35},{x:220,y:375,w:170,h:90}];
  for(const b of boxes){
    c.fillStyle="#ffffff";c.fillRect(b.x,b.y,b.w,b.h);
    c.fillStyle="#000000";
    const glyph=b.w<100?3:5, gap=glyph+3;
    for(let y=b.y+10;y<b.y+b.h-9;y+=10)for(let x=b.x+9;x<b.x+b.w-10;x+=gap)c.fillRect(x,y,glyph,6);
  }
  const pixels=c.getImageData(0,0,600,900) as unknown as ImageData;
  const base=detectComicContainers(pixels), result=await detectComicContainersMultiScale(pixels);
  assert.ok(result.length>=base.length);
  for(const b of boxes){
    const cx=b.x+b.w/2,cy=b.y+b.h/2;
    assert.ok(result.some(r=>r.bbox.x0<=cx&&r.bbox.x1>=cx&&r.bbox.y0<=cy&&r.bbox.y1>=cy),`missing ${b.w}x${b.h} centre container`);
  }
  const small=result.filter(r=>r.bbox.x0<=307&&r.bbox.x1>=307&&r.bbox.y0<=337&&r.bbox.y1>=337);
  assert.equal(small.length,1,"same small balloon must not create duplicate hotspots");
});

test("multiscale cancellation aborts before allocating another sampling grid", async()=>{
  const c=createCanvas(100,100), abort=new AbortController();abort.abort();
  await assert.rejects(detectComicContainersMultiScale(c.getContext("2d").getImageData(0,0,100,100) as unknown as ImageData,abort.signal),{name:"AbortError"});
});
