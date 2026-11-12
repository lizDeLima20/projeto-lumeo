-- Minimal stand-ins for the KOReader modules the plugin uses, so its screens and its network
-- code run on the computer (no screen, no network). They record what the plugin did.
local Stubs = { shown = {}, closed = {}, executed = {}, requests = {}, files = {} }

local function class(base)
    local cls = {}
    cls.__index = cls
    function cls:extend(fields)
        local sub = fields or {}
        for key, value in pairs(self) do if sub[key] == nil and key ~= "__index" then sub[key] = value end end
        sub.__index = sub
        return setmetatable(sub, { __index = self })
    end
    function cls:new(o)
        o = o or {}
        setmetatable(o, self)
        if o._init then o:_init() end
        if o.init then o:init() end
        return o
    end
    function cls:getSize() return { w = self.width or (self.dimen and self.dimen.w) or 100, h = self.height or (self.dimen and self.dimen.h) or 30 } end
    function cls:free() end
    if base then setmetatable(cls, { __index = base }) end
    return cls
end
Stubs.class = class

local Widget = class()
local Input = class(Widget)
function Input:_init() self.key_events = self.key_events or {}; self.ges_events = self.ges_events or {} end

local function widget(name) local cls = Widget:extend{ _stub = name }; return cls end

Stubs.dialogs = {}
local InputDialog = widget("InputDialog")
function InputDialog:init() table.insert(Stubs.dialogs, self) end
function InputDialog:getInputText() return self._typed or self.input or "" end
function InputDialog:onShowKeyboard() end
local MultiInputDialog = widget("MultiInputDialog")
function MultiInputDialog:init() table.insert(Stubs.dialogs, self) end
function MultiInputDialog:getFields() return self._typed or {} end
function MultiInputDialog:onShowKeyboard() end

local UIManager = {}
function UIManager:show(w) table.insert(Stubs.shown, w) end
function UIManager:close(w) table.insert(Stubs.closed, w) end
function UIManager:setDirty() end
function UIManager:forceRePaint() end
function UIManager:nextTick(fn) fn() end
function UIManager:scheduleIn(_, fn) fn() end

local Device
Device = {
    _kindle = false,
    isKindle = function() return Device._kindle end,
    hasKeys = function() return true end,
    isTouchDevice = function() return true end,
    input = { group = { Back = { "Back" }, PgFwd = { "RPgFwd" }, PgBack = { "RPgBack" } } },
    screen = { getWidth = function() return 1072 end, getHeight = function() return 1448 end, scaleBySize = function(_, v) return v end,
        getSize = function() return { w = 1072, h = 1448 } end },
}

local fs = {} -- path -> { mode = "file"/"directory", size = n }
Stubs.fs = fs
local lfs = {
    attributes = function(path, key) local entry = fs[path]; if not entry then return nil end; if key then return entry[key] end; return entry end,
    mkdir = function(path) fs[path:gsub("/$", "")] = { mode = "directory" }; return true end,
}

local modules = {
    ["ffi/blitbuffer"] = { COLOR_BLACK = "black", COLOR_WHITE = "white", COLOR_DARK_GRAY = "dark", COLOR_LIGHT_GRAY = "light", COLOR_GRAY = "gray" },
    ["ui/widget/container/centercontainer"] = widget("CenterContainer"),
    ["ui/widget/container/framecontainer"] = widget("FrameContainer"),
    ["ui/widget/container/leftcontainer"] = widget("LeftContainer"),
    ["ui/widget/container/inputcontainer"] = Input,
    ["ui/widget/container/widgetcontainer"] = Input,
    ["ui/widget/focusmanager"] = Input,
    ["ui/widget/imagewidget"] = widget("ImageWidget"),
    ["ui/widget/textboxwidget"] = widget("TextBoxWidget"),
    ["ui/widget/textwidget"] = widget("TextWidget"),
    ["ui/widget/scrolltextwidget"] = widget("ScrollTextWidget"),
    ["ui/widget/verticalgroup"] = widget("VerticalGroup"),
    ["ui/widget/horizontalgroup"] = widget("HorizontalGroup"),
    ["ui/widget/verticalspan"] = widget("VerticalSpan"),
    ["ui/widget/horizontalspan"] = widget("HorizontalSpan"),
    ["ui/widget/titlebar"] = widget("TitleBar"),
    ["ui/widget/button"] = widget("Button"),
    ["ui/widget/infomessage"] = widget("InfoMessage"),
    ["ui/widget/confirmbox"] = widget("ConfirmBox"),
    ["ui/widget/inputdialog"] = InputDialog,
    ["ui/widget/multiinputdialog"] = MultiInputDialog,
    ["ui/uimanager"] = UIManager,
    ["ui/geometry"] = { new = function(_, o) return o or {} end },
    ["ui/gesturerange"] = { new = function(_, o) return o or {} end },
    ["ui/font"] = { getFace = function(_, name, size) return { name = name, size = size } end },
    ["ui/size"] = { border = { button = 2, thick = 3, thin = 1, window = 2 }, padding = { default = 5, button = 2, fullscreen = 15 }, margin = { default = 5 } },
    ["ui/network/manager"] = { runWhenOnline = function(_, fn) fn() end },
    ["device"] = Device,
    ["datastorage"] = { getDataDir = function() return "/koreader" end, getSettingsDir = function() return "/koreader/settings" end },
    ["dispatcher"] = { registerAction = function() end },
    ["luasettings"] = { open = function() local data = {}; return {
        readSetting = function(_, k) return data[k] end, saveSetting = function(_, k, v) data[k] = v end,
        delSetting = function(_, k) data[k] = nil end, flush = function() end } end },
    ["libs/libkoreader-lfs"] = lfs,
    ["logger"] = { warn = function() end, dbg = function() end, info = function() end },
    ["util"] = { makePath = function(path) fs[path] = { mode = "directory" }; return true end },
    ["ltn12"] = {},
    ["gettext"] = setmetatable({}, { __call = function(_, s) return s end }),
}

-- socket / http: answers come from Stubs.routes[url] = { code, headers, body } (in order of calls).
Stubs.routes = {}
local socketutil = {
    LARGE_BLOCK_TIMEOUT = 10, LARGE_TOTAL_TIMEOUT = 30, SSL_HANDSHAKE_CODE = "wantread",
    set_timeout = function(self, b, t) self.block, self.total = b, t; return b, t end,
    reset_timeout = function() end,
    describe_error = function() return nil end,
    table_sink = function(t) return function(chunk) if chunk then table.insert(t, chunk) end; return 1 end, t end,
    file_sink = function(handle) return function(chunk) if chunk then handle:write(chunk) else handle:close() end; return 1 end end,
}
modules["socketutil"] = socketutil
modules["socket"] = { skip = function(_, ...) return select(2, ...) end }
modules["socket.http"] = {
    request = function(req)
        table.insert(Stubs.requests, { url = req.url, user = req.user, password = req.password, redirect = req.redirect })
        local answer = Stubs.routes[req.url]
        if type(answer) == "function" then answer = answer(req) end
        if not answer then return 1, nil, nil, "connection refused" end
        if answer.body and req.sink then req.sink(answer.body); req.sink(nil) end
        return 1, answer.code, answer.headers or {}, "HTTP " .. tostring(answer.code)
    end,
}
modules["socket.url"] = {
    parse = function(u)
        local scheme, rest = u:match("^(%a+)://(.*)$")
        local hostport = rest and rest:match("^([^/]*)") or ""
        local host, port = hostport:match("^([^:]+):?(%d*)$")
        return { scheme = scheme, host = host, port = port ~= "" and port or nil }
    end,
    absolute = function(base, rel) if rel:match("^%a+://") then return rel end; return base:match("^(%a+://[^/]+)") .. rel end,
}
modules["json"] = { decode = function(text) return Stubs.json[text] end }
Stubs.json = {} -- body text -> decoded table (no real JSON parser needed)

-- In-memory files for the downloads (io.open / os.rename / os.remove).
local real_open = io.open
Stubs.disk = {}
io.open = function(path, mode)
    if not path:match("^/koreader") and not path:match("^/mnt/us") then return real_open(path, mode) end
    if mode:match("^r") then
        local content = Stubs.disk[path]; if not content then return nil end
        local pos = 1
        return { read = function(_, n) local s = content:sub(pos, pos + n - 1); pos = pos + n; return s end, close = function() end }
    end
    Stubs.disk[path] = ""
    local closed = false
    return {
        write = function(_, s) if closed then error("attempt to use a closed file") end; Stubs.disk[path] = Stubs.disk[path] .. s; return true end,
        close = function() if closed then error("attempt to use a closed file") end; closed = true; fs[path] = { mode = "file", size = #Stubs.disk[path] } end,
    }
end
os.remove = function(path) Stubs.disk[path] = nil; fs[path] = nil; return true end
os.rename = function(from, to) Stubs.disk[to] = Stubs.disk[from]; Stubs.disk[from] = nil; fs[to] = fs[from]; fs[from] = nil; return true end
os.execute = function(command) table.insert(Stubs.executed, command); return true end

for name, value in pairs(modules) do package.preload[name] = function() return value end end
Stubs.Device = Device
Stubs.UIManager = UIManager
return Stubs
