-- Runs Lumeo Livros' screens and network code over the stubs in stubs.lua (no KOReader needed).
-- From the repository root:  luajit kindle/tests/screens.lua
package.path = "kindle/lumeolivros.koplugin/?.lua;kindle/tests/?.lua;" .. package.path
local Stubs = require("stubs")
local Api = require("lumeolivros/api")
local Logic = require("lumeolivros/logic")

local passed, failed = 0, 0
local function reset()
    Stubs.shown, Stubs.closed, Stubs.requests, Stubs.executed, Stubs.dialogs = {}, {}, {}, {}, {}
    Stubs.routes, Stubs.json, Stubs.disk = {}, {}, {}
    for key in pairs(Stubs.fs) do Stubs.fs[key] = nil end
    Stubs.Device._kindle = false
end
local function test(name, fn)
    reset()
    local ok, err = xpcall(fn, debug.traceback)
    if ok then passed = passed + 1 else failed = failed + 1; print("FALHOU: " .. name .. "\n  " .. tostring(err)) end
end
local function eq(actual, expected, label)
    if actual ~= expected then error((label or "") .. " esperado " .. tostring(expected) .. ", veio " .. tostring(actual), 2) end
end
local function shownOf(kind)
    local found = {}
    for _, w in ipairs(Stubs.shown) do if w._stub == kind then table.insert(found, w) end end
    return found
end

local SERVER = "https://lumeo.test/api/opds/kindle"
local AZW3 = string.rep("\0", 60) .. "BOOKMOBI" .. string.rep("\0", 8) .. "\0\2" .. "\0\0\0\88" .. string.rep("\0", 6)
    .. string.rep("\0", 16) .. "MOBI" .. "\0\0\0\232" .. string.rep("\0", 12) .. "\0\0\0\8" .. string.rep("\0", 200)

local function book(id, extra)
    local raw = { id = id, title = "Livro " .. id, author = "Autora", synopsis = "Sinopse", languageName = "Português (Brasil)", genreId = "autoajuda",
        thumbnail = SERVER .. "/capa/" .. id, cover = SERVER .. "/grande/" .. id, original = { format = "epub" },
        kindle = { status = "ready", format = "azw3", size = 2000, url = "https://lumeo.test/api/opds/livros/" .. id .. "/download?formato=kindle", fileName = "Autora - Livro " .. id .. ".azw3" } }
    for k, v in pairs(extra or {}) do raw[k] = v end
    return Logic.book(raw)
end

-- Network ------------------------------------------------------------------------------------

test("JSON da API com a senha do Lumeo", function()
    Stubs.routes[SERVER .. "/generos"] = { code = 200, body = "G" }
    Stubs.json.G = { genres = { { id = "autoajuda", name = "Autoajuda" } } }
    local api = Api:new{ server = SERVER, username = "leitor", password = "s3nha" }
    local genres = api:genres()
    eq(#genres, 1); eq(genres[1].name, "Autoajuda")
    eq(Stubs.requests[1].user, "leitor"); eq(Stubs.requests[1].password, "s3nha"); eq(Stubs.requests[1].redirect, false)
end)

test("login recusado e catálogo fora do ar viram mensagens claras", function()
    local api = Api:new{ server = SERVER, username = "leitor", password = "x" }
    Stubs.routes[SERVER .. "/generos"] = { code = 401 }
    local data, kind, message = api:genres()
    eq(data, nil); eq(kind, "login"); eq(message, "Usuário ou senha incorretos.")
    Stubs.routes[SERVER .. "/generos"] = { code = 503 }
    eq(select(2, api:genres()), "server")
    Stubs.routes[SERVER .. "/generos"] = { code = 200, body = "invalido" }
    eq(select(3, api:genres()), "Resposta inválida do catálogo.")
end)

test("download: segue o 302 até o AZW3 no Google Drive sem mandar a senha, salva na pasta fixa, sem .part", function()
    local api = Api:new{ server = SERVER, username = "leitor", password = "s3nha" }
    local b = book("bk_1")
    local drive = "https://drive.usercontent.google.com/download?id=azw3Drive_bk_1&export=download&confirm=t"
    Stubs.routes[b.kindle.url] = { code = 302, headers = { location = drive }, body = "" }
    Stubs.routes[drive] = { code = 200, body = AZW3 }
    local path, message = api:downloadBook(b)
    eq(message, nil); eq(path, "/koreader/Lumeo/Autora - Livro bk_1.azw3")
    eq(Stubs.disk[path], AZW3, "conteúdo é o AZW3, não o corpo do 302")
    eq(Stubs.disk[path .. ".part"], nil)
    eq(Stubs.requests[1].user, "leitor"); eq(Stubs.requests[2].user, nil, "sem senha para outro domínio"); eq(Stubs.requests[2].password, nil)
end)

test("no Kindle: /mnt/us/documents/Lumeo e pedido de indexação à biblioteca", function()
    Stubs.Device._kindle = true
    Stubs.fs["/usr/bin/lipc-set-prop"] = { mode = "file" }
    local api = Api:new{ server = SERVER, username = "leitor", password = "s3nha" }
    local b = book("bk_2")
    Stubs.routes[b.kindle.url] = { code = 200, body = AZW3 }
    eq(api:downloadBook(b), "/mnt/us/documents/Lumeo/Autora - Livro bk_2.azw3")
    eq(#Stubs.executed, 1); eq(Stubs.executed[1]:match("^lipc%-set%-prop com%.lab126%.scanner") ~= nil, true)
end)

test("página HTML (cota, erro) nunca vira livro na biblioteca", function()
    local api = Api:new{ server = SERVER, username = "leitor", password = "s3nha" }
    local b = book("bk_3")
    Stubs.routes[b.kindle.url] = { code = 200, body = "<!DOCTYPE html><html>Cota</html>" .. string.rep(" ", 100) }
    local path, message = api:downloadBook(b)
    eq(path, nil); eq(message, "o servidor devolveu uma página em vez do livro")
    eq(Stubs.disk["/koreader/Lumeo/Autora - Livro bk_3.azw3"], nil); eq(Stubs.disk["/koreader/Lumeo/Autora - Livro bk_3.azw3.part"], nil)
end)

test("redirecionamento https → http é recusado", function()
    local api = Api:new{ server = SERVER, username = "leitor", password = "s3nha" }
    local b = book("bk_4")
    Stubs.routes[b.kindle.url] = { code = 302, headers = { location = "http://storage.test/x.azw3" } }
    local path = api:downloadBook(b)
    eq(path, nil); eq(#Stubs.requests, 1)
end)

test("livro sem AZW3 pronto não chega a ser pedido", function()
    local api = Api:new{ server = SERVER, username = "leitor", password = "s3nha" }
    local path, message = api:downloadBook(book("bk_5", { kindle = { status = "processing" } }))
    eq(path, nil); eq(message, "A versão Kindle deste livro está sendo preparada. Tente de novo mais tarde."); eq(#Stubs.requests, 0)
end)

test("capa: só JPEG válido entra no cache, e o cache é reaproveitado", function()
    local api = Api:new{ server = SERVER, username = "leitor", password = "s3nha" }
    Stubs.routes[SERVER .. "/capa/bk_1"] = { code = 200, body = "\255\216\255\224" .. string.rep("j", 50) }
    local path = api:cover(SERVER .. "/capa/bk_1", "bk_1", "capa")
    eq(path, "/koreader/cache/lumeolivros/bk_1-capa.jpg")
    eq(api:cover(SERVER .. "/capa/bk_1", "bk_1", "capa"), path); eq(#Stubs.requests, 1, "segunda vez vem do cache")
    Stubs.routes[SERVER .. "/capa/bk_9"] = { code = 200, body = "<html>" }
    eq(api:cover(SERVER .. "/capa/bk_9", "bk_9", "capa"), nil)
end)

-- Screens --------------------------------------------------------------------------------------

local function fakeApi(pages)
    local api = { calls = {} }
    function api:genres() return { { id = "romance", name = "Romance" }, { id = "autoajuda", name = "Autoajuda" }, { id = "terror", name = "Terror" }, { id = "viagem", name = "Viagem" } } end
    function api:books(genre_id, query, page)
        table.insert(self.calls, { genre = genre_id, query = query, page = page })
        if pages.fail then return nil, pages.fail, "falhou" end
        if query == "nada" then return { books = {}, has_next = false, page = 1 } end
        local list = {}
        for i = 1, (page == 1 and 30 or 5) do table.insert(list, book(string.format("%s-%d-%d", query or genre_id, page, i), { genreId = query and "viagem" or genre_id })) end
        return { books = list, has_next = page == 1, page = page }
    end
    function api:cover() return "/koreader/cache/x.jpg" end
    function api:downloadBook() self.downloaded = (self.downloaded or 0) + 1; return "/koreader/Lumeo/x.azw3" end
    return api
end

test("tela inicial: gêneros, primeiro gênero e grade 3 x 3", function()
    local HomeScreen = require("lumeolivros/home")
    local api = fakeApi({})
    local home = HomeScreen:new{ api = api }
    eq(home:start(), true)
    eq(home.selected, 1); eq(#home.books, 30); eq(api.calls[1].genre, "romance"); eq(api.calls[1].query, nil)
    home:gotoGridPage(3); eq(home.grid_page, 3); eq(#home.books, 30, "a tela 3 (livros 19-27) já está carregada")
    home:gotoGridPage(4); eq(#home.books, 35, "a tela 4 precisa dos livros 28-36: carrega a próxima página da API"); eq(home.grid_page, 4)
    eq(#api.calls, 2)
    home:gotoGridPage(5); eq(home.grid_page, 4, "sem mais livros, fica na última"); eq(#api.calls, 2, "não pede de novo")
    home:gotoGridPage(0); eq(home.grid_page, 1)
end)

test("busca global seleciona o gênero do resultado no carrossel", function()
    local HomeScreen = require("lumeolivros/home")
    local api = fakeApi({})
    local home = HomeScreen:new{ api = api }
    home:start()
    home:search("  hábitos ")
    eq(home.query, "hábitos"); eq(api.calls[2].query, "hábitos"); eq(api.calls[2].genre, nil, "busca é global")
    eq(home.selected, 4, "Viagem selecionado"); eq(home.carousel_first, 2, "carrossel rola até o gênero")
    home:selectGenre(2); eq(home.query, nil); eq(api.calls[3].genre, "autoajuda")
    home:search("nada"); eq(#home.books, 0)
    local infos = shownOf("InfoMessage"); eq(infos[#infos].text, "Nenhum livro encontrado para “nada”.")
end)

test("login recusado fecha a tela e pede o login de novo", function()
    local HomeScreen = require("lumeolivros/home")
    local asked = false
    local home = HomeScreen:new{ api = fakeApi({ fail = "login" }), on_login_error = function() asked = true end }
    eq(home:start(), false); eq(asked, true)
end)

test("tela do livro: botão, aviso da biblioteca, voltar; download vai para a biblioteca", function()
    local DetailsScreen = require("lumeolivros/details")
    local api = fakeApi({})
    local screen = DetailsScreen:new{ api = api, book = book("bk_7") }
    eq(screen.layout[1][1].text, "Baixar para a biblioteca"); eq(screen.layout[1][1].enabled, true)
    eq(screen.layout[2][1].text, "Voltar")
    screen:download(); eq(api.downloaded, 1)
    local infos = shownOf("InfoMessage"); eq(infos[#infos].text:match("^Livro salvo na sua biblioteca Kindle") ~= nil, true)
    Stubs.fs["/koreader/Lumeo/Autora - Livro bk_7.azw3"] = { mode = "file" }
    screen:download(); eq(api.downloaded, 1, "já existe: pergunta antes")
    local confirms = shownOf("ConfirmBox"); eq(#confirms, 1); confirms[1].ok_callback(); eq(api.downloaded, 2)
    screen:onClose(); eq(Stubs.closed[#Stubs.closed], screen)
end)

test("tela do livro sem AZW3: botão desativado com o motivo", function()
    local DetailsScreen = require("lumeolivros/details")
    local screen = DetailsScreen:new{ api = fakeApi({}), book = book("bk_8", { kindle = { status = "failed" }, synopsis = nil }) }
    eq(screen.layout[1][1].enabled, false)
end)

test("extensão: pede login na primeira vez, guarda e abre a tela inicial", function()
    local Plugin = require("main")
    local registered
    local plugin = Plugin:new{ ui = { menu = { registerToMainMenu = function(_, p) registered = p end } } }
    eq(registered, plugin)
    local items = {}; plugin:addToMainMenu(items); eq(items.lumeolivros.text, "Lumeo Livros")
    plugin:open()
    local dialog = Stubs.dialogs[#Stubs.dialogs]
    eq(dialog._stub, "MultiInputDialog")
    dialog._typed = { "  Leitor ", "s3nha" }
    Stubs.routes[Logic.DEFAULT_SERVER .. "/generos"] = { code = 200, body = "G" }
    Stubs.routes[Logic.DEFAULT_SERVER .. "/livros"] = { code = 200, body = "L" }
    Stubs.json.G = { genres = { { id = "autoajuda", name = "Autoajuda" } } }
    Stubs.json.L = { page = 1, hasNext = false, books = {} }
    dialog.buttons[1][2].callback()
    eq(plugin.settings:readSetting("username"), "leitor")
    local homes = {}
    for _, w in ipairs(Stubs.shown) do if w.genres then table.insert(homes, w) end end
    eq(#homes, 1); eq(#homes[1].genres, 1)
end)

print(string.format("%d testes de tela/rede passaram, %d falharam", passed, failed))
if failed > 0 then os.exit(1) end
