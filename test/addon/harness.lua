-- Runs the Chronicler addon against a fake WoW client and writes the result in
-- the same format WoW uses for SavedVariables.
--
--   lua5.1 test/addon/harness.lua <addon dir> <output file>

local addonDir, outFile = arg[1], arg[2]

-- Fake clock ----------------------------------------------------------------
local clock = { epoch = 1790000000, frac = 0.25, gt = 5000.0 }
function time() return clock.epoch end
function GetTime() return clock.gt end
local function advance(seconds)
	clock.gt = clock.gt + seconds
	local total = clock.frac + seconds
	clock.epoch = clock.epoch + math.floor(total)
	clock.frac = total - math.floor(total)
end

-- WoW Lua extras ------------------------------------------------------------
function strsplit(sep, s)
	local out = {}
	for piece in (s .. sep):gmatch("(.-)" .. sep:gsub("%p", "%%%0")) do out[#out + 1] = piece end
	return unpack(out)
end
_G.print = function(...) io.stderr:write(table.concat({ ... }, " "), "\n") end
function geterrorhandler() return function(err) error(err, 0) end end
function hooksecurefunc(name, fn)
	local orig = _G[name]
	_G[name] = function(...) local r = { orig(...) }; fn(...); return unpack(r) end
end
bit = { band = function(a, b)
	local r, p = 0, 1
	while a > 0 and b > 0 do
		if a % 2 == 1 and b % 2 == 1 then r = r + p end
		a, b, p = math.floor(a / 2), math.floor(b / 2), p * 2
	end
	return r
end }
SlashCmdList = {}
WorldFrame = {}
UIParent = { shown = true, IsShown = function(self) return self.shown end }
STANDARD_TEXT_FONT = "Fonts\\FRIZQT__.TTF"
SOUNDKIT = { RAID_WARNING = 8959 }
date = os.date
local sounds, timers, tickers = {}, {}, {}
function PlaySound(id, channel) sounds[#sounds + 1] = { id, channel } end
-- Like the game: the callback must be a Lua function (the game's own C
-- functions, such as Screenshot, are refused).
local function luaFunction(fn) return type(fn) == "function" and debug.getinfo(fn, "S").what ~= "C" end
C_Timer = {
	After = function(delay, fn) assert(luaFunction(fn), "Usage: C_Timer.After(seconds, callback)") timers[#timers + 1] = fn end,
	NewTicker = function(interval, fn) tickers[#tickers + 1] = fn; return {} end,
}
local function runTimers()
	local list = timers
	timers = {}
	for _, fn in ipairs(list) do fn() end
end
local cvars = { nameplateMaxAlpha = "1" }
-- Chat channels and the chat log (the live link).
local chat = { logging = false, sent = {}, filters = {} }
local fire -- defined with the frames below
function LoggingChat(on) if on ~= nil then chat.logging = on end return chat.logging end
function GetNormalizedRealmName() return "Whitemane" end
-- Like the game: say, yell and channels from an addon fail without a hardware event.
function SendChatMessage(msg, kind, _, target)
	assert(kind == "WHISPER", "Interface action failed because of an AddOn (" .. tostring(kind) .. ")")
	chat.sent[#chat.sent + 1] = { msg = msg, kind = kind, target = target, at = clock.epoch }
	-- The game echoes a whisper to yourself back as an incoming whisper.
	fire("CHAT_MSG_WHISPER_INFORM", msg, "Aldric")
	fire("CHAT_MSG_WHISPER", msg, "Aldric")
end
function ChatFrame_AddMessageEventFilter(event, fn) chat.filters[#chat.filters + 1] = { event = event, fn = fn } end
function GetCVar(k) return cvars[k] end
function SetCVar(k, v) cvars[k] = v end

-- Frames and tooltips -------------------------------------------------------
local frames = {}
local TOOLTIPS = {} -- hyperlink or unit -> { {left, right, r, g, b}, ... }
local function fontString()
	local fs = { text = nil, r = 1, g = 1, b = 1, shown = true }
	function fs:GetText() return self.text end
	function fs:GetTextColor() return self.r, self.g, self.b end
	function fs:IsShown() return self.shown and self.text ~= nil end
	return fs
end
function CreateFrame(kind, name)
	local f = { events = {}, scripts = {}, hooks = {}, name = name }
	function f:RegisterEvent(e)
		if e == "EVENT_THAT_DOES_NOT_EXIST" then error("unknown event") end
		self.events[e] = true
	end
	function f:SetScript(n, fn) self.scripts[n] = fn end
	function f:HookScript(n, fn) self.hooks[n] = self.hooks[n] or {}; table.insert(self.hooks[n], fn) end
	function f:HasScript() return true end
	function f:GetName() return self.name end
	local noop = function() end
	f.SetFrameStrata, f.SetAllPoints, f.SetPoint, f.SetOwner = noop, noop, noop, noop
	function f:Show() self.shown = true end
	function f:Hide() self.shown = false end
	function f:CreateTexture() return { SetAllPoints = noop, SetColorTexture = noop } end
	function f:CreateFontString()
		return { SetFont = noop, SetTextColor = noop, SetPoint = noop, SetText = function(fs, text) fs.text = text end }
	end
	if kind == "GameTooltip" then
		f.lines = 0
		function f:ClearLines()
			for i = 1, 30 do
				local l, r = _G[name .. "TextLeft" .. i], _G[name .. "TextRight" .. i]
				if l then l.text = nil end
				if r then r.text = nil end
			end
			self.lines = 0
		end
		local function fill(self, key)
			self:ClearLines()
			for i, line in ipairs(TOOLTIPS[key] or {}) do
				_G[name .. "TextLeft" .. i] = _G[name .. "TextLeft" .. i] or fontString()
				_G[name .. "TextRight" .. i] = _G[name .. "TextRight" .. i] or fontString()
				local l, r = _G[name .. "TextLeft" .. i], _G[name .. "TextRight" .. i]
				l.text, l.r, l.g, l.b = line[1], line[3] or 1, line[4] or 1, line[5] or 1
				r.text = line[2]
				self.lines = i
			end
		end
		function f:SetHyperlink(link) self.unit = nil; fill(self, link) end
		function f:SetUnit(unit) self.unit = unit; fill(self, "unit:" .. unit) end
		function f:GetUnit() if self.unit then return UnitName(self.unit), self.unit end end
		function f:NumLines() return self.lines end
		function f:GetItem() return nil, self.itemLink end
	end
	frames[#frames + 1] = f
	return f
end
GameTooltip = CreateFrame("GameTooltip", "GameTooltip")
ItemRefTooltip = CreateFrame("GameTooltip", "ItemRefTooltip")
fire = function(event, ...)
	for _, f in ipairs(frames) do
		if f.events[event] and f.scripts.OnEvent then f.scripts.OnEvent(f, event, ...) end
	end
end
local function frameTick(seconds)
	advance(seconds)
	for _, f in ipairs(frames) do
		if f.scripts.OnUpdate then f.scripts.OnUpdate(f, seconds) end
	end
end
local function trackTick()
	advance(2)
	for _, fn in ipairs(tickers) do fn() end
end

-- Game state --------------------------------------------------------------
local PLAYER = "Player-4372-0ABCDEF1"
local state = {
	zone = "Elwynn Forest", sub = "Northshire Valley", map = 1429, x = 0.48, y = 0.42, level = 1,
	quest = nil, gossip = nil, pet = nil, book = nil, combat = nil, money = 1000, hp = 100,
	mounted = false, taxi = false, indoors = false, combatFlag = false,
	units = {},
}
local function unit(u)
	if u == "npc" then return state.units.npc or {} end
	return state.units[u] or {}
end
function UnitName(u) if u == "player" then return "Aldric" end return unit(u).name end
function UnitGUID(u)
	if u == "player" then return PLAYER end
	if u == "pet" then return state.pet end
	return unit(u).guid
end
function UnitLevel(u) if u == "player" then return state.level end return unit(u).level end
function UnitClassification(u) return unit(u).rank or "normal" end
function UnitCreatureType(u) return unit(u).ctype end
function UnitCreatureFamily(u) return unit(u).family end
function UnitReaction(u) return unit(u).react end
function UnitHealthMax(u) if u == "player" then return 100 end return unit(u).hp end
function UnitHealth(u) if u == "player" then return state.hp end return unit(u).hp end
function UnitPowerMax(u) if u == "player" then return 60 end return 0 end
function UnitIsTapDenied() return false end
function UnitIsDead(u) return unit(u).dead end
function UnitRace() return "Human", "Human" end
function UnitClass() return "Paladin", "PALADIN" end
function UnitFactionGroup(u) if u == "player" then return "Alliance" end return unit(u).faction end
function UnitAffectingCombat() return state.combatFlag end
function UnitOnTaxi() return state.taxi end
function UnitIsDeadOrGhost() return false end
function UnitIsAFK() return false end
function UnitXP() return 50 end
function UnitXPMax() return 400 end
function UnitSex() return 2 end
function UnitStat(_, i) return 20, 20 + i end
function UnitArmor() return 30, 45 end
function UnitAttackPower() return 40, 5, 0 end
function UnitResistance(_, i) if i == 2 then return 0, 10 end return 0, 0 end
function UnitCharacterPoints() return 0 end
function IsMounted() return state.mounted end
function IsSwimming() return false end
function IsIndoors() return state.indoors end
function IsResting() return false end
function IsStealthed() return false end
function IsFalling() return false end
function GetPlayerFacing() return 1.57 end
function GetUnitSpeed() return state.mounted and 14 or 7 end
function GetGameTime() return 19, 30 end
function GetFramerate() return 59.7 end
function GetNetStats() return 0, 0, 42, 40 end
function GetCritChance() return 5.2 end
function GetDodgeChance() return 5 end
function GetParryChance() return 5 end
function GetBlockChance() return 5 end
function GetSpellCritChance() return 3 end
function GetRealmName() return "Mankrik" end
function GetBuildInfo() return "1.15.7", "61582", "Jun 1 2026", 11507 end
function GetRealZoneText() return state.zone end
function GetSubZoneText() return state.sub end
function GetMoney() return state.money end
function GetGuildInfo() return "Chroniclers" end
function GetBindLocation() return state.bind or "Northshire Abbey" end
C_Map = {
	GetBestMapForUnit = function() return state.map end,
	GetPlayerMapPosition = function()
		if not state.x then return nil end
		return { GetXY = function() return state.x, state.y end }
	end,
}
function GetQuestID() return state.quest and state.quest.id or 0 end
function GetTitleText() return state.quest.title end
function GetQuestText() return state.quest.text end
function GetObjectiveText() return state.quest.obj end
function GetProgressText() return state.quest.progress end
function GetRewardText() return state.quest.reward end
function GetQuestLogTitle() return state.quest.title end
function GetNumQuestRewards() return 1 end
function GetNumQuestChoices() return 0 end
function GetQuestItemLink(kind, i) return "|cffffffff|Hitem:1372::::|h[Ragged Leather Vest]|h|r" end
function GetQuestItemInfo() return "Ragged Leather Vest", 135009, 1 end
function GetRewardMoney() return 50 end
function GetRewardXP() return 170 end
C_GossipInfo = {
	GetText = function() return state.gossip end,
	GetOptions = function() return { { name = "I would like to train." } } end,
}
function ItemTextGetItem() return state.book.title end
function ItemTextGetText() return state.book.pages[state.book.page] end
function ItemTextGetPage() return state.book.page end
function CombatLogGetCurrentEventInfo() return unpack(state.combat) end
function GetSpellDescription(id) if id == 635 then return "Heals a friendly target." end return "" end

-- Items: [id] = GetItemInfo results; cached = false means "not in the cache yet".
local ITEMS = {
	[1372] = { "Ragged Leather Vest", "|cff9d9d9d|Hitem:1372::::|h[Ragged Leather Vest]|h|r", 0, 5, 1, "Armor", "Leather", 1, "INVTYPE_CHEST", 135009, 3, 4, 2, 0, 0, nil, false },
	[2589] = { "Linen Cloth", "|cffffffff|Hitem:2589::::|h[Linen Cloth]|h|r", 1, 5, 0, "Trade Goods", "Cloth", 20, "", 132889, 13, 7, 5, 0, 0, nil, true, cached = false },
	[159] = { "Refreshing Spring Water", "|cffffffff|Hitem:159::::|h[Refreshing Spring Water]|h|r", 1, 5, 1, "Consumable", "Consumable", 20, "", 132794, 1, 0, 0, 0, 0, nil, false },
	[2488] = { "Gladius", "|cffffffff|Hitem:2488::::|h[Gladius]|h|r", 1, 7, 2, "Weapon", "One-Handed Swords", 1, "INVTYPE_WEAPON", 135274, 60, 2, 7, 1, 0, nil, false },
}
function GetItemInfo(id)
	local i = ITEMS[tonumber(id)]
	if not i or i.cached == false then return nil end
	return unpack(i, 1, 17)
end
function GetItemStats(link) if link:find("2488") then return { ITEM_MOD_STRENGTH_SHORT = 1 } end return {} end
function GetItemSpell(id) if id == 159 then return "Drink", 430 end end
TOOLTIPS["item:1372"] = { { "Ragged Leather Vest", nil, 0.62, 0.62, 0.62 }, { "Chest", "Leather" }, { "11 Armor" }, { "Durability 25 / 25" } }
TOOLTIPS["item:2589"] = { { "Linen Cloth" }, { "Stitched together from threads spun by the humble.", nil, 1, 0.82, 0 } }
TOOLTIPS["item:159"] = { { "Refreshing Spring Water" }, { "Use: Restores 151 mana over 18 sec.", nil, 0, 1, 0 } }
TOOLTIPS["item:2488"] = { { "Gladius" }, { "One-Hand", "Sword" }, { "5 - 11 Damage", "Speed 2.60" }, { "+1 Strength" } }
TOOLTIPS["unit:mouseover"] = { { "Mother Fang" }, { "Level 10 Rare Elite Beast" } }
TOOLTIPS["unit:npc"] = { { "Brother Danil" }, { "<General Supplies>" }, { "Level 15" } }

-- Gear, talents, reputation, skills, bags
local gear = { [5] = "|cff9d9d9d|Hitem:1372::::|h[Ragged Leather Vest]|h|r" }
function GetInventoryItemLink(_, slot) return gear[slot] end
function GetNumTalentTabs() return 1 end
function GetTalentTabInfo() return "Holy", "icon", state.level >= 10 and 1 or 0 end
function GetNumTalents() return 1 end
function GetTalentInfo() return "Divine Strength", "icon", 1, 2, state.level >= 10 and 1 or 0, 5 end
function GetNumFactions() return 2 end
function GetFactionInfo(i)
	if i == 1 then return "Alliance", "", 4, 0, 3000, 0, false, false, true, false, false end
	return "Stormwind", "", 5, 3000, 9000, 3250, false, false, false, false, false
end
function GetNumSkillLines() return 2 end
function GetSkillLineInfo(i)
	if i == 1 then return "Professions", true end
	return "Mining", false, false, 2, 0, 0, 75
end
C_Container = {
	GetContainerNumSlots = function(bag) return bag == 0 and 2 or 0 end,
	GetContainerItemInfo = function(bag, slot)
		if slot == 1 then return { hyperlink = "|cffffffff|Hitem:159::::|h[Refreshing Spring Water]|h|r", stackCount = 5 } end
	end,
}

-- Loot window, vendor, trainer, flight master
local loot = {}
function GetNumLootItems() return #loot end
function GetLootSlotType(i) return loot[i].money and 2 or 1 end
function GetLootSlotInfo(i) return 132889, loot[i].name, loot[i].n or 1 end
function GetLootSlotLink(i) return loot[i].link end
function GetLootSourceInfo(i) return loot[i].src, 1 end
function IsFishingLoot() return false end
local merchant = {}
function GetMerchantNumItems() return #merchant end
function GetMerchantItemInfo(i) local m = merchant[i]; return m.name, 1, m.price, m.per, m.stock or -1, true, true, m.costs ~= nil end
function GetMerchantItemLink(i) return merchant[i].link end
function GetMerchantItemCostInfo(i) return #(merchant[i].costs or {}) end
function GetMerchantItemCostItem(i, j) local c = merchant[i].costs[j]; return 1, c.value, c.link, c.name end
function CanMerchantRepair() return true end
function GetNumTrainerServices() return 2 end
function GetTrainerServiceInfo(i)
	if i == 1 then return "Seal of Righteousness", "Rank 2", "available" end
	return "Blessing of Might", "Rank 1", "unavailable"
end
function GetTrainerServiceCost(i) return i == 1 and 100 or 200 end
function GetTrainerServiceLevelReq(i) return i == 1 and 2 or 4 end
function GetTrainerGreetingText() return "The Light calls to you." end
local taxiNodes = { { "Stormwind", "CURRENT", 0, 0.5, 0.6 }, { "Sentinel Hill", "REACHABLE", 50, 0.3, 0.7 } }
function NumTaxiNodes() return #taxiNodes end
function TaxiNodeName(i) return taxiNodes[i][1] end
function TaxiNodeGetType(i) return taxiNodes[i][2] end
function TaxiNodeCost(i) return taxiNodes[i][3] end
function TaxiNodePosition(i) return taxiNodes[i][4], taxiNodes[i][5] end
function TakeTaxiNode() end
local shots = 0
function Screenshot() shots = shots + 1; fire("SCREENSHOT_SUCCEEDED") end
function GetNumGroupMembers() return 0 end
function IsInRaid() return false end
function AbandonQuest() end
function GetAbandonQuestName() return "Kobold Camp Cleanup" end

LOOT_ITEM_SELF = "You receive loot: %s."
LOOT_ITEM_SELF_MULTIPLE = "You receive loot: %sx%d."
LOOT_ITEM_PUSHED_SELF = "You receive item: %s."
LOOT_ITEM_PUSHED_SELF_MULTIPLE = "You receive item: %sx%d."
LOOT_ITEM_CREATED_SELF = "You create: %s."
LOOT_ITEM_CREATED_SELF_MULTIPLE = "You create: %sx%d."
ERR_LEARN_SPELL_S = "You have learned a new spell: %s."
ERR_LEARN_RECIPE_S = "You have learned how to create a new item: %s."
ERR_ZONE_EXPLORED = "Discovered: %s"
ERR_ZONE_EXPLORED_XP = "Discovered %s: %d experience gained"
FACTION_STANDING_INCREASED = "Reputation with %s increased by %d."
FACTION_STANDING_DECREASED = "Reputation with %s decreased by %d."

-- Load the addon, in .toc order, sharing one namespace --------------------------
local ns = {}
assert(loadfile(addonDir .. "/Boot.lua"))("Chronicler", ns)
local bootSlash = SlashCmdList.CHRONICLER
assert(loadfile(addonDir .. "/Chronicler.lua"))("Chronicler", ns)
assert(loadfile(addonDir .. "/Capture.lua"))("Chronicler", ns)
assert(loadfile(addonDir .. "/Live.lua"))("Chronicler", ns)

-- Scenario ------------------------------------------------------------------
assert(SlashCmdList.CHRONICLER ~= bootSlash, "main file should replace the boot fallback")
fire("ADDON_LOADED", "Chronicler")
fire("PLAYER_LOGIN")
frameTick(0.8) -- 0.25 + 0.8 crosses a whole second, so the clock calibrates
frameTick(0.1)

state.units.npc = { name = "Deputy Willem", guid = "Creature-0-4372-0-17-823-000015A2B3", level = 10, react = 5, hp = 500, faction = "Alliance" }
state.quest = {
	id = 7, title = "Kobold Camp Cleanup",
	text = "Your first task is one of cleansing.\nA clan of kobolds have infested the woods.",
	obj = "Kill 10 Kobold Vermin, then return to Marshal McBride.",
	progress = "Have you finished?", reward = "You have done well, $N.",
}
fire("QUEST_DETAIL")
frameTick(2)
fire("QUEST_ACCEPTED", 3, 7)
frameTick(1)

-- A kill with the killing blow, and one a DoT finished after the fight.
state.combat = { 0, "SWING_DAMAGE", false, PLAYER, "Aldric", 0, 0, "Creature-0-4372-0-17-6-00001", "Kobold Vermin", 0x40, 0, 12 }
fire("COMBAT_LOG_EVENT_UNFILTERED")
state.combat = { 0, "PARTY_KILL", false, PLAYER, "Aldric", 0, 0, "Creature-0-4372-0-17-6-00001", "Kobold Vermin", 0x40 }
fire("COMBAT_LOG_EVENT_UNFILTERED")
state.combat = { 0, "UNIT_DIED", false, "", nil, 0, 0, "Creature-0-4372-0-17-6-00001", "Kobold Vermin", 0x40 }
fire("COMBAT_LOG_EVENT_UNFILTERED")
frameTick(3)
state.combat = { 0, "SPELL_PERIODIC_DAMAGE", false, PLAYER, "Aldric", 0, 0, "Creature-0-4372-0-17-6-00002", "Kobold Vermin", 0x40, 0, 0, "Consecration", 2, 6 }
fire("COMBAT_LOG_EVENT_UNFILTERED")
state.combat = { 0, "UNIT_DIED", false, "", nil, 0, 0, "Creature-0-4372-0-17-6-00002", "Kobold Vermin", 0x40 }
fire("COMBAT_LOG_EVENT_UNFILTERED")
-- Someone else's kill is ignored (but the kobold was seen).
state.combat = { 0, "UNIT_DIED", false, "", nil, 0, 0, "Creature-0-4372-0-17-6-00003", "Kobold Vermin", 0x40 }
fire("COMBAT_LOG_EVENT_UNFILTERED")

fire("UI_INFO_MESSAGE", 288, "Kobold Vermin slain: 2/10")
fire("UI_INFO_MESSAGE", 1, "Not enough rage")
fire("CHAT_MSG_LOOT", "You receive loot: |cff9d9d9d|Hitem:1372::::::::1:::::::|h[Ragged Leather Vest]|h|r.")
fire("CHAT_MSG_LOOT", "You receive loot: |cffffffff|Hitem:2589::::::::1:::::::|h[Linen Cloth]|h|rx2.")
fire("CHAT_MSG_LOOT", "Someone receives loot: |cffffffff|Hitem:2589::::::::1:::::::|h[Linen Cloth]|h|r.")
fire("CHAT_MSG_MONSTER_SAY", "Gnolls have been spotted near the vineyards!", "Marshal McBride", "Common", "", "", "", 0, 0, "", 7, 99, "Creature-0-4372-0-17-197-0000AAAA")
frameTick(5)

state.gossip = "Hello, $C. The Light guides us."
fire("GOSSIP_SHOW")

state.book = { title = "Plaque of the Fallen", pages = { "Here lie the brave.", "May they rest." }, page = 1 }
fire("ITEM_TEXT_BEGIN")
fire("ITEM_TEXT_READY")
state.book.page = 2
fire("ITEM_TEXT_READY")
fire("ITEM_TEXT_CLOSED")

fire("QUEST_PROGRESS")
fire("QUEST_COMPLETE")
state.money = 1050
fire("PLAYER_MONEY")
fire("QUEST_TURNED_IN", 7, 170, 50)
fire("QUEST_FINISHED")
runTimers()
state.level = 2
fire("PLAYER_LEVEL_UP", 2)
runTimers()
fire("CHAT_MSG_SYSTEM", "You have learned a new spell: |cff71d5ff|Hspell:635|h[Holy Light]|h|r.")
fire("CHAT_MSG_SKILL", "Your skill in Mining has increased to 2.")
fire("CHAT_MSG_COMBAT_XP_GAIN", "Kobold Vermin dies, you gain 45 experience.")
fire("CHAT_MSG_COMBAT_FACTION_CHANGE", "Reputation with Stormwind increased by 25.")

-- Travel: two track points on foot, then mounted with the UI hidden.
trackTick()
trackTick() -- identical position: skipped
state.x = 0.47
trackTick()
state.mounted = true
UIParent.shown = false
state.x = 0.46
trackTick()
UIParent.shown = true
state.mounted = false

-- NPCs: a nameplate, a rare under the mouse, a creature fighting nearby.
state.units.nameplate1 = { name = "Defias Thug", guid = "Creature-0-4372-0-17-38-00010", level = 3, react = 2, ctype = "Humanoid", hp = 90, faction = nil }
fire("NAME_PLATE_UNIT_ADDED", "nameplate1")
state.units.mouseover = { name = "Mother Fang", guid = "Creature-0-4372-0-17-471-00011", level = 10, rank = "rareelite", ctype = "Beast", family = "Spider", react = 2, hp = 600 }
fire("UPDATE_MOUSEOVER_UNIT")
runTimers() -- the rare's screenshot
state.combat = { 0, "SPELL_DAMAGE", false, "Creature-0-4372-0-17-257-00012", "Kobold Worker", 0x40, 0, "Creature-0-4372-0-17-299-00013", "Young Wolf", 0x20, 0, 0, "Bite", 1, 3 }
fire("COMBAT_LOG_EVENT_UNFILTERED")

-- A fight that nearly killed us.
state.units.target = state.units.nameplate1
fire("PLAYER_TARGET_CHANGED")
state.combatFlag = true
fire("PLAYER_REGEN_DISABLED")
state.combat = { 0, "SWING_DAMAGE", false, PLAYER, "Aldric", 0, 0, "Creature-0-4372-0-17-38-00010", "Defias Thug", 0x40, 0, 20 }
fire("COMBAT_LOG_EVENT_UNFILTERED")
state.combat = { 0, "SPELL_DAMAGE", false, "Creature-0-4372-0-17-38-00010", "Defias Thug", 0x40, 0, PLAYER, "Aldric", 0x10, 0, 0, "Backstab", 1, 88 }
fire("COMBAT_LOG_EVENT_UNFILTERED")
state.hp = 12
fire("UNIT_HEALTH", "player")
state.combat = { 0, "SPELL_DAMAGE", false, PLAYER, "Aldric", 0, 0, "Creature-0-4372-0-17-38-00010", "Defias Thug", 0x40, 0, 0, "Seal of Righteousness", 2, 70 }
fire("COMBAT_LOG_EVENT_UNFILTERED")
state.combat = { 0, "PARTY_KILL", false, PLAYER, "Aldric", 0, 0, "Creature-0-4372-0-17-38-00010", "Defias Thug", 0x40 }
fire("COMBAT_LOG_EVENT_UNFILTERED")
frameTick(8)
state.combatFlag = false
fire("PLAYER_REGEN_ENABLED")
state.hp = 100

-- Looting the thug: cloth, water and coins.
state.units.target.dead = true
loot = {
	{ name = "Linen Cloth", n = 2, link = "|cffffffff|Hitem:2589::::|h[Linen Cloth]|h|r", src = "Creature-0-4372-0-17-38-00010" },
	{ name = "Refreshing Spring Water", n = 1, link = "|cffffffff|Hitem:159::::|h[Refreshing Spring Water]|h|r", src = "Creature-0-4372-0-17-38-00010" },
	{ name = "12 Copper", money = true, src = "Creature-0-4372-0-17-38-00010" },
}
fire("LOOT_OPENED")
fire("LOOT_OPENED") -- autoloot fires twice: recorded once

-- A cactus: an object you only interact with. Opening it is a cast at it by
-- name, which names it even without a tooltip.
fire("UNIT_SPELLCAST_SENT", "player", "Cactus Apple", "Cast-3-4372-0-0-3365-000", 3365)
loot = { { name = "Cactus Apple", n = 1, link = "|cffffffff|Hitem:11583::::|h[Cactus Apple]|h|r", src = "GameObject-0-4372-0-17-171938-00040" } }
fire("LOOT_OPENED")
assert(ChroniclerDB.objects[171938] == "Cactus Apple", "object names are remembered")
do
	local last
	for _, e in ipairs(ChroniclerDB.sessions[1].events) do if e.e == "loot_window" then last = e end end
	assert(last.sources[1].kind == "GameObject" and last.sources[1].name == "Cactus Apple", "the loot window names the cactus")
	local named
	for _, e in ipairs(ChroniclerDB.sessions[1].events) do if e.e == "object" and e.objId == 171938 then named = e end end
	assert(named and named.name == "Cactus Apple", "an object event records the name once")
end

-- A unit's tooltip never names an object (that is how a cactus got called
-- "Scorpid Worker"); an object's own tooltip does.
GameTooltip:SetUnit("mouseover")
for _, fn in ipairs(GameTooltip.hooks.OnShow or {}) do fn(GameTooltip) end
frameTick(13) -- long after the cactus cast
loot = { { name = "Linen Cloth", n = 1, link = "|cffffffff|Hitem:2589::::|h[Linen Cloth]|h|r", src = "GameObject-0-4372-0-17-200-00041" } }
fire("LOOT_OPENED")
TOOLTIPS["object:chest"] = { { "Solid Chest" } }
GameTooltip:SetHyperlink("object:chest")
for _, fn in ipairs(GameTooltip.hooks.OnShow or {}) do fn(GameTooltip) end
loot = { { name = "Linen Cloth", n = 1, link = "|cffffffff|Hitem:2589::::|h[Linen Cloth]|h|r", src = "GameObject-0-4372-0-17-201-00042" } }
fire("LOOT_OPENED")
do
	local wins = {}
	for _, e in ipairs(ChroniclerDB.sessions[1].events) do if e.e == "loot_window" then wins[#wins + 1] = e end end
	local a, b = wins[#wins - 1], wins[#wins]
	assert(a.sources[1].id == 200 and a.sources[1].name == nil, "a unit tooltip does not name an object: " .. tostring(a.sources[1].name))
	assert(b.sources[1].id == 201 and b.sources[1].name == "Solid Chest", "an object tooltip names it: " .. tostring(b.sources[1].name))
end

-- A vendor, with a limited item and one costing an item.
state.units.npc = { name = "Brother Danil", guid = "Creature-0-4372-0-17-152-00020", level = 15, react = 5, hp = 700, faction = "Alliance" }
merchant = {
	{ name = "Refreshing Spring Water", price = 25, per = 1, link = "|cffffffff|Hitem:159::::|h[Refreshing Spring Water]|h|r" },
	{ name = "Gladius", price = 700, per = 1, stock = 2, link = "|cffffffff|Hitem:2488::::|h[Gladius]|h|r", costs = { { value = 3, link = "|cffffffff|Hitem:2589::::|h[Linen Cloth]|h|r", name = "Linen Cloth" } } },
}
fire("MERCHANT_SHOW")
fire("MERCHANT_UPDATE")
state.money = 1025
fire("PLAYER_MONEY")
fire("MERCHANT_CLOSED")
runTimers()

-- The item cache: Linen Cloth arrives from the server later, then a hover.
ITEMS[2589].cached = nil
fire("GET_ITEM_INFO_RECEIVED", 2589, true)
GameTooltip.itemLink = "|cffffffff|Hitem:2488::::|h[Gladius]|h|r"
for _, fn in ipairs(GameTooltip.hooks.OnTooltipSetItem or {}) do fn(GameTooltip) end
trackTick()

-- A trainer, a flight master, a flight, a new hearthstone.
fire("TRAINER_SHOW")
fire("TAXIMAP_OPENED")
TakeTaxiNode(2)
state.taxi = true
trackTick()
state.taxi = false
trackTick()
state.bind = "Lion's Pride Inn"
fire("HEARTHSTONE_BOUND")

-- New gear and a talent point.
gear[16] = "|cffffffff|Hitem:2488::::|h[Gladius]|h|r"
fire("PLAYER_EQUIPMENT_CHANGED", 16, true)
fire("PLAYER_EQUIPMENT_CHANGED", 16, true) -- same item again: ignored
state.level = 10
fire("CHARACTER_POINTS_CHANGED")

-- Social is off by default, then on.
fire("CHAT_MSG_SAY", "hello there", "Someone")
SlashCmdList.CHRONICLER("social on")
fire("CHAT_MSG_SAY", "anyone for Hogger?", "Someone")

frameTick(30)
state.zone, state.sub, state.x, state.y = "Elwynn Forest", "Goldshire", 0.42, 0.65
fire("ZONE_CHANGED")
fire("ZONE_CHANGED") -- no actual change, no event
fire("UI_INFO_MESSAGE", 0, "Discovered Goldshire: 20 experience gained")
runTimers()
SlashCmdList.CHRONICLER("sync")
assert(#sounds == 1 and sounds[1][1] == 8959 and sounds[1][2] == "Master", "sync plays a sound")
runTimers()
Chronicler_Mark("lore", nil)
SlashCmdList.CHRONICLER("mark shot sunset over the lake")
SlashCmdList.CHRONICLER("note wolf pathing weird")
AbandonQuest()
state.x = nil
-- Hogger finishes us off.
state.combat = { 0, "SWING_DAMAGE", false, "Creature-0-4372-0-17-448-00030", "Hogger", 0x40, 0, PLAYER, "Aldric", 0x10, 0, 150 }
fire("COMBAT_LOG_EVENT_UNFILTERED")
fire("PLAYER_DEAD")
runTimers()
-- A Lua error in a handler is recorded, with the event, and does not stop the others.
ns.on("CHAT_MSG_SKILL", function() error("boom") end)
local skillsBefore = #ChroniclerDB.sessions[1].events
fire("CHAT_MSG_SKILL", "Your skill in Fishing has increased to 3.")
fire("CHAT_MSG_SKILL", "Your skill in Fishing has increased to 4.")
assert(#ChroniclerDB.errors == 1 and ChroniclerDB.errors[1].n == 2, "the same error counts twice")
assert(ChroniclerDB.errors[1].msg:find("boom", 1, true) and ChroniclerDB.errors[1].ctx == "CHAT_MSG_SKILL", "error message and event kept")
assert(ChroniclerDB.errors[1].zone == "Elwynn Forest" and ChroniclerDB.errors[1].version, "where and which version")
assert(#ChroniclerDB.sessions[1].events == skillsBefore + 2, "the skill lines were still logged by the other listener")
fire("PLAYER_LOGOUT")
assert(shots == 4, "screenshots: rare, level, discovery, death; got " .. shots)

-- The live link whispered everything to the character itself.
assert(chat.logging, "the live link turns the chat log on")
assert(#chat.sent > 0, "sent live lines")
for _, m in ipairs(chat.sent) do
	assert(m.kind == "WHISPER" and m.target == "Aldric-Whitemane", "whispered to yourself, with the realm")
	assert(#m.msg <= 255, "chat messages fit in 255 bytes")
	assert(m.msg:sub(1, 7) == "CHRON1~", "prefixed")
end
local all = {}
for _, m in ipairs(chat.sent) do all[#all + 1] = m.msg end
all = table.concat(all, "\n")
assert(all:find("~~L~2589~Linen Cloth~1~2~", 1, true) or all:find("~L~2589~Linen Cloth~1~2~", 1, true), "loot line with count: " .. all)
assert(all:find("Q~accept~7~Kobold Camp Cleanup", 1, true), "quest accepted line")
assert(all:find("Q~progress~-~Kobold Vermin slain: 2/10", 1, true), "quest progress line")
assert(all:find("Q~turnin~7~", 1, true), "quest turn-in line")
assert(all:find("K~6~Kobold Vermin", 1, true), "kill line")
assert(all:find("~D~Hogger~448", 1, true) or all:find("~D~Hogger", 1, true), "death line: " .. all)
assert(all:find("~V~2", 1, true), "level line")
local hidden = 0
for _, f in ipairs(chat.filters) do
	if (f.event == "CHAT_MSG_WHISPER" or f.event == "CHAT_MSG_WHISPER_INFORM") and f.fn(nil, f.event, "CHRON1~K~1~x", "Aldric") then hidden = hidden + 1 end
	assert(not f.fn(nil, f.event, "hello there", "Bob"), "real whispers are not hidden")
end
assert(hidden == 2, "the live whispers are hidden from chat windows, both ways")
for _, e in ipairs(ChroniclerDB.sessions[1].events) do
	assert(not (e.e == "chat" and e.text and e.text:find("CHRON1~", 1, true)), "the live whispers are not logged as chat")
end
-- The test line goes out at once, even between ticks.
local before = #chat.sent
SlashCmdList.CHRONICLER("live test")
assert(#chat.sent == before + 1 and chat.sent[#chat.sent].msg:find("~T~", 1, true), "/chron live test sends a test line")

-- A chat log the way WoW writes it, for the web side's tests.
local log = {}
for _, m in ipairs(chat.sent) do
	local t = m.at
	local stamp = string.format("9/25 %02d:%02d:%02d.%03d", math.floor(t / 3600) % 24, math.floor(t / 60) % 60, math.floor(t) % 60, math.floor((t % 1) * 1000))
	-- A whisper to yourself lands in the log twice: sent, then received.
	log[#log + 1] = stamp .. "  To Aldric: " .. m.msg
	log[#log + 1] = stamp .. "  Aldric whispers: " .. m.msg
end
log[#log + 1] = "9/25 23:59:59.000  You receive loot: |cff1eff00|Hitem:1121::::::::1:::::::|h[Feet of the Lynx]|h|r."
local lf = assert(io.open(outFile .. ".chatlog.txt", "w"))
lf:write(table.concat(log, "\n") .. "\n")
lf:close()

-- Serialize like WoW -------------------------------------------------------
local function quote(s)
	return '"' .. s:gsub('[\\"\n\r]', { ["\\"] = "\\\\", ['"'] = '\\"', ["\n"] = "\\n", ["\r"] = "\\r" }) .. '"'
end
local function isArray(t)
	local n = #t
	for k in pairs(t) do
		if type(k) ~= "number" or k < 1 or k > n or k % 1 ~= 0 then return false end
	end
	return true
end
local function dump(v, indent, out)
	local tv = type(v)
	if tv == "string" then out[#out + 1] = quote(v)
	elseif tv == "number" then out[#out + 1] = (v % 1 == 0) and string.format("%d", v) or string.format("%.14g", v)
	elseif tv == "boolean" then out[#out + 1] = tostring(v)
	elseif tv == "table" then
		out[#out + 1] = "{\n"
		local inner = indent .. "\t"
		if isArray(v) then
			for i, item in ipairs(v) do
				out[#out + 1] = inner
				dump(item, inner, out)
				out[#out + 1] = ", -- [" .. i .. "]\n"
			end
		else
			local keys = {}
			for k in pairs(v) do keys[#keys + 1] = k end
			table.sort(keys, function(a, b) return tostring(a) < tostring(b) end)
			for _, k in ipairs(keys) do
				out[#out + 1] = inner .. "[" .. (type(k) == "string" and quote(k) or tostring(k)) .. "] = "
				dump(v[k], inner, out)
				out[#out + 1] = ",\n"
			end
		end
		out[#out + 1] = indent .. "}"
	else out[#out + 1] = "nil" end
end
local out = { "\n", "ChroniclerDB = " }
dump(ChroniclerDB, "", out)
out[#out + 1] = "\n"
local fh = assert(io.open(outFile, "w"))
fh:write(table.concat(out))
fh:close()
