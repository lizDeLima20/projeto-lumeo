--[[--
Lumeo Livros: small pieces shared by the screens (e-ink: black on white, no grey fills, square
corners).
--]]

local Blitbuffer = require("ffi/blitbuffer")
local CenterContainer = require("ui/widget/container/centercontainer")
local Device = require("device")
local Font = require("ui/font")
local FrameContainer = require("ui/widget/container/framecontainer")
local Geom = require("ui/geometry")
local GestureRange = require("ui/gesturerange")
local ImageWidget = require("ui/widget/imagewidget")
local InputContainer = require("ui/widget/container/inputcontainer")
local Size = require("ui/size")
local TextBoxWidget = require("ui/widget/textboxwidget")
local TextWidget = require("ui/widget/textwidget")
local VerticalGroup = require("ui/widget/verticalgroup")
local VerticalSpan = require("ui/widget/verticalspan")
local Screen = Device.screen

local Widgets = {}

--- Any widget that reacts to a tap.
local Tappable = InputContainer:extend{ callback = nil }
function Tappable:init()
    self.ges_events = { TapSelect = { GestureRange:new{ ges = "tap", range = function() return self.dimen end } } }
end
function Tappable:onTapSelect()
    if self.callback then self.callback() end
    return true
end
Widgets.Tappable = Tappable

--- A genre in the carousel: framed text of a fixed width, inverted (white on black) when selected.
function Widgets.chip(text, selected, width, callback)
    local border, pad = Size.border.button, Screen:scaleBySize(6)
    local label = TextWidget:new{
        text = text,
        face = Font:getFace("cfont", 18),
        bold = selected,
        fgcolor = selected and Blitbuffer.COLOR_WHITE or Blitbuffer.COLOR_BLACK,
        max_width = width - 2 * (border + pad),
    }
    return Tappable:new{
        callback = callback,
        FrameContainer:new{
            width = width,
            bordersize = border,
            radius = 0,
            padding = pad,
            background = selected and Blitbuffer.COLOR_BLACK or Blitbuffer.COLOR_WHITE,
            CenterContainer:new{ dimen = Geom:new{ w = width - 2 * (border + pad), h = label:getSize().h }, label },
        },
    }
end

--- A cover image of exactly w x h (kept in proportion, centred), or a framed placeholder with
--- the title when the book has no cover (or it could not be fetched).
function Widgets.cover(path, w, h, title)
    if path then
        local ok, image = pcall(ImageWidget.new, ImageWidget, { file = path, width = w, height = h, scale_factor = 0, alpha = false })
        if ok and image then
            return CenterContainer:new{ dimen = Geom:new{ w = w, h = h }, image }
        end
    end
    return FrameContainer:new{
        width = w, height = h, bordersize = Size.border.thin, padding = Screen:scaleBySize(6), radius = 0,
        background = Blitbuffer.COLOR_WHITE,
        CenterContainer:new{
            dimen = Geom:new{ w = w - 2 * Screen:scaleBySize(6) - 2 * Size.border.thin, h = h - 2 * Screen:scaleBySize(6) - 2 * Size.border.thin },
            TextBoxWidget:new{ text = title or "", face = Font:getFace("cfont", 16), width = w - 2 * Screen:scaleBySize(10), alignment = "center", bold = true },
        },
    }
end

--- A grid cell: the cover in the Kindle library's proportion (2:3) and the title below it.
function Widgets.coverCell(book, cover_path, w, cover_h, title_h, callback)
    return Tappable:new{
        callback = callback,
        VerticalGroup:new{
            align = "center",
            Widgets.cover(cover_path, w, cover_h, book.title),
            VerticalSpan:new{ width = Screen:scaleBySize(4) },
            TextBoxWidget:new{
                text = book.title,
                face = Font:getFace("cfont", 15),
                width = w,
                height = title_h,
                alignment = "center",
                height_overflow_show_ellipsis = true,
            },
        },
    }
end

--- The rectangular action button (square corners, thick border) of the book screen.
function Widgets.rectButton(text, width, callback, enabled, show_parent)
    local Button = require("ui/widget/button")
    return Button:new{
        text = text,
        width = width,
        radius = 0,
        bordersize = Size.border.thick,
        padding = Screen:scaleBySize(10),
        text_font_size = 22,
        text_font_bold = true,
        enabled = enabled ~= false,
        callback = callback,
        show_parent = show_parent,
    }
end

return Widgets
