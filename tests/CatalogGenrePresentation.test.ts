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
  it("inclui busca e seletor horizontal de gêneros na página de HQs, sem botão Voltar", () => {
    const source = readFileSync("src/views/DriveCollectionGenreView.ts", "utf8");
    assert.match(source, /ui\.catalog\.search/);
    assert.match(source, /ui\.catalog\.allGenres/);
    assert.match(source, /page\.genres\?\.forEach/);
    assert.match(source, /collections\.forEach\(collection => this\.addGenre/);
    assert.match(source, /private async search\(raw: string\)/);
    assert.match(source, /listing\.entries\.filter\(entry => entry\.kind === "folder"\)/);
    assert.doesNotMatch(source, /ui\.common\.back/);
  });

  it("reduz levemente as capas do catálogo e usa o rótulo curto", () => {
    const catalogStyles = readFileSync("src/styles/catalog.css", "utf8");
    const collectionStyles = readFileSync("src/styles/collections.css", "utf8");
    const pt = readFileSync("src/i18n/locales/pt-BR.ts", "utf8");
    assert.match(catalogStyles, /\.catalog-card__cover\{width:92%;justify-self:center\}/);
    assert.match(collectionStyles, /\.drive-comic-card__cover \{ width: 92%; justify-self: center; \}/);
    assert.match(pt, /"catalog\.findBook": "Buscar"/);
  });
});
