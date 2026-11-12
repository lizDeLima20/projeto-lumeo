--[[--
Lumeo Livros (KOReader on a jailbroken Kindle): Lumeo's own catalog screens, local on the
device. It reads the authenticated Lumeo API (the same catalog and login as the OPDS catalog)
and saves each book as AZW3 in /mnt/us/documents/Lumeo, where the Kindle's own library lists it
with its cover. Amazon's interface is not touched.

@module koplugin.LumeoLivros
--]]

local DataStorage = require("datastorage")
local Dispatcher = require("dispatcher")
local InfoMessage = require("ui/widget/infomessage")
local InputDialog = require("ui/widget/inputdialog")
local LuaSettings = require("luasettings")
local MultiInputDialog = require("ui/widget/multiinputdialog")
local NetworkMgr = require("ui/network/manager")
local UIManager = require("ui/uimanager")
local WidgetContainer = require("ui/widget/container/widgetcontainer")
local Api = require("lumeolivros/api")
local HomeScreen = require("lumeolivros/home")
local Logic = require("lumeolivros/logic")

local LumeoLivros = WidgetContainer:extend{
    name = "lumeolivros",
    is_doc_only = false,
}

function LumeoLivros:init()
    self.settings = LuaSettings:open(DataStorage:getSettingsDir() .. "/lumeolivros.lua")
    Dispatcher:registerAction("lumeolivros_open", { category = "none", event = "LumeoLivrosOpen", title = "Lumeo Livros", general = true })
    self.ui.menu:registerToMainMenu(self)
end

function LumeoLivros:addToMainMenu(menu_items)
    menu_items.lumeolivros = {
        text = "Lumeo Livros",
        sorting_hint = "search",
        sub_item_table = {
            { text = "Abrir Lumeo Livros", callback = function() self:open() end },
            { text = "Entrar com outro usuário", keep_menu_open = true, callback = function() self:askLogin() end },
            {
                text = "Sair (apagar o login deste Kindle)",
                enabled_func = function() return self.settings:readSetting("username") ~= nil end,
                callback = function()
                    self.settings:delSetting("username")
                    self.settings:delSetting("password")
                    self.settings:flush()
                    UIManager:show(InfoMessage:new{ text = "Login apagado deste Kindle.", timeout = 3 })
                end,
            },
            {
                text = "Endereço do catálogo",
                keep_menu_open = true,
                callback = function() self:askServer() end,
            },
        },
    }
end

function LumeoLivros:onLumeoLivrosOpen()
    self:open()
    return true
end

function LumeoLivros:api()
    return Api:new{
        server = self.settings:readSetting("server") or Logic.DEFAULT_SERVER,
        username = self.settings:readSetting("username"),
        password = self.settings:readSetting("password"),
    }
end

function LumeoLivros:open()
    if not self.settings:readSetting("username") then
        return self:askLogin(function() self:open() end)
    end
    NetworkMgr:runWhenOnline(function()
        local home = HomeScreen:new{
            api = self:api(),
            on_login_error = function()
                UIManager:show(InfoMessage:new{ text = "Usuário ou senha incorretos." })
                self:askLogin(function() self:open() end)
            end,
        }
        UIManager:show(home, "flashui")
        UIManager:nextTick(function() home:start() end)
    end)
end

--- The Lumeo login (the same user and password as the OPDS catalog), kept on this Kindle only.
function LumeoLivros:askLogin(after)
    local dialog
    dialog = MultiInputDialog:new{
        title = "Entrar no Lumeo",
        fields = {
            { text = self.settings:readSetting("username") or "", hint = "Usuário" },
            { text = "", hint = "Senha", text_type = "password" },
        },
        buttons = { {
            { text = "Cancelar", id = "close", callback = function() UIManager:close(dialog) end },
            { text = "Entrar", is_enter_default = true, callback = function()
                local fields = dialog:getFields()
                local username = (fields[1] or ""):gsub("^%s+", ""):gsub("%s+$", ""):lower()
                local password = fields[2] or ""
                if username == "" or password == "" then
                    UIManager:show(InfoMessage:new{ text = "Informe usuário e senha.", timeout = 3 })
                    return
                end
                UIManager:close(dialog)
                self.settings:saveSetting("username", username)
                self.settings:saveSetting("password", password)
                self.settings:flush()
                if after then after() end
            end },
        } },
    }
    UIManager:show(dialog)
    dialog:onShowKeyboard()
end

function LumeoLivros:askServer()
    local dialog
    dialog = InputDialog:new{
        title = "Endereço do catálogo",
        input = self.settings:readSetting("server") or Logic.DEFAULT_SERVER,
        buttons = { {
            { text = "Padrão", callback = function()
                self.settings:delSetting("server"); self.settings:flush(); UIManager:close(dialog)
            end },
            { text = "Cancelar", id = "close", callback = function() UIManager:close(dialog) end },
            { text = "Salvar", is_enter_default = true, callback = function()
                local value = dialog:getInputText():gsub("^%s+", ""):gsub("%s+$", "")
                if not value:match("^https://") then
                    UIManager:show(InfoMessage:new{ text = "O endereço precisa começar com https://", timeout = 3 })
                    return
                end
                self.settings:saveSetting("server", value); self.settings:flush(); UIManager:close(dialog)
            end },
        } },
    }
    UIManager:show(dialog)
    dialog:onShowKeyboard()
end

return LumeoLivros
