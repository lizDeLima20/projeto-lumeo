--[[--
Lumeo Livros: the book screen. Large centred cover, title, author, synopsis, language and
format, the rectangular "Baixar para a biblioteca" button, the note under it and "Voltar".
The download always goes to the Kindle library folder: there is no folder to choose.
--]]

local Blitbuffer = require("ffi/blitbuffer")
local CenterContainer = require("ui/widget/container/centercontainer")
local ConfirmBox = require("ui/widget/confirmbox")
local Device = require("device")
local Font = require("ui/font")
local FocusManager = require("ui/widget/focusmanager")
local FrameContainer = require("ui/widget/container/framecontainer")
local Geom = require("ui/geometry")
local GestureRange = require("ui/gesturerange")
local InfoMessage = require("ui/widget/infomessage")
local NetworkMgr = require("ui/network/manager")
local ScrollTextWidget = require("ui/widget/scrolltextwidget")
local Size = require("ui/size")
local TextBoxWidget = require("ui/widget/textboxwidget")
local UIManager = require("ui/uimanager")
local VerticalGroup = require("ui/widget/verticalgroup")
local VerticalSpan = require("ui/widget/verticalspan")
local lfs = require("libs/libkoreader-lfs")
local Api = require("lumeolivros/api")
local Logic = require("lumeolivros/logic")
local Widgets = require("lumeolivros/widgets")
local Screen = Device.screen

local DetailsScreen = FocusManager:extend{
    api = nil,
    book = nil,
    close_callback = nil,
}

function DetailsScreen:init()
    self.dimen = Geom:new{ x = 0, y = 0, w = Screen:getWidth(), h = Screen:getHeight() }
    self.covers_fullscreen = true -- hint for UIManager:_repaint()
    if Device:hasKeys() then
        self.key_events.Close = { { Device.input.group.Back } }
    end
    if Device:isTouchDevice() then
        self.ges_events.Swipe = { GestureRange:new{ ges = "swipe", range = function() return self.dimen end } }
    end
    self.cover_path = self.api:cover(self.book.cover, self.book.id, "grande")
    self:build()
end

function DetailsScreen:build()
    local w, h = self.dimen.w, self.dimen.h
    local pad = Screen:scaleBySize(18)
    local inner = w - 2 * pad
    local gap = Screen:scaleBySize(8)
    local book = self.book

    -- Cover: about 36% of the screen's height, in the Kindle library's proportion (2:3).
    local cover_h = math.floor(h * 0.36)
    local cover_w = math.floor(cover_h * 2 / 3)
    if cover_w > inner then cover_w = inner; cover_h = math.floor(cover_w * 3 / 2) end

    local title = TextBoxWidget:new{
        text = book.title, face = Font:getFace("tfont", 24), width = inner, alignment = "center", bold = true,
        height = Screen:scaleBySize(70), height_adjust = true, height_overflow_show_ellipsis = true,
    }
    local author = TextBoxWidget:new{ text = book.author, face = Font:getFace("cfont", 19), width = inner, alignment = "center" }
    local details = TextBoxWidget:new{ text = Logic.detailsLine(book), face = Font:getFace("cfont", 16), width = inner, alignment = "center", fgcolor = Blitbuffer.COLOR_DARK_GRAY }

    local can = Logic.canDownload(book)
    local button = Widgets.rectButton("Baixar para a biblioteca", inner, function() self:download() end, can, self)
    local note = TextBoxWidget:new{ text = "O download será salvo na sua biblioteca Kindle", face = Font:getFace("cfont", 15), width = inner, alignment = "center" }
    local reason = not can and TextBoxWidget:new{ text = Logic.unavailableReason(book), face = Font:getFace("cfont", 15), width = inner, alignment = "center", bold = true } or nil
    local back = Widgets.rectButton("Voltar", math.floor(inner / 2), function() self:onClose() end, true, self)

    -- The synopsis takes what is left, and scrolls when longer.
    local fixed = pad + cover_h + gap + title:getSize().h + author:getSize().h + details:getSize().h + gap * 2
        + button:getSize().h + gap + note:getSize().h + (reason and (reason:getSize().h + gap) or 0) + gap * 2 + back:getSize().h + pad
    local synopsis_h = math.max(Screen:scaleBySize(60), h - fixed)
    local synopsis = ScrollTextWidget:new{
        text = book.synopsis or "Sinopse não disponível.",
        face = Font:getFace("cfont", 17),
        width = inner,
        height = synopsis_h,
        justified = true,
        dialog = self,
    }

    local column = VerticalGroup:new{
        align = "center",
        VerticalSpan:new{ width = pad },
        Widgets.cover(self.cover_path, cover_w, cover_h, book.title),
        VerticalSpan:new{ width = gap },
        title,
        author,
        details,
        VerticalSpan:new{ width = gap },
        synopsis,
        VerticalSpan:new{ width = gap },
    }
    if reason then
        table.insert(column, reason)
        table.insert(column, VerticalSpan:new{ width = gap })
    end
    table.insert(column, button)
    table.insert(column, VerticalSpan:new{ width = gap })
    table.insert(column, note)
    table.insert(column, VerticalSpan:new{ width = gap * 2 })
    table.insert(column, back)

    self.layout = { { button }, { back } }
    self[1] = FrameContainer:new{
        width = w, height = h, bordersize = 0, padding = 0, background = Blitbuffer.COLOR_WHITE,
        CenterContainer:new{ dimen = Geom:new{ w = w, h = h }, column },
    }
end

function DetailsScreen:download()
    local book = self.book
    NetworkMgr:runWhenOnline(function()
        local target = Api.libraryDir() .. "/" .. Logic.fileName(book)
        local function go()
            local wait = InfoMessage:new{ text = "Baixando “" .. book.title .. "”…" }
            UIManager:show(wait)
            UIManager:forceRePaint()
            local path, message = self.api:downloadBook(book)
            UIManager:close(wait)
            if path then
                UIManager:show(InfoMessage:new{
                    text = "Livro salvo na sua biblioteca Kindle.\n\nAo sair do KOReader, ele aparece na Biblioteca do Kindle, com capa.",
                })
            else
                UIManager:show(InfoMessage:new{ text = "Não foi possível baixar o livro.\n\n" .. tostring(message), icon = "notice-warning" })
            end
        end
        if lfs.attributes(target, "mode") == "file" then
            UIManager:show(ConfirmBox:new{
                text = "Este livro já está na sua biblioteca Kindle.\n\nBaixar de novo?",
                ok_text = "Baixar de novo",
                cancel_text = "Cancelar",
                ok_callback = go,
            })
        else
            go()
        end
    end)
end

function DetailsScreen:onSwipe(_, ges)
    -- Sideways only: vertical swipes scroll the synopsis.
    if ges.direction == "east" then return self:onClose() end
    return false
end

function DetailsScreen:onClose()
    -- Flash on close: the large cover would leave ghosting on e-ink.
    UIManager:close(self, "flashpartial")
    if self.close_callback then self.close_callback() end
    return true
end

return DetailsScreen
