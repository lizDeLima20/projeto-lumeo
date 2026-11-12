-- Tests for Lumeo Livros' logic (no KOReader needed). Run from the repository root with any
-- Lua 5.1+/LuaJIT, e.g. KOReader's own:  luajit kindle/tests/run.lua
package.path = "kindle/lumeolivros.koplugin/?.lua;" .. package.path
local Logic = require("lumeolivros/logic")

local passed, failed = 0, 0
local function test(name, fn)
    local ok, err = pcall(fn)
    if ok then passed = passed + 1 else failed = failed + 1; print("FALHOU: " .. name .. "\n  " .. tostring(err)) end
end
local function eq(actual, expected, label)
    if actual ~= expected then error((label or "") .. " esperado " .. tostring(expected) .. ", veio " .. tostring(actual), 2) end
end

-- The JSON null sentinel some decoders use (a function or a userdata), never a string.
local NULL = function() end

local function ready_book(extra)
    local raw = {
        id = "bk_1", title = "Hábitos Atômicos", author = "James Clear", synopsis = "Pequenas mudanças.",
        language = "pt-BR", languageName = "Português (Brasil)", genre = "Autoajuda", genreId = "autoajuda",
        cover = "https://x/capa?tamanho=grande", thumbnail = "https://x/capa", original = { format = "epub", size = 1000 },
        kindle = { status = "ready", format = "azw3", size = 1990000, url = "https://x/download?formato=kindle", fileName = "James Clear - Hábitos Atômicos.azw3" },
    }
    for key, value in pairs(extra or {}) do raw[key] = value end
    return Logic.book(raw)
end

test("pasta fixa da biblioteca do Kindle", function()
    eq(Logic.KINDLE_LIBRARY_DIR, "/mnt/us/documents/Lumeo")
end)

test("endereços da API com parâmetros codificados e ordenados", function()
    eq(Logic.apiUrl("https://h/api/opds/kindle/", "livros", { q = "ação & cia", page = 2, genero = nil }), "https://h/api/opds/kindle/livros?page=2&q=a%C3%A7%C3%A3o%20%26%20cia")
    eq(Logic.apiUrl(nil, "generos"), "https://lumeo-livros.vercel.app/api/opds/kindle/generos")
    eq(Logic.apiUrl("https://h", "livros", { q = "" }), "https://h/livros")
end)

test("livro da API: campos nulos ou de tipo errado não quebram a tela", function()
    local book = Logic.book({ id = "x", title = NULL, author = 3, synopsis = NULL, kindle = NULL, original = "?" })
    eq(book.title, "Livro sem título"); eq(book.author, "Autor não informado"); eq(book.synopsis, nil)
    eq(book.kindle.status, "pending"); eq(Logic.canDownload(book), false)
    eq(Logic.book({ title = "sem id" }), nil); eq(Logic.book(NULL), nil)
    eq(#Logic.books({ { id = "a" }, NULL, { id = 2 }, { id = "b" } }), 2)
    eq(#Logic.genres({ { id = "a", name = "A" }, { id = "b" }, NULL }), 1)
end)

test("só baixa AZW3 convertido e pronto", function()
    eq(Logic.canDownload(ready_book()), true)
    eq(Logic.canDownload(ready_book({ kindle = { status = "ready", format = "pdf", url = "u" } })), false)
    eq(Logic.canDownload(ready_book({ kindle = { status = "pending" } })), false)
    eq(Logic.canDownload(ready_book({ kindle = { status = "ready", format = "azw3" } })), false, "sem url")
    eq(Logic.unavailableReason(ready_book()), nil)
    eq(Logic.unavailableReason(ready_book({ kindle = { status = "processing" } })), "A versão Kindle deste livro está sendo preparada. Tente de novo mais tarde.")
    eq(Logic.unavailableReason(ready_book({ kindle = { status = "failed" } })), "Este livro ainda não tem versão Kindle (AZW3).")
    eq(Logic.unavailableReason(ready_book({ kindle = { status = "unavailable" } })), "Este livro ainda não tem versão Kindle (AZW3).")
end)

test("linha de idioma e formato", function()
    eq(Logic.detailsLine(ready_book()), "Português (Brasil) · AZW3 · 1,9 MB")
    eq(Logic.detailsLine(ready_book({ kindle = { status = "pending" } })), "Português (Brasil) · EPUB")
    eq(Logic.sizeLabel(300000), "293 KB"); eq(Logic.sizeLabel(nil), nil); eq(Logic.sizeLabel(0), nil)
end)

test("nome do arquivo: seguro no FAT do Kindle, sempre .azw3, até 200 bytes", function()
    eq(Logic.fileName(ready_book()), "James Clear - Hábitos Atômicos.azw3")
    eq(Logic.fileName(ready_book({ kindle = { status = "ready", format = "azw3", url = "u", fileName = 'a/b:c*?"<>|.azw3' } })), "a b c.azw3")
    eq(Logic.fileName(ready_book({ author = "Autor não informado", title = "Só...", kindle = { status = "ready", format = "azw3", url = "u" } })), "Só.azw3")
    eq(Logic.fileName(ready_book({ title = "  ", author = "Autor não informado", kindle = { status = "ready", format = "azw3", url = "u", fileName = " .azw3" } })), "livro.azw3")
    local long = Logic.fileName(ready_book({ kindle = { status = "ready", format = "azw3", url = "u", fileName = string.rep("ç", 150) .. ".azw3" } }))
    if #long > 205 then error("longo demais: " .. #long) end
    -- Cut on a character boundary: every "ç" is 2 bytes, so the base has an even length.
    eq((#long - 5) % 2, 0, "corte em caractere inteiro")
end)

local function mobi(version, html)
    if html then return "<!DOCTYPE html><html><body>Cota excedida</body></html>" .. string.rep(" ", 100) end
    local header = string.rep("\0", 60) .. "BOOKMOBI" .. string.rep("\0", 8) .. "\0\2" .. "\0\0\0\88" .. string.rep("\0", 4)
    header = header .. string.rep("\0", 88 - #header)
    local record0 = string.rep("\0", 16) .. "MOBI" .. "\0\0\0\232" .. string.rep("\0", 12) .. string.char(0, 0, 0, version) .. string.rep("\0", 100)
    return header .. record0
end

test("arquivo baixado: só livro KF8 de verdade, nunca página de erro", function()
    eq((Logic.isKf8(mobi(8))), true)
    local ok, why = Logic.isKf8(mobi(8, true))
    eq(ok, false); eq(why, "o servidor devolveu uma página em vez do livro")
    eq((Logic.isKf8("curto")), false)
    eq((Logic.isKf8(string.rep("x", 60) .. "TEXtREAd" .. string.rep("\0", 100))), false)
end)

test("grade 3 x 3 por tela", function()
    local first = Logic.gridPage(30, 1); eq(first.first, 1); eq(first.last, 9); eq(first.pages, 4)
    local last = Logic.gridPage(30, 4); eq(last.first, 28); eq(last.last, 30)
    eq(Logic.gridPage(30, 99).page, 4); eq(Logic.gridPage(0, 1).pages, 1); eq(Logic.gridPage(0, 1).last, 0)
end)

test("busca global seleciona o gênero do primeiro resultado no carrossel", function()
    local genres = { { id = "romance", name = "Romance" }, { id = "autoajuda", name = "Autoajuda" } }
    local id, index = Logic.searchGenre({ { genre_id = "x" }, { genre_id = "autoajuda" } }, genres)
    eq(id, "autoajuda"); eq(index, 2)
    eq((Logic.searchGenre({}, genres)), nil)
end)

test("carrossel mostra a janela com o gênero selecionado", function()
    local a, b = Logic.carouselWindow(10, 7, 1, 3); eq(a, 5); eq(b, 7)
    a, b = Logic.carouselWindow(10, 2, 5, 3); eq(a, 2); eq(b, 4)
    a, b = Logic.carouselWindow(2, 1, 1, 3); eq(a, 1); eq(b, 2)
    a, b = Logic.carouselWindow(10, nil, 9, 3); eq(a, 8); eq(b, 10)
end)

print(string.format("%d testes passaram, %d falharam", passed, failed))
if failed > 0 then os.exit(1) end
