import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { catalogIdentityKey } from "../src/views/CatalogExplorerView";
import type { CatalogBookData } from "../src/models/CatalogBook";

const source = readFileSync("src/views/CatalogExplorerView.ts", "utf8");

const book = (overrides: Partial<CatalogBookData>): CatalogBookData => ({
  bookId: "book-1", title: "Título", author: "Autor", genreId: "", genreName: "Sem gênero",
  format: "pdf", driveFileId: "drive-1", storageAccountId: "acct-1", createdAt: "", updatedAt: "", status: "ACTIVE",
  ...overrides,
});

describe("o título da seção segue o gênero selecionado, não o resultado carregado", () => {
  it("nunca existe mais nenhuma seção fixa 'HQs da Marvel e DC'", () => {
    assert.doesNotMatch(source, /HQs da Marvel e DC/);
  });

  it("selecionar um gênero atualiza o título imediatamente, antes de recarregar", () => {
    assert.match(source, /this\.selectedGenre = id; this\.sectionTitle!\.textContent = this\.genreTitle\(id, label\);/);
    // A troca de gênero acontece antes do early-return de coleção e antes do reset/load.
    const selectGenre = source.slice(source.indexOf("const selectGenre = "), source.indexOf("const addGenre = "));
    assert.match(selectGenre, /this\.sectionTitle!\.textContent = this\.genreTitle\(id, label\);[\s\S]*const action = genreActions\.get\(id\)/);
    assert.match(selectGenre, /this\.reset\(\); void this\.load\(/);
  });

  it("genreTitle segue exatamente as regras pedidas: vazio, coleção e gênero comum", () => {
    assert.match(source, /private genreTitle\(id: string, label: string\): string \{/);
    assert.match(source, /if \(!id\) return this\.t\("ui\.catalog\.allGenres"\);/);
    assert.match(source, /if \(id\.startsWith\("collection:"\)\) return label;/);
    assert.match(source, /return `\$\{this\.t\("ui\.catalog\.genre"\)\}: \$\{label\}`;/);
  });

  it("o título inicial já nasce coerente com o selectedGenre restaurado, e é atualizado se o rótulo chegar depois", () => {
    assert.match(source, /this\.genreTitle\(this\.selectedGenre, this\.genreLabels\.get\(this\.selectedGenre\) \?\? ""\)/);
    assert.match(source, /if \(id === this\.selectedGenre && this\.sectionTitle\) this\.sectionTitle\.textContent = this\.genreTitle\(id, label\);/);
  });

  it("trocar o texto de busca nunca mexe em selectedGenre nem recalcula o título a partir dos resultados", () => {
    const reload = source.slice(source.indexOf("let timer: number"), source.indexOf("section.append("));
    assert.doesNotMatch(reload, /selectedGenre\s*=/);
    assert.doesNotMatch(reload, /sectionTitle/);
  });
});

describe("busca universal prioriza o exemplar já classificado em um gênero", () => {
  it("a deduplicação só entra em ação em 'Todos os gêneros' com busca ativa", () => {
    assert.match(source, /const universal = !genreId && this\.isSearching;/);
    assert.match(source, /if \(!universal\) \{ this\.classified\.append\(this\.card\(book\)\); return; \}/);
  });

  it("o candidato de maior rank substitui o card de menor rank já desenhado, pela identidade da obra", () => {
    assert.match(source, /const key = this\.identityKey\(book\), rank = this\.genreRank\(book\), current = this\.bestByIdentity\.get\(key\);/);
    assert.match(source, /if \(current && current\.rank >= rank\) return;/);
    assert.match(source, /current\?\.element\.remove\(\);/);
    assert.match(source, /this\.bestByIdentity\.set\(key, \{ rank, element \}\);/);
  });

  it("um livro com gênero sempre tem rank maior que o exemplar sem gênero definido", () => {
    assert.match(source, /private genreRank\(book: CatalogBookData\): number \{ return this\.isUnclassified\(book\) \? 0 : 1; \}/);
  });

  it("o mapa de melhores identidades é limpo a cada novo reset, junto do restante do estado de listagem", () => {
    assert.match(source, /private reset\(\): void \{ this\.loadVersion \+= 1; this\.pendingLoad = null; this\.cursor = null; this\.loaded\.clear\(\); this\.bestByIdentity\.clear\(\);/);
  });

  it("cada card mantém seu próprio gênero exibido, nunca herdando o de outro exemplar", () => {
    assert.match(source, /if \(!this\.isUnclassified\(book\)\) info\.append\(this\.createElement\("small", "catalog-card__genre", book\.genreName\)\);/);
  });
});

describe("identidade de deduplicação: mesmo título sozinho não é a mesma obra", () => {
  it("1. mesmo título + mesmo autor + um sem gênero e outro classificado → mesma identidade (fica o classificado)", () => {
    const unclassified = book({ bookId: "id-1", title: "Quem Pensa e Enriquece", author: "Napoleon Hill", genreId: "", genreName: "Sem gênero" });
    const classified = book({ bookId: "id-2", title: "Quem Pensa e Enriquece", author: "Napoleon Hill", genreId: "autoajuda", genreName: "Autoajuda" });
    assert.equal(catalogIdentityKey(unclassified), catalogIdentityKey(classified));
  });

  it("2. mesmo título + autores diferentes → identidades diferentes (os dois aparecem)", () => {
    const a = book({ bookId: "id-1", title: "O Segredo", author: "Autor A" });
    const b = book({ bookId: "id-2", title: "O Segredo", author: "Autor B" });
    assert.notEqual(catalogIdentityKey(a), catalogIdentityKey(b));
  });

  it("3. diferença só de caixa/acento no título e no autor → mesma identidade", () => {
    const a = book({ bookId: "id-1", title: "Quem Pensa e Enriquece", author: "Napoleon Hill" });
    const b = book({ bookId: "id-2", title: "quem pensa e enriquece", author: "NAPOLEON HILL" });
    assert.equal(catalogIdentityKey(a), catalogIdentityKey(b));
  });

  it("4. títulos realmente diferentes → identidades diferentes", () => {
    const a = book({ bookId: "id-1", title: "O Segredo", author: "Autor A" });
    const b = book({ bookId: "id-2", title: "Hulk", author: "Autor A" });
    assert.notEqual(catalogIdentityKey(a), catalogIdentityKey(b));
  });

  it("5. mesmo título + mesmo autor + volumes diferentes → identidades diferentes (os dois aparecem)", () => {
    const volume1 = book({ bookId: "id-1", title: "Aventura", author: "Autor A", volume: "1" });
    const volume2 = book({ bookId: "id-2", title: "Aventura", author: "Autor A", volume: "2" });
    assert.notEqual(catalogIdentityKey(volume1), catalogIdentityKey(volume2));
  });

  it("6. sem autor → nunca colide com outra obra por título, mesmo que o título seja igual", () => {
    const a = book({ bookId: "id-1", title: "Contos", author: "" });
    const b = book({ bookId: "id-2", title: "Contos", author: "" });
    assert.notEqual(catalogIdentityKey(a), catalogIdentityKey(b));
    // A própria identidade nunca colide consigo mesma por acidente de outro bookId.
    assert.equal(catalogIdentityKey(a), catalogIdentityKey(book({ bookId: "id-1", title: "Contos", author: "" })));
  });

  it("7. a identidade não depende da ordem de chegada dos registros", () => {
    const a = book({ bookId: "id-1", title: "Duna", author: "Frank Herbert" });
    const b = book({ bookId: "id-2", title: "duna", author: "frank herbert" });
    assert.equal(catalogIdentityKey(a), catalogIdentityKey(b));
    assert.equal(catalogIdentityKey(b), catalogIdentityKey(a));
  });

  it("8. a busca universal continua priorizando o registro classificado sobre sua duplicata sem gênero", () => {
    // A troca de card só ocorre quando o candidato novo tem rank maior ou igual não decide -
    // isso já é coberto pela regra de genreRank + bestByIdentity acima; aqui confirmamos que
    // a chave de identidade dos dois lados realmente coincide para o par clássico do bug relatado.
    const unclassified = book({ bookId: "id-1", title: "Hulk", author: "Stan Lee", genreId: "", genreName: "Sem gênero" });
    const classified = book({ bookId: "id-2", title: "Hulk", author: "Stan Lee", genreId: "marvel", genreName: "HQs da Marvel" });
    assert.equal(catalogIdentityKey(unclassified), catalogIdentityKey(classified));
  });
});
