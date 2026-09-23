import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const read = (path: string): string => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

describe("a folha em movimento tem frente, verso e página de baixo reais", () => {
  it("celular: o verso da folha P é o conteúdo de P+1", () => {
    // The current sheet carries the next page as its back face, built before any turn.
    assert.match(read("views/ReaderView.ts"), /if\(page\.index\+1===current\)sheet\.append\(this\.reflowVerso\(this\.reflow!\.pageAt\(current\+1\)\)\)/);
    assert.match(read("views/ReaderView.ts"), /private reflowVerso\(page:ReaderPage\|null\):HTMLElement\{const face=this\.createElement\("div","page-turn-verso"\)/);
  });
  it("celular: o verso fica na mesma altura da página que ele antecipa", () => {
    // Measured in a browser: without this the next page's text started ~3.2rem above the
    // line where that same page sits once the turn lands.
    const css = read("styles/reader.css");
    assert.match(css, /\.reflow-sheet>\.page-turn-verso\{padding:inherit\}/);
    assert.match(css, /\.reflow-sheet__verso-content\{position:absolute;inset:0;overflow:hidden;padding:inherit;/);
    // The padding has to be declared before the content rule that inherits it.
    assert.ok(css.indexOf(".reflow-sheet>.page-turn-verso{padding:inherit}") < css.indexOf(".reflow-sheet__verso-content{"));
  });
  it("celular: voltar usa a folha anterior, já renderizada embaixo", () => {
    const engine = read("reader/page-turn/PageTurnEngine.ts");
    assert.match(engine, /const mobilePrevious=this\.page\.classList\.contains\?\.\("reflow-sheet"\)===true&&direction===-1\?this\.under:null;/);
    assert.match(engine, /this\.flexible\.mount\(this\.page,direction,mobilePrevious\)/);
  });
  it("livro aberto: frente P, verso P+1 e P+2 embaixo, montados antes da virada", () => {
    // at(start+1) is P on the right, at(start+2) its verso, at(start+3) the page below.
    assert.match(read("views/ReaderView.ts"), /versoAfter:at\(start\+2\),underAfter:at\(start\+3\),versoBefore:at\(start-1\),underBefore:at\(start-2\)/);
    // The page below enters the scene when the drag begins, not when it ends.
    assert.match(read("reader/page-turn/PageTurnEngine.ts"), /this\.under\?\.classList\.add\("page-turn-under-active"\);/);
  });
  it("as duas faces são texturas opacas: nada de vidro nem espelho", () => {
    const curl = read("reader/page-turn/FlexiblePageCurl.ts");
    // Every paper fragment writes alpha 1, whichever face it is.
    assert.match(curl, /gl_FragColor=vec4\(ink\.rgb \* vLight,1\.0\);/);
    // The back texture's x is flipped back so its text reads the right way round.
    assert.match(curl, /: \(uDirection > 0\.0 \? 1\.0-vUv\.x : vUv\.x\);/);
  });
  it("livro aberto: as faces são capturadas ao montar o par, como no celular", () => {
    // Measured in production before this: the spread only captured on pointerdown, the
    // textures were ready ~1.5s into the drag, and an arrow turn never had any.
    const controller = read("reader/desktop/PageTurnInteractionController.ts").replace(/\s+/g, "");
    assert.match(controller, /import\{FlexiblePageCurl\}from"\.\.\/page-turn\/FlexiblePageCurl"/);
    assert.match(controller, /document\.addEventListener\("visibilitychange",this\.visibility\);this\.warm\(\);?\}/);
    assert.match(controller, /this\.prepareLeaf\(1\);constlater=\(\)=>\{this\.warmIdle=0;this\.prepareLeaf\(-1\);?\}/);
    assert.match(controller, /publicunbind\(\):void\{this\.disposed=true;this\.coolDown\(\);/);
    // The engine reads the same cache, so a warmed leaf turns with the approved mesh.
    assert.match(read("reader/page-turn/FlexiblePageCurl.ts"), /private static readonly snapshotCache = new WeakMap/);
  });
  it("a captura normaliza cores só do que ela pinta", () => {
    const curl = read("reader/page-turn/FlexiblePageCurl.ts");
    assert.match(curl, /for\(const element of \[clone,\.\.\.clone\.querySelectorAll<HTMLElement>\("\*"\)\]\)\{/);
    // Walking the whole cloned document is what made a desktop capture take seconds.
    assert.doesNotMatch(curl, /for\(const element of clonedDocument\.querySelectorAll/);
    assert.match(curl, /const resolved=new Map<string,string>\(\);/);
  });
  it("fotografar a página não pode atrasar a virada no celular", () => {
    const curl = read("reader/page-turn/FlexiblePageCurl.ts");
    // Measured on the device: capturing the whole reader for every face made the leaf
    // start ~100ms after the finger and stutter at the end of the turn.
    assert.match(curl, /ignoreElements: \(element: Element\) => document\.body\.contains\(element\)\s*&& element !== page && !page\.contains\(element\) && !element\.contains\(page\)/);
    assert.match(curl, /private static captureScale\(\): number \{[\s\S]*?density >= 2 \? 1 :/);
    // One face at a time on a phone, with a frame in between for the finger.
    assert.match(curl, /const front = await this\.captureFace\(page, "front"\);\s*await FlexiblePageCurl\.breathe\(\);/);
    // And the warming itself waits for an idle moment after a turn.
    assert.match(read("reader/reflow/PageTurnController.ts"), /requestIdleCallback\(warm, \{ timeout: 500 \}\)/);
  });
  it("livro aberto: a orelha da página em repouso não entra na textura", () => {
    // Measured on the desktop leaf: the resting ::after corner flew with every turn as a
    // white square. html2canvas has already made it a real last child when onclone runs.
    const curl = read("reader/page-turn/FlexiblePageCurl.ts");
    assert.match(curl, /const restingAfter = clone\.lastElementChild;/);
    assert.match(curl, /if \(restingAfter\?\.tagName\.toLowerCase\(\) === "html2canvaspseudoelement"\) restingAfter\.remove\(\);/);
  });
});
