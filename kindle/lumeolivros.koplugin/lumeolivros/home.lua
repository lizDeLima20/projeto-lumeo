--[[--
Lumeo Livros: the home screen. A global search (title or author), a horizontal carousel of
genres and, below, a grid of covers in the proportion of the Kindle's own library, with the
title under each cover. A search shows its results with the genre of the first result selected
in the carousel.
--]]

local Blitbuffer = require("ffi/blitbuffer")
local CenterContainer = require("ui/widget/container/centercontainer")
local Device = require("device")
local Font = require("ui/font")
local FocusManager = require("ui/widget/focusmanager")
local FrameContainer = require("ui/widget/container/framecontainer")
local Geom = require("ui/geometry")
local GestureRange = require("ui/gesturerange")
local HorizontalGroup = require("ui/widget/horizontalgroup")
local HorizontalSpan = require("ui/widget/horizontalspan")
local InfoMessage = require("ui/widget/infomessage")
local InputDialog = require("ui/widget/inputdialog")
local LeftContainer = require("ui/widget/container/leftcontainer")
local Size = require("ui/size")
local TextWidget = require("ui/widget/textwidget")
local TitleBar = require("ui/widget/titlebar")
local UIManager = require("ui/uimanager")
local VerticalGroup = require("ui/widget/verticalgroup")
local VerticalSpan = require("ui/widget/verticalspan")
local DetailsScreen = require("lumeolivros/details")
local Logic = require("lumeolivros/logic")
local Widgets = require("lumeolivros/widgets")
local Screen = Device.screen

local VISIBLE_GENRES = 3

local HomeScreen = FocusManager:extend{
    api = nil,
    --- Called with the error kind when the API refuses the login.
    on_login_error = nil,
    close_callback = nil,
}

function HomeScreen:init()
    self.dimen = Geom:new{ x = 0, y = 0, w = Screen:getWidth(), h = Screen:getHeight() }
    self.covers_fullscreen = true
    if Device:hasKeys() then
        self.key_events.Close = { { Device.input.group.Back } }
        self.key_events.NextPage = { { Device.input.group.PgFwd } }
        self.key_events.PrevPage = { { Device.input.group.PgBack } }
    end
    if Device:isTouchDevice() then
        self.ges_events.Swipe = { GestureRange:new{ ges = "swipe", range = function() return self.dimen end } }
    end
    self.genres = {}
    self.selected = nil      -- index of the selected genre in self.genres
    self.carousel_first = 1  -- first genre shown in the carousel
    self.query = nil         -- current global search, if any
    self.books = {}          -- books loaded so far (API pages appended)
    self.api_page = 0
    self.has_next = false
    self.grid_page = 1
    self.covers = {}         -- book id -> cached cover path (or false)
    self:build()
end

--- Loads the genres and the first genre's books. Returns false when the login was refused.
function HomeScreen:start()
    local genres, kind, message = self.api:genres()
    if not genres then return self:fail(kind, message) end
    self.genres = genres
    if #genres == 0 then
        self:refresh()
        UIManager:show(InfoMessage:new{ text = "O catálogo ainda não tem gêneros." })
        return true
    end
    return self:selectGenre(1)
end

function HomeScreen:fail(kind, message)
    if kind == "login" and self.on_login_error then
        self:onClose()
        self.on_login_error()
        return false
    end
    UIManager:show(InfoMessage:new{ text = message or "Não foi possível falar com o catálogo.", icon = "notice-warning" })
    return false
end

--- Shows a genre (clears the search).
function HomeScreen:selectGenre(index)
    self.selected, self.query = index, nil
    self.carousel_first = select(1, Logic.carouselWindow(#self.genres, index, self.carousel_first, VISIBLE_GENRES))
    return self:reload()
end

--- Global search; the carousel selects the genre of the first result.
function HomeScreen:search(query)
    query = query and query:gsub("^%s+", ""):gsub("%s+$", "") or ""
    if query == "" then return self:selectGenre(self.selected or 1) end
    self.query = query
    local ok = self:reload()
    if ok then
        if #self.books == 0 then
            UIManager:show(InfoMessage:new{ text = "Nenhum livro encontrado para “" .. query .. "”." })
        else
            local _, index = Logic.searchGenre(self.books, self.genres)
            if index then
                self.selected = index
                self.carousel_first = select(1, Logic.carouselWindow(#self.genres, index, self.carousel_first, VISIBLE_GENRES))
                self:refresh()
            end
        end
    end
    return ok
end

--- Loads page 1 of the current genre or search.
function HomeScreen:reload()
    self.books, self.api_page, self.has_next, self.grid_page = {}, 0, false, 1
    local ok = self:loadMore()
    self:refresh()
    return ok
end

--- Appends the next API page (30 books).
function HomeScreen:loadMore()
    local genre = not self.query and self.selected and self.genres[self.selected] or nil
    local wait = InfoMessage:new{ text = "Carregando…" }
    UIManager:show(wait)
    UIManager:forceRePaint()
    local page, kind, message = self.api:books(genre and genre.id or nil, self.query, self.api_page + 1)
    UIManager:close(wait)
    if not page then return self:fail(kind, message) end
    for _, book in ipairs(page.books) do table.insert(self.books, book) end
    self.api_page, self.has_next = self.api_page + 1, page.has_next
    return true
end

function HomeScreen:gotoGridPage(page)
    page = math.max(1, page)
    -- Fill the screen asked for: fetch API pages until it is full or the catalog has no more.
    local loaded = false
    while #self.books < page * Logic.GRID_COLUMNS * Logic.GRID_ROWS and self.has_next do
        if not self:loadMore() then break end
        loaded = true
    end
    local slice = Logic.gridPage(#self.books, page)
    if loaded or slice.page ~= self.grid_page then
        self.grid_page = slice.page
        self:refresh()
    end
end

function HomeScreen:openSearch()
    local dialog
    dialog = InputDialog:new{
        title = "Buscar livros",
        input = self.query or "",
        input_hint = "Título ou autor",
        buttons = { {
            { text = "Cancelar", id = "close", callback = function() UIManager:close(dialog) end },
            { text = "Buscar", is_enter_default = true, callback = function()
                local text = dialog:getInputText()
                UIManager:close(dialog)
                self:search(text)
            end },
        } },
    }
    UIManager:show(dialog)
    dialog:onShowKeyboard()
end

function HomeScreen:openBook(book)
    UIManager:show(DetailsScreen:new{ api = self.api, book = book }, "flashui")
end

function HomeScreen:build()
    local w, h = self.dimen.w, self.dimen.h
    local pad = Screen:scaleBySize(14)
    local inner = w - 2 * pad
    local gap = Screen:scaleBySize(10)

    local title_bar = TitleBar:new{ width = w, title = "Lumeo Livros", with_bottom_line = true, close_callback = function() self:onClose() end, show_parent = self }

    -- Search field (opens the keyboard); with a search active, a chip clears it.
    local search_text = self.query and ("Busca: " .. self.query) or "Buscar por título ou autor"
    local clear_w = self.query and Screen:scaleBySize(110) or 0
    local field_w = inner - (self.query and (clear_w + gap) or 0)
    local field = Widgets.Tappable:new{
        callback = function() self:openSearch() end,
        FrameContainer:new{
            width = field_w, bordersize = Size.border.thick, radius = 0, padding = Screen:scaleBySize(8),
            LeftContainer:new{
                dimen = Geom:new{ w = field_w - 2 * (Size.border.thick + Screen:scaleBySize(8)), h = Screen:scaleBySize(30) },
                TextWidget:new{ text = search_text, face = Font:getFace("cfont", 19), max_width = field_w - Screen:scaleBySize(40),
                    fgcolor = self.query and Blitbuffer.COLOR_BLACK or Blitbuffer.COLOR_DARK_GRAY },
            },
        },
    }
    local search_row = HorizontalGroup:new{ align = "center", field }
    if self.query then
        table.insert(search_row, HorizontalSpan:new{ width = gap })
        table.insert(search_row, Widgets.chip("Limpar", false, clear_w, function() self:selectGenre(self.selected or 1) end))
    end

    -- Genre carousel: arrows page through the genres, three at a time.
    local arrow_w = Screen:scaleBySize(44)
    local chips_w = inner - 2 * arrow_w
    local first, last = Logic.carouselWindow(#self.genres, self.selected, self.carousel_first, VISIBLE_GENRES)
    self.carousel_first = first
    local visible = math.max(1, last - first + 1)
    local chip_w = math.floor((chips_w - (visible - 1) * gap) / visible)
    local function arrow(text, enabled, callback)
        return Widgets.Tappable:new{
            callback = enabled and callback or nil,
            CenterContainer:new{ dimen = Geom:new{ w = arrow_w, h = Screen:scaleBySize(44) },
                TextWidget:new{ text = text, face = Font:getFace("tfont", 30), fgcolor = enabled and Blitbuffer.COLOR_BLACK or Blitbuffer.COLOR_LIGHT_GRAY } },
        }
    end
    local carousel = HorizontalGroup:new{ align = "center",
        arrow("‹", first > 1, function() self.carousel_first = math.max(1, first - VISIBLE_GENRES); self:refresh() end) }
    for index = first, last do
        local genre = self.genres[index]
        table.insert(carousel, Widgets.chip(genre.name, index == self.selected, chip_w, function() self:selectGenre(index) end))
        if index < last then table.insert(carousel, HorizontalSpan:new{ width = gap }) end
    end
    table.insert(carousel, arrow("›", last < #self.genres, function() self.carousel_first = math.min(#self.genres, last + 1); self:refresh() end))

    -- Footer: page arrows.
    local slice = Logic.gridPage(#self.books, self.grid_page)
    local more = slice.page < slice.pages or self.has_next
    local footer = HorizontalGroup:new{ align = "center",
        arrow("‹", slice.page > 1, function() self:gotoGridPage(slice.page - 1) end),
        CenterContainer:new{ dimen = Geom:new{ w = Screen:scaleBySize(200), h = Screen:scaleBySize(44) },
            TextWidget:new{ text = #self.books > 0 and ("Página " .. slice.page) or "", face = Font:getFace("cfont", 17) } },
        arrow("›", more, function() self:gotoGridPage(slice.page + 1) end),
    }

    -- Grid: 3 x 3 covers, 2:3 like the Kindle library, title under each one.
    local header_h = title_bar:getSize().h + gap + search_row:getSize().h + gap + carousel:getSize().h + gap
    local grid_h = h - header_h - footer:getSize().h - gap
    local title_h = Screen:scaleBySize(42)
    local col_w = math.floor((inner - (Logic.GRID_COLUMNS - 1) * gap) / Logic.GRID_COLUMNS)
    local row_h = math.floor((grid_h - (Logic.GRID_ROWS - 1) * gap) / Logic.GRID_ROWS)
    local cover_h = row_h - title_h - Screen:scaleBySize(4)
    local cover_w = math.floor(cover_h * 2 / 3)
    if cover_w > col_w then cover_w = col_w; cover_h = math.floor(cover_w * 3 / 2) end
    local grid = VerticalGroup:new{ align = "left" }
    for row = 0, Logic.GRID_ROWS - 1 do
        local line = HorizontalGroup:new{ align = "top" }
        for column = 1, Logic.GRID_COLUMNS do
            local index = slice.first + row * Logic.GRID_COLUMNS + column - 1
            local book = index <= slice.last and self.books[index] or nil
            local cell
            if book then
                if self.covers[book.id] == nil then self.covers[book.id] = self.api:cover(book.thumbnail, book.id, "capa") or false end
                cell = Widgets.coverCell(book, self.covers[book.id] or nil, cover_w, cover_h, title_h, function() self:openBook(book) end)
            end
            table.insert(line, CenterContainer:new{ dimen = Geom:new{ w = col_w, h = row_h }, cell or VerticalSpan:new{ width = 0 } })
            if column < Logic.GRID_COLUMNS then table.insert(line, HorizontalSpan:new{ width = gap }) end
        end
        table.insert(grid, line)
        if row < Logic.GRID_ROWS - 1 then table.insert(grid, VerticalSpan:new{ width = gap }) end
    end

    self[1] = FrameContainer:new{
        width = w, height = h, bordersize = 0, padding = 0, background = Blitbuffer.COLOR_WHITE,
        VerticalGroup:new{
            align = "center",
            title_bar,
            VerticalSpan:new{ width = gap },
            search_row,
            VerticalSpan:new{ width = gap },
            carousel,
            VerticalSpan:new{ width = gap },
            CenterContainer:new{ dimen = Geom:new{ w = w, h = grid_h }, grid },
            footer,
        },
    }
end

--- Fetches the covers of the screen about to be shown (cached on the device afterwards).
function HomeScreen:prefetchCovers()
    local slice = Logic.gridPage(#self.books, self.grid_page)
    local missing = {}
    for index = slice.first, slice.last do
        local book = self.books[index]
        if book and self.covers[book.id] == nil then table.insert(missing, book) end
    end
    if #missing == 0 then return end
    local wait = InfoMessage:new{ text = "Carregando capas…" }
    UIManager:show(wait)
    UIManager:forceRePaint()
    for _, book in ipairs(missing) do
        self.covers[book.id] = self.api:cover(book.thumbnail, book.id, "capa") or false
    end
    UIManager:close(wait)
end

function HomeScreen:refresh()
    self:prefetchCovers()
    self:build()
    UIManager:setDirty(self, "ui")
end

function HomeScreen:onNextPage() self:gotoGridPage(self.grid_page + 1); return true end
function HomeScreen:onPrevPage() self:gotoGridPage(self.grid_page - 1); return true end

function HomeScreen:onSwipe(_, ges)
    if ges.direction == "west" then return self:onNextPage() end
    if ges.direction == "east" then return self:onPrevPage() end
    return false
end

function HomeScreen:onClose()
    UIManager:close(self, "flashpartial")
    if self.close_callback then self.close_callback() end
    return true
end

return HomeScreen
