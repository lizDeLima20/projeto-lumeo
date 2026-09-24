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

describe("controles sempre acessíveis no catálogo", () => {
  it("mantém busca e gêneros no fluxo existente de filtro remoto", () => {
    const source = readFileSync("src/views/CatalogExplorerView.ts", "utf8");
    assert.match(source, /controls\.append\(search, genres\)/);
    assert.match(source, /this\.load\(search\.value, selectedGenre, more\)/);
    assert.match(source, /this\.enableGenreDrag\(genres\)/);
    assert.match(source, /container\.scrollLeft = startScroll - delta/);
  });

  it("fixa apenas os controles abaixo da header e mantém swipe horizontal touch", () => {
    const styles = readFileSync("src/styles/catalog.css", "utf8");
    assert.match(styles, /\.catalog__controls\{position:sticky;top:4\.25rem/);
    assert.match(styles, /@media\(max-width:63\.99rem\)\{\.catalog__controls\{top:5\.35rem\}\}/);
    assert.match(styles, /\.catalog__genre-carousel\{[^}]*touch-action:pan-x/);
  });
});
