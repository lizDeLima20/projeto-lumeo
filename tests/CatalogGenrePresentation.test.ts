import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("separação entre catálogo oficial e categorias pessoais", () => {
  it("o Explore recebe filtros somente da resposta remota do catálogo", () => {
    const source = readFileSync("src/views/CatalogExplorerView.ts", "utf8");
    assert.match(source, /page\.genres\?\.forEach\(\(genre\) => this\.addCatalogGenre/);
    assert.doesNotMatch(source, /this\.state\.genres\.forEach\(\(value\) => addGenre/);
    assert.doesNotMatch(source, /addGenre\("sem-genero"/);
    assert.doesNotMatch(source, /catalog__section--unclassified/);
  });

  it("o onboarding não semeia nem exige gêneros oficiais", () => {
    const source = readFileSync("src/views/OnboardingView.ts", "utf8");
    assert.doesNotMatch(source, /SUGGESTED_GENRES|genre-picker|genre-checklist|Escolha pelo menos um gênero/);
    assert.match(source, /this\.state\.onboardingCompleted = true/);
    assert.match(source, /this\.languageSelector\(\), this\.themeSelector\(\), complete/);
  });
});
