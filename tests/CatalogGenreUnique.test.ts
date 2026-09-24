import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { Genre } from "../src/models/Genre";

const source = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("um gênero existe uma única vez", () => {
  it("o mesmo nome é o mesmo gênero, com qualquer caixa, acento ou espaço", () => {
    assert.ok(Genre.sameName("Aventura", "aventura"));
    assert.ok(Genre.sameName(" Autoajuda ", "autoajuda"));
    assert.ok(Genre.sameName("Ciências", "Ciencias"));
    assert.ok(Genre.sameName("Contos  e crônicas", "Contos e crônicas"));
    // Different genres stay different: Concurso público is not Concursos.
    assert.ok(!Genre.sameName("Concurso público", "Concursos"));
    assert.ok(!Genre.sameName("Aventura", "Aventura 2"));
  });

  it("um livro do catálogo entra no gênero da biblioteca que tem o mesmo nome", () => {
    const app = source("src/core/App.ts");
    assert.match(app, /this\.state\.genres\.find\(\(item\) => item\.id === confirmed\.genreId\)\s*\?\? \(confirmed\.genreName \? this\.state\.genres\.find\(\(item\) => Genre\.sameName\(item\.name, confirmed\.genreName\)\)/);
    const dialog = source("src/views/CatalogGenreDialog.ts");
    assert.match(dialog, /const existing = this\.book\.genreName \? this\.state\.genres\.find\(\(genre\) => Genre\.sameName\(genre\.name, this\.book\.genreName\)\)/);
    assert.match(dialog, /select\.value = seen\.has\(suggested\) \? suggested : "sem-genero";/);
  });

  it("as fontes novas do Drive antigo não repetem as que já existem", () => {
    const migration = source("supabase/migrations/202609220001_catalog_sources_old_drive_genres.sql");
    for (const genre of ["Biografia e memórias", "Ciências", "Concurso público", "Contos e crônicas"]) assert.match(migration, new RegExp(`'${genre}'`));
    for (const existing of ["Aventura", "Autoajuda", "Artes e música", "Administração e economia", "Desenvolvimento pessoal", "Turismo e guia de viagem", "Concursos'"]) assert.doesNotMatch(migration, new RegExp(`'${existing}`));
    assert.match(migration, /on conflict \(folder_id\) do update/);
  });
});
