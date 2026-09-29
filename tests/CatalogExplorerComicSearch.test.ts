import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { matchesCatalogText } from "../shared/CatalogTextSearch";

const source = readFileSync("src/views/CatalogExplorerView.ts", "utf8");

describe("a busca principal do catálogo também encontra HQs das Coleções Drive", () => {
  it("a busca de coleções não bloqueia mais a busca de livros (não é mais Promise.all)", () => {
    assert.doesNotMatch(source, /Promise\.all\(\[\s*this\.catalog\.list/);
    assert.match(source, /const page = await this\.catalog\.list\(/);
  });

  it("a busca de coleções continua disparando nas mesmas condições de antes: primeira página, com termo, em Todos os gêneros, com coleções disponíveis", () => {
    assert.match(source, /if \(firstPage && normalizedQuery && !genreId && this\.published\) \{/);
    assert.match(source, /this\.published\.collections\.search\(normalizedQuery\)/);
  });

  it("os resultados de HQ chegam depois, sem travar 'Carregando...' pelo tempo da busca mais lenta", () => {
    assert.match(source, /\.then\(comics => this\.appendComics\(comics, version\)\)/);
    assert.match(source, /private appendComics\(comics: readonly DriveCollectionSearchResult\[\], version: number\): void \{/);
  });

  it("uma busca de HQ desatualizada (de uma consulta já trocada) é descartada, não corrompe a tela atual", () => {
    const appendComics = source.slice(source.indexOf("private appendComics"), source.indexOf("private refreshStatus"));
    assert.match(appendComics, /if \(version !== this\.loadVersion\) return;/);
  });

  it("uma HQ não é duplicada se já apareceu antes na mesma busca", () => {
    assert.match(source, /this\.loaded\.has\("comic:" \+ result\.collection\.id \+ ":" \+ result\.entry\.id\)/);
  });

  it("uma HQ no resultado mantém o cartão/fluxo próprio de HQ, nunca vira um livro comum", () => {
    const appendComics = source.slice(source.indexOf("private appendComics"), source.indexOf("private refreshStatus"));
    assert.match(appendComics, /this\.classified\.append\(this\.comicCard\(result\)\)/);
    assert.doesNotMatch(appendComics, /this\.card\(result\)/);
  });

  it("busca vazia não dispara a busca de coleções (normalizedQuery precisa ser verdadeiro)", () => {
    assert.match(source, /if \(firstPage && normalizedQuery && !genreId && this\.published\)/);
  });

  it("a chamada ao catálogo de livros continua com os mesmos parâmetros de antes (sem regressão)", () => {
    assert.match(source, /this\.catalog\.list\(\{ cursor: this\.cursor \?\? undefined, query: normalizedQuery \|\| undefined, genreId: genreId \|\| undefined \}\)/);
  });
});

describe("normalização compartilhada continua valendo para título de livro e nome de HQ", () => {
  it("encontra um livro pelo título, como antes", () => {
    assert.equal(matchesCatalogText("segredo", ["O Segredo"]), true);
  });

  it("encontra uma HQ Marvel pelo nome do personagem", () => {
    assert.equal(matchesCatalogText("hulk", ["Hulk 001.pdf", "", "HQs da Marvel", "HQs da Marvel", "Hulk"]), true);
  });

  it("encontra uma HQ DC pelo nome do personagem", () => {
    assert.equal(matchesCatalogText("batman", ["Ano Um 01.cbz", "", "HQs da DC", "HQs da DC", "Batman"]), true);
  });

  it("acento e caixa não impedem encontrar a HQ", () => {
    assert.equal(matchesCatalogText("DOUTOR ESTRANHO", ["Doutor_Estranho-001.pdf", "", "HQs da Marvel", "HQs da Marvel", "Doutor Estranho"]), true);
    assert.equal(matchesCatalogText("doutor-estranho", ["Doutor_Estranho-001.pdf", "", "HQs da Marvel", "HQs da Marvel", "Doutor Estranho"]), true);
  });

  it("busca vazia não filtra nada (mesmo comportamento de sempre)", () => {
    assert.equal(matchesCatalogText("", ["Hulk 001.pdf"]), true);
    assert.equal(matchesCatalogText("   ", ["Hulk 001.pdf"]), true);
  });
});
