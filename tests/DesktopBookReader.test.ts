import assert from"node:assert/strict";import{describe,it}from"node:test";import{OpenBookNavigationController}from"../src/reader/desktop/OpenBookNavigationController";import{PageSpread}from"../src/reader/desktop/PageSpread";import{PageTurnInteractionController}from"../src/reader/desktop/PageTurnInteractionController";import{OpenBookLayout}from"../src/reader/desktop/OpenBookLayout";import{readFileSync}from"node:fs";
describe("OpenBookNavigationController",()=>{const navigation=new OpenBookNavigationController(15);it("forma spreads par e ímpar",()=>{assert.equal(navigation.spreadStart(1),0);assert.equal(navigation.spreadStart(10),10);assert.equal(navigation.spreadStart(11),10)});it("avança e volta em pares",()=>{assert.equal(navigation.next(10),12);assert.equal(navigation.previous(12),10);assert.equal(navigation.previous(1),1)});it("respeita limites",()=>{assert.equal(navigation.next(15),15);assert.equal(navigation.canNext(14),false);assert.equal(navigation.canPrevious(10),true)});});
describe("PageSpread",()=>{it("restaura âncora pela página esquerda",()=>{const left={index:9,paragraphs:[],startOffset:100,endOffset:200},right={index:10,paragraphs:[],startOffset:201,endOffset:300};assert.equal(new PageSpread(left,right).anchorPage,10)});});
describe("PageTurnInteractionController",()=>{it("threshold confirma e cancela drag",()=>{const controller=new PageTurnInteractionController({}as HTMLElement,()=>{},()=>{});assert.equal(controller.shouldComplete(360,1000),true);assert.equal(controller.shouldComplete(150,1000),false)});});

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
});
