import assert from"node:assert/strict";import{describe,it}from"node:test";import{OpenBookNavigationController}from"../src/reader/desktop/OpenBookNavigationController";import{PageSpread}from"../src/reader/desktop/PageSpread";import{PageTurnInteractionController}from"../src/reader/desktop/PageTurnInteractionController";import{OpenBookLayout}from"../src/reader/desktop/OpenBookLayout";import{readFileSync}from"node:fs";import{PageGestureIntent}from"../src/reader/page-turn/PageGestureIntent";import{PageGeometry}from"../src/reader/page-turn/PageGeometry";
describe("OpenBookNavigationController",()=>{const navigation=new OpenBookNavigationController(15);it("forma spreads par e ímpar",()=>{assert.equal(navigation.spreadStart(1),0);assert.equal(navigation.spreadStart(10),10);assert.equal(navigation.spreadStart(11),10)});it("avança e volta em pares",()=>{assert.equal(navigation.next(10),12);assert.equal(navigation.previous(12),10);assert.equal(navigation.previous(1),1)});it("respeita limites",()=>{assert.equal(navigation.next(15),15);assert.equal(navigation.canNext(14),false);assert.equal(navigation.canPrevious(10),true)});});
describe("PageSpread",()=>{it("restaura âncora pela página esquerda",()=>{const left={index:9,paragraphs:[],startOffset:100,endOffset:200},right={index:10,paragraphs:[],startOffset:201,endOffset:300};assert.equal(new PageSpread(left,right).anchorPage,10)});});
describe("PageTurnInteractionController",()=>{it("threshold confirma e cancela drag, no mesmo span do motor",()=>{const controller=new PageTurnInteractionController({}as HTMLElement,()=>{},()=>{});const needed=1000*PageGeometry.dragSpanFactor*.3;assert.equal(controller.shouldComplete(needed+1,1000),true);assert.equal(controller.shouldComplete(needed-1,1000),false);assert.equal(controller.shouldComplete(150,1000),false)});it("o gesto so comeca quando prova que e horizontal",()=>{const intent=new PageGestureIntent();intent.arm(200,200);assert.equal(intent.accepts(203,200),false,"tremor abaixo do limiar nao vira gesto");assert.equal(intent.accepts(200,260),false,"rolagem vertical nao folheia");assert.equal(intent.accepts(180,205),true,"arrasto horizontal claro folheia");assert.equal(intent.accepts(200,260),true,"reconhecido uma vez, segue reconhecido");assert.ok(PageGestureIntent.slopPixels>=5&&PageGestureIntent.slopPixels<=12);});});

describe("OpenBookLayout",()=>{
  const source=readFileSync("src/reader/desktop/OpenBookLayout.ts","utf8");
  it("uma folha em voo tem verso real e pagina real embaixo",()=>{
    // a spread renders four pages: the two shown, plus the one each leaf uncovers
    assert.match(source,/underBefore/);assert.match(source,/underAfter/);
    assert.match(source,/versoBefore/);assert.match(source,/versoAfter/);
  });
  it("nenhuma copia de pagina guarda o modificador de lado",()=>{
    // --left/--right is how the turn controller finds the leaf; a nested copy earlier
    // in the document would win the querySelector and the wrong page would animate
    assert.equal(OpenBookLayout.sideModifierIsUniquePerSpread,true);
    assert.equal(source.includes("classList.add(`open-book-page--under-"),false);
    const replacements=source.match(/classList\.replace\(/g)??[];
    assert.equal(replacements.length,2,"verso e under precisam trocar a classe, nao acrescentar");
  });
  it("a capa fechada não usa conteúdo real como verso",()=>{
    assert.match(source,/leaf\.append\(this\.coverVerso\(cover\)\)/);
    assert.match(source,/private coverVerso\(cover:ReaderPage\)/);
  });
});

describe("camadas da folha desktop",()=>{
  const css=readFileSync("src/styles/reader.css","utf8");
  it("a folha em movimento cruza por cima do lado de destino sem ser recortada",()=>{
    const start=css.lastIndexOf(".open-book-page.page-turn-active,.open-book-layout--cover");
    const rule=css.slice(start,css.indexOf("}",start));
    assert.match(rule,/z-index:40!important/);
    assert.match(rule,/overflow:visible!important/);
  });
  it("a capa fechada ocupa a página direita da geometria final",()=>{
    assert.match(css,/\.open-book-layout--closed \.open-book-page--cover\{[\s\S]*grid-column:2!important/);
    assert.match(css,/\.open-book-layout--cover,\.open-book-layout--closed,\.open-book-layout--open-cover\{[\s\S]*width:calc\(var\(--desktop-page-width\) \* 2\)!important/);
  });
});
