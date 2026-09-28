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

describe("busca universal robusta: 'Quem Pensa e Enriquece'", () => {
  const title = "Quem Pensa e Enriquece";
  const author = "Napoleon Hill";

  it("1. título exato", () => { assert.equal(matchesCatalogText("Quem Pensa e Enriquece", [title]), true); });
  it("2. tudo minúsculo", () => { assert.equal(matchesCatalogText("quem pensa e enriquece", [title]), true); });
  it("3. tudo maiúsculo", () => { assert.equal(matchesCatalogText("QUEM PENSA E ENRIQUECE", [title]), true); });
  it("4. hífen como separador", () => { assert.equal(matchesCatalogText("quem-pensa-e-enriquece", [title]), true); });
  it("5. underscore como separador", () => { assert.equal(matchesCatalogText("quem_pensa_e_enriquece", [title]), true); });
  it("6. espaços múltiplos", () => { assert.equal(matchesCatalogText("quem   pensa   e   enriquece", [title]), true); });
  it("7. tokens não adjacentes", () => { assert.equal(matchesCatalogText("pensa enriquece", [title]), true); });
  it("8. tokens nas pontas, sem os do meio", () => { assert.equal(matchesCatalogText("quem enriquece", [title]), true); });

  it("9. busca pelo autor, nome completo", () => { assert.equal(matchesCatalogText("Napoleon Hill", [title, author]), true); });
  it("10. busca pelo autor, minúsculo", () => { assert.equal(matchesCatalogText("napoleon hill", [title, author]), true); });

  it("11. termos cruzando título e autor encontram o mesmo livro", () => {
    assert.equal(matchesCatalogText("napoleon enriquece", [title, author]), true);
  });

  it("12/13. com e sem acento encontram o mesmo registro", () => {
    const withAccent = matchesCatalogText("Hábitos Atômicos", ["Hábitos Atômicos"]);
    const withoutAccent = matchesCatalogText("habitos atomicos", ["Hábitos Atômicos"]);
    assert.equal(withAccent, true);
    assert.equal(withoutAccent, true);
    assert.equal(withAccent, withoutAccent);
  });

  it("14. busca por coleção continua funcionando", () => {
    assert.equal(matchesCatalogText("bestsellers", [title, author, "Coleção Bestsellers"]), true);
  });

  it("15. busca por gênero continua funcionando", () => {
    assert.equal(matchesCatalogText("autoajuda", [title, author, undefined, "Autoajuda"]), true);
  });

  it("16. termo não relacionado não encontra", () => {
    assert.equal(matchesCatalogText("dinossauros", [title, author]), false);
  });

  it("17. tokens parcialmente ausentes não encontram", () => {
    assert.equal(matchesCatalogText("pensa dinossauros", [title, author]), false);
  });

  it("18. token curto não casa acidentalmente dentro de outra palavra", () => {
    assert.equal(matchesCatalogText("art", ["Martin"]), false);
    assert.equal(matchesCatalogText("art", ["Arte da Guerra"]), true);
  });

  it("19. string vazia preserva o resultado (não elimina o catálogo)", () => {
    assert.equal(matchesCatalogText("", [title, author]), true);
  });

  it("20. string só com espaços preserva o resultado", () => {
    assert.equal(matchesCatalogText("   ", [title, author]), true);
  });
});
