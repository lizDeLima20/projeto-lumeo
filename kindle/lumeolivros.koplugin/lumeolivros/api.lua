--[[--
Lumeo Livros: talks to the Lumeo API (the same catalog and the same login as the OPDS catalog)
and saves books into the Kindle library.
--]]

local DataStorage = require("datastorage")
local Device = require("device")
local JSON = require("json")
local Logic = require("lumeolivros/logic")
local http = require("socket.http")
local lfs = require("libs/libkoreader-lfs")
local logger = require("logger")
local ltn12 = require("ltn12")
local socket = require("socket")
local socketutil = require("socketutil")
local url = require("socket.url")
local util = require("util")

local Api = {}
Api.__index = Api

local REDIRECTS = { [301] = true, [302] = true, [303] = true, [307] = true, [308] = true }
local PORTS = { http = 80, https = 443 }

local function sameOrigin(left, right)
    return left.scheme == right.scheme and left.host == right.host
        and (left.port or PORTS[left.scheme]) == (right.port or PORTS[right.scheme])
end

function Api:new(settings)
    return setmetatable({ server = settings.server or Logic.DEFAULT_SERVER, username = settings.username, password = settings.password }, self)
end

--- The folder books go to: the Kindle library on a Kindle; on the computer (KOReader's emulator,
--- for testing) a "Lumeo" folder inside KOReader's data, since there is no /mnt/us there.
function Api.libraryDir()
    if Device:isKindle() then return Logic.KINDLE_LIBRARY_DIR end
    return DataStorage:getDataDir() .. "/Lumeo"
end

function Api.coverCacheDir()
    return DataStorage:getDataDir() .. "/cache/lumeolivros"
end

--- GET with up to 5 redirects. The password only goes to the Lumeo server itself, never to the
--- address a download is redirected to; https is never downgraded to http. `open_sink` gives a
--- fresh sink for every hop, so a redirect's own body is never kept.
function Api:request(target, open_sink, timeouts)
    local origin = url.parse(target)
    local current = target
    local block, total = socketutil:set_timeout(timeouts and timeouts[1] or socketutil.LARGE_BLOCK_TIMEOUT, timeouts and timeouts[2] or socketutil.LARGE_TOTAL_TIMEOUT)
    local ok, code, headers, status = pcall(function()
        for _ = 1, 5 do
            local parsed = url.parse(current)
            local same = sameOrigin(parsed, origin)
            local sink = open_sink()
            local request = {
                url = current,
                method = "GET",
                headers = { ["Accept-Encoding"] = "identity", ["User-Agent"] = "LumeoLivros/1.0 (KOReader)" },
                sink = sink,
                redirect = false,
                user = same and self.username or nil,
                password = same and self.password or nil,
            }
            local c, h, s = socket.skip(1, http.request(request))
            if c == socketutil.SSL_HANDSHAKE_CODE then c, h, s = socket.skip(1, http.request(request)) end
            if not (REDIRECTS[c] and h and h.location) then return c, h, s end
            local next_url = url.absolute(current, h.location)
            if parsed.scheme == "https" and url.parse(next_url).scheme ~= "https" then
                return nil, nil, "redirecionamento inseguro (https para http) recusado"
            end
            current = next_url
        end
        return nil, nil, "redirecionamentos demais"
    end)
    socketutil:reset_timeout()
    if not ok then return nil, nil, tostring(code) end
    if not code then return nil, headers, status end
    return code, headers, socketutil.describe_error(code, block, total) or status
end

--- Error message for a failed call, in the reader's words.
local function failure(code, status)
    if code == 401 then return "login", "Usuário ou senha incorretos." end
    if code == 429 then return "limit", "Muitas tentativas ou downloads. Tente de novo mais tarde." end
    if code == 404 then return "missing", "Não encontrado no catálogo." end
    if type(code) == "number" and code >= 500 then return "server", "O catálogo está indisponível agora. Tente de novo." end
    return "network", "Sem conexão com o catálogo." .. (status and ("\n" .. tostring(status)) or "")
end

--- GET and decode a JSON answer. Returns data, or nil + kind + message.
function Api:getJson(path, params)
    local chunks
    local code, _, status = self:request(Logic.apiUrl(self.server, path, params), function()
        chunks = {}
        return socketutil.table_sink(chunks)
    end)
    if code ~= 200 then return nil, failure(code, status) end
    local ok, data = pcall(JSON.decode, table.concat(chunks))
    if not ok or type(data) ~= "table" then return nil, "server", "Resposta inválida do catálogo." end
    return data
end

function Api:genres()
    local data, kind, message = self:getJson("generos")
    if not data then return nil, kind, message end
    return Logic.genres(data.genres)
end

--- A page of books: a genre (`genre_id`), a global search (`query`) or both absent (all).
function Api:books(genre_id, query, page)
    local data, kind, message = self:getJson("livros", { genero = genre_id, q = query, page = page and page > 1 and page or nil })
    if not data then return nil, kind, message end
    return { books = Logic.books(data.books), has_next = data.hasNext == true, page = Logic.num(data.page) or page or 1 }
end

function Api:book(id)
    local data, kind, message = self:getJson("livros/" .. Logic.urlEncode(id))
    if not data then return nil, kind, message end
    return Logic.book(data.book)
end

--- Downloads `remote` into `path` through a temporary ".part" file, so an interrupted download
--- never leaves half a book behind. `validate(head)` checks the first bytes before it is kept.
function Api:downloadTo(remote, path, timeouts, validate)
    local part = path .. ".part"
    local handle
    local code, _, status = self:request(remote, function()
        -- The previous hop's sink may have closed it already.
        if handle then pcall(handle.close, handle) end
        handle = io.open(part, "wb")
        if not handle then error("não foi possível gravar em " .. part) end
        return socketutil.file_sink(handle)
    end, timeouts)
    -- file_sink closes the handle when the body ends; closing twice is harmless.
    if handle then pcall(handle.close, handle) end
    if code ~= 200 then
        os.remove(part)
        return false, failure(code, status)
    end
    if validate then
        local file = io.open(part, "rb")
        local head = file and file:read(4096) or ""
        if file then file:close() end
        local valid, why = validate(head)
        if not valid then
            os.remove(part)
            return false, "invalid", why
        end
    end
    os.remove(path)
    local renamed, err = os.rename(part, path)
    if not renamed then
        os.remove(part)
        return false, "disk", "Não foi possível salvar o arquivo: " .. tostring(err)
    end
    return true
end

--- A cover, cached on the device (covers rarely change; the cache is only a few MB).
function Api:cover(remote, id, size)
    if not remote then return nil end
    local dir = Api.coverCacheDir()
    util.makePath(dir)
    local path = string.format("%s/%s-%s.jpg", dir, (id:gsub("[^%w%-_]", "_")), size)
    if lfs.attributes(path, "mode") == "file" and (lfs.attributes(path, "size") or 0) > 0 then return path end
    local ok = self:downloadTo(remote, path, { 10, 30 }, function(head)
        return head:sub(1, 3) == "\255\216\255", "capa inválida"
    end)
    if ok then return path end
    logger.warn("LumeoLivros: cover failed", id)
    return nil
end

--- Saves the book's AZW3 into the library folder. Returns the file's path, or nil + message.
function Api:downloadBook(book)
    if not Logic.canDownload(book) then return nil, Logic.unavailableReason(book) end
    local dir = Api.libraryDir()
    if not util.makePath(dir) and lfs.attributes(dir, "mode") ~= "directory" then
        return nil, "Não foi possível criar a pasta " .. dir .. "."
    end
    local path = dir .. "/" .. Logic.fileName(book)
    local ok, _, message = self:downloadTo(book.kindle.url, path, { 30, 900 }, Logic.isKf8)
    if not ok then return nil, message end
    Api.refreshKindleLibrary()
    return path
end

--- Asks the Kindle to index new books now (best effort: it also does it on its own when
--- KOReader is closed and the Kindle's interface comes back).
function Api.refreshKindleLibrary()
    if not Device:isKindle() then return end
    if lfs.attributes("/usr/bin/lipc-set-prop", "mode") ~= "file" then return end
    os.execute("lipc-set-prop com.lab126.scanner doFullScan 1 >/dev/null 2>&1 &")
end

return Api
