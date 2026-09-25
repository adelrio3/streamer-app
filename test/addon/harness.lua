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
function hooksecurefunc(name, fn)
	local orig = _G[name]
	_G[name] = function(...) local r = { orig(...) }; fn(...); return unpack(r) end
end
SlashCmdList = {}
WorldFrame = {}
STANDARD_TEXT_FONT = "Fonts\\FRIZQT__.TTF"
SOUNDKIT = { RAID_WARNING = 8959 }
date = os.date
local sounds, timers = {}, {}
function PlaySound(id, channel) sounds[#sounds + 1] = { id, channel } end
C_Timer = { After = function(delay, fn) timers[#timers + 1] = fn end }

-- Frames ----------------------------------------------------------------------
local frames = {}
function CreateFrame()
	local f = { events = {}, scripts = {} }
	function f:RegisterEvent(e)
		if e == "EVENT_THAT_DOES_NOT_EXIST" then error("unknown event") end
		self.events[e] = true
	end
	function f:SetScript(name, fn) self.scripts[name] = fn end
	local noop = function() end
	f.SetFrameStrata, f.SetAllPoints, f.SetPoint = noop, noop, noop
	function f:Show() self.shown = true end
	function f:Hide() self.shown = false end
	function f:CreateTexture()
		return { SetAllPoints = noop, SetColorTexture = noop }
	end
	function f:CreateFontString()
		return { SetFont = noop, SetTextColor = noop, SetPoint = noop, SetText = function(fs, text) fs.text = text end }
	end
	frames[#frames + 1] = f
	return f
end
local function fire(event, ...)
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

-- Game state --------------------------------------------------------------
local state = {
	zone = "Elwynn Forest", sub = "Northshire Valley", map = 1429, x = 0.48, y = 0.42, level = 1,
	npc = nil, npcGUID = nil, quest = nil, gossip = nil, pet = nil, book = nil, combat = nil,
}
local PLAYER = "Player-4372-0ABCDEF1"

function UnitName(u) if u == "player" then return "Aldric" end if u == "npc" then return state.npc end end
function UnitGUID(u)
	if u == "player" then return PLAYER end
	if u == "npc" then return state.npcGUID end
	if u == "pet" then return state.pet end
end
function UnitLevel() return state.level end
function UnitRace() return "Human", "Human" end
function UnitClass() return "Paladin", "PALADIN" end
function UnitFactionGroup() return "Alliance" end
function GetRealmName() return "Mankrik" end
function GetBuildInfo() return "1.15.7", "61582", "Jun 1 2026", 11507 end
function GetRealZoneText() return state.zone end
function GetSubZoneText() return state.sub end
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
C_GossipInfo = {
	GetText = function() return state.gossip end,
	GetOptions = function() return { { name = "I would like to train." } } end,
}
function ItemTextGetItem() return state.book.title end
function ItemTextGetText() return state.book.pages[state.book.page] end
function ItemTextGetPage() return state.book.page end
function CombatLogGetCurrentEventInfo() return unpack(state.combat) end
local ITEMS = {
	[1372] = { "Ragged Leather Vest", nil, 0, 5, 1, "Armor", "Leather", 1, "INVTYPE_CHEST", 135009 },
}
function GetItemInfo(id) local i = ITEMS[id]; if i then return unpack(i) end end
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

-- Load the addon ------------------------------------------------------------
assert(loadfile(addonDir .. "/Boot.lua"))("Chronicler", {})
local bootSlash = SlashCmdList.CHRONICLER
local chunk = assert(loadfile(addonDir .. "/Chronicler.lua"))
chunk("Chronicler", {})

-- Scenario ------------------------------------------------------------------
assert(SlashCmdList.CHRONICLER ~= bootSlash, "main file should replace the boot fallback")
fire("ADDON_LOADED", "Chronicler")
fire("PLAYER_LOGIN")
frameTick(0.8) -- 0.25 + 0.8 crosses a whole second, so the clock calibrates
frameTick(0.1)

state.npc, state.npcGUID = "Deputy Willem", "Creature-0-4372-0-17-823-000015A2B3"
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
state.combat = { 0, "SWING_DAMAGE", false, PLAYER, "Aldric", 0, 0, "Creature-0-4372-0-17-6-00001", "Kobold Vermin", 0 }
fire("COMBAT_LOG_EVENT_UNFILTERED")
state.combat = { 0, "PARTY_KILL", false, PLAYER, "Aldric", 0, 0, "Creature-0-4372-0-17-6-00001", "Kobold Vermin", 0 }
fire("COMBAT_LOG_EVENT_UNFILTERED")
state.combat = { 0, "UNIT_DIED", false, "", nil, 0, 0, "Creature-0-4372-0-17-6-00001", "Kobold Vermin", 0 }
fire("COMBAT_LOG_EVENT_UNFILTERED")
frameTick(3)
state.combat = { 0, "SPELL_PERIODIC_DAMAGE", false, PLAYER, "Aldric", 0, 0, "Creature-0-4372-0-17-6-00002", "Kobold Vermin", 0 }
fire("COMBAT_LOG_EVENT_UNFILTERED")
state.combat = { 0, "UNIT_DIED", false, "", nil, 0, 0, "Creature-0-4372-0-17-6-00002", "Kobold Vermin", 0 }
fire("COMBAT_LOG_EVENT_UNFILTERED")
-- Someone else's kill is ignored.
state.combat = { 0, "UNIT_DIED", false, "", nil, 0, 0, "Creature-0-4372-0-17-6-00003", "Kobold Vermin", 0 }
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
fire("QUEST_TURNED_IN", 7, 170, 50)
state.level = 2
fire("PLAYER_LEVEL_UP", 2)
fire("CHAT_MSG_SYSTEM", "You have learned a new spell: |cff71d5ff|Hspell:635|h[Holy Light]|h|r.")
fire("CHAT_MSG_SKILL", "Your skill in Mining has increased to 2.")

frameTick(30)
state.zone, state.sub, state.x, state.y = "Elwynn Forest", "Goldshire", 0.42, 0.65
fire("ZONE_CHANGED")
fire("ZONE_CHANGED") -- no actual change, no event
fire("UI_INFO_MESSAGE", 0, "Discovered Goldshire: 20 experience gained")
SlashCmdList.CHRONICLER("sync")
assert(#sounds == 1 and sounds[1][1] == 8959 and sounds[1][2] == "Master", "sync plays a sound")
for _, fn in ipairs(timers) do fn() end
Chronicler_Mark("lore", nil)
SlashCmdList.CHRONICLER("mark shot sunset over the lake")
SlashCmdList.CHRONICLER("note wolf pathing weird")
AbandonQuest()
state.x = nil
fire("PLAYER_DEAD")
fire("PLAYER_LOGOUT")

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
