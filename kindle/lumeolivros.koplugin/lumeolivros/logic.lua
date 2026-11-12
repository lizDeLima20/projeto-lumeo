--[[--
Lumeo Livros: the logic that does not depend on KOReader (tested on the computer with
kindle/tests/run.lua). Screens and network live in the other modules.
--]]

local Logic = {}

--- The only folder books are saved to. The Kindle's own library indexes everything under
--- /mnt/us/documents, so the book shows up there with its cover; the reader never picks a folder.
Logic.KINDLE_LIBRARY_DIR = "/mnt/us/documents/Lumeo"
Logic.DEFAULT_SERVER = "https://lumeo-livros.vercel.app/api/opds/kindle"
--- Books per page in the API (server side) and covers per screen (3 x 3, like the Kindle's grid).
Logic.API_PAGE_SIZE = 30
Logic.GRID_COLUMNS = 3
Logic.GRID_ROWS = 3

--- JSON null arrives as a sentinel value, not nil: only real strings/numbers are kept.
function Logic.str(value)
    if type(value) == "string" and value ~= "" then return value end
    return nil
end
function Logic.num(value)
    if type(value) == "number" and value == value then return value end
    return nil
end

--- Percent-encodes a value for a query string (UTF-8 bytes, RFC 3986 unreserved kept).
function Logic.urlEncode(value)
    return (tostring(value):gsub("[^%w%-%._~]", function(char)
        return string.format("%%%02X", string.byte(char))
    end))
end

--- "https://host/api/opds/kindle" + "livros", { q = "x", page = 2 } -> ".../livros?page=2&q=x"
function Logic.apiUrl(server, path, params)
    local base = (server or Logic.DEFAULT_SERVER):gsub("/+$", "")
    local url = base .. "/" .. path
    if params then
        local keys = {}
        for key, value in pairs(params) do
            if value ~= nil and value ~= "" then table.insert(keys, key) end
        end
        table.sort(keys)
        local parts = {}
        for _, key in ipairs(keys) do
            table.insert(parts, Logic.urlEncode(key) .. "=" .. Logic.urlEncode(params[key]))
        end
        if #parts > 0 then url = url .. "?" .. table.concat(parts, "&") end
    end
    return url
end

--- A book from the API, with every field checked (a broken answer never breaks a screen).
function Logic.book(raw)
    if type(raw) ~= "table" or not Logic.str(raw.id) then return nil end
    local kindle = type(raw.kindle) == "table" and raw.kindle or {}
    local original = type(raw.original) == "table" and raw.original or {}
    return {
        id = raw.id,
        title = Logic.str(raw.title) or "Livro sem título",
        author = Logic.str(raw.author) or "Autor não informado",
        synopsis = Logic.str(raw.synopsis),
        language = Logic.str(raw.languageName) or Logic.str(raw.language),
        genre = Logic.str(raw.genre),
        genre_id = Logic.str(raw.genreId),
        cover = Logic.str(raw.cover),
        thumbnail = Logic.str(raw.thumbnail),
        original_format = Logic.str(original.format),
        kindle = {
            status = Logic.str(kindle.status) or "pending",
            format = Logic.str(kindle.format),
            size = Logic.num(kindle.size),
            url = Logic.str(kindle.url),
            file_name = Logic.str(kindle.fileName),
        },
    }
end

function Logic.books(list)
    local books = {}
    if type(list) ~= "table" then return books end
    for _, raw in ipairs(list) do
        local book = Logic.book(raw)
        if book then table.insert(books, book) end
    end
    return books
end

function Logic.genres(list)
    local genres = {}
    if type(list) ~= "table" then return genres end
    for _, raw in ipairs(list) do
        if type(raw) == "table" and Logic.str(raw.id) and Logic.str(raw.name) then
            table.insert(genres, { id = raw.id, name = raw.name })
        end
    end
    return genres
end

--- Only a converted AZW3 goes to the library.
function Logic.canDownload(book)
    return book ~= nil and book.kindle.status == "ready" and book.kindle.format == "azw3" and book.kindle.url ~= nil
end

--- Why a book cannot be downloaded (nil when it can).
function Logic.unavailableReason(book)
    if Logic.canDownload(book) then return nil end
    local status = book and book.kindle.status
    if status == "pending" or status == "processing" then
        return "A versão Kindle deste livro está sendo preparada. Tente de novo mais tarde."
    end
    return "Este livro ainda não tem versão Kindle (AZW3)."
end

--- "1,9 MB" / "293 KB".
function Logic.sizeLabel(bytes)
    if not bytes or bytes <= 0 then return nil end
    if bytes >= 1024 * 1024 then
        return (string.format("%.1f MB", bytes / 1024 / 1024):gsub("%.", ","))
    end
    return string.format("%d KB", math.max(1, math.floor(bytes / 1024 + 0.5)))
end

--- "Português (Brasil) · AZW3 · 1,9 MB": the language and format line of the book screen.
function Logic.detailsLine(book)
    local parts = {}
    if book.language then table.insert(parts, book.language) end
    if Logic.canDownload(book) then
        table.insert(parts, "AZW3" .. (Logic.sizeLabel(book.kindle.size) and (" · " .. Logic.sizeLabel(book.kindle.size)) or ""))
    elseif book.original_format then
        table.insert(parts, string.upper(book.original_format))
    end
    return table.concat(parts, " · ")
end

--- Characters FAT32 (the Kindle's storage) refuses, and control characters.
local FORBIDDEN = '[%c"%*/:<>%?\\|]'

--- A safe "Autor - Título.azw3": the server's suggestion when present, cleaned again here.
function Logic.fileName(book)
    local name = book.kindle.file_name
    if not name then
        local author = book.author ~= "Autor não informado" and book.author or nil
        name = (author and (author .. " - ") or "") .. book.title .. ".azw3"
    end
    name = name:gsub(FORBIDDEN, " "):gsub("%s+", " "):gsub("^%s+", "")
    local base = name:gsub("%.[Aa][Zz][Ww]3$", "")
    -- At most 200 bytes, cut on a UTF-8 character boundary.
    if #base > 200 then
        base = base:sub(1, 200)
        while #base > 0 and base:byte(#base) >= 0x80 and base:byte(#base) < 0xC0 do base = base:sub(1, -2) end
        if #base > 0 and base:byte(#base) >= 0xC0 then base = base:sub(1, -2) end
    end
    base = base:gsub("[%s%.]+$", "")
    if base == "" then base = "livro" end
    return base .. ".azw3"
end

--- The downloaded file must be a KF8 book ("BOOKMOBI", MOBI header version 8 or a KF8
--- boundary), never an error page saved under a book's name.
function Logic.isKf8(head)
    if type(head) ~= "string" or #head < 86 then return false, "arquivo incompleto" end
    if head:sub(61, 68) ~= "BOOKMOBI" then
        if head:sub(1, 200):lower():find("<html", 1, true) or head:sub(1, 200):lower():find("<!doctype", 1, true) then
            return false, "o servidor devolveu uma página em vez do livro"
        end
        return false, "o arquivo não é um livro Kindle (AZW3)"
    end
    local function u32(offset)
        local a, b, c, d = head:byte(offset + 1, offset + 4)
        if not d then return nil end
        return ((a * 256 + b) * 256 + c) * 256 + d
    end
    local record0 = u32(78)
    if not record0 or #head < record0 + 16 + 24 then return true end -- header beyond what was read: BOOKMOBI is enough
    if head:sub(record0 + 17, record0 + 20) ~= "MOBI" then return false, "cabeçalho MOBI ausente" end
    return true
end

--- Grid paging over the books already loaded: which slice a screen page shows.
function Logic.gridPage(total, page)
    local per_page = Logic.GRID_COLUMNS * Logic.GRID_ROWS
    local pages = math.max(1, math.ceil(total / per_page))
    page = math.max(1, math.min(page, pages))
    local first = (page - 1) * per_page + 1
    return { page = page, pages = pages, first = first, last = math.min(total, first + per_page - 1), per_page = per_page }
end

--- After a global search: the genre to select in the carousel (the first result's).
function Logic.searchGenre(books, genres)
    for _, book in ipairs(books) do
        if book.genre_id then
            for index, genre in ipairs(genres) do
                if genre.id == book.genre_id then return genre.id, index end
            end
        end
    end
    return nil, nil
end

--- The genres visible in the carousel: a window of `count` around the selected one.
function Logic.carouselWindow(total, selected, first, count)
    if total <= count then return 1, total end
    first = first or 1
    if selected then
        if selected < first then first = selected end
        if selected > first + count - 1 then first = selected - count + 1 end
    end
    first = math.max(1, math.min(first, total - count + 1))
    return first, first + count - 1
end

return Logic
