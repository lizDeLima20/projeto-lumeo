import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { matchesCatalogText } from "../shared/CatalogTextSearch";

describe("busca de livros e HQs por palavras", () => {
  it("encontra as primeiras letras de palavras separadas no título", () => {
    assert.equal(matchesCatalogText("est ven", ["Como estudar para vencer"]), true);
    assert.equal(matchesCatalogText("canc fen", ["A Canção da Fênix.pdf"]), true);
  });

  it("ignora acentos, maiúsculas e a ordem dos termos", () => {
    assert.equal(matchesCatalogText("FEN CAN", ["A Canção da Fênix"]), true);
    assert.equal(matchesCatalogText("mach ass", ["Dom Casmurro", "Machado de Assis"]), true);
  });

  it("não encontra palavras inexistentes nem confunde títulos do mesmo gênero", () => {
    assert.equal(matchesCatalogText("fenix", ["A Guerra dos Reinos"]), false);
    assert.equal(matchesCatalogText("est geo", ["Como estudar para vencer"]), false);
    assert.equal(matchesCatalogText("", ["Qualquer livro"]), true);
  });
});
