-- Chronicler: records what happens while you play so the companion app can
-- line it up with your OBS recordings.
--
-- Everything is appended to ChroniclerDB.sessions[n].events. WoW writes
-- SavedVariables to disk on logout and /reload, and the companion picks the
-- file up from there. Nothing here talks to the network or the filesystem.

local ADDON_NAME = ...
local SCHEMA = 1
local MARK_KINDS = { lore = "Lore beat", shot = "Beautiful shot", funny = "Funny", redo = "Redo", mark = "Mark" }

BINDING_HEADER_CHRONICLER = "Chronicler"
BINDING_NAME_CHRONICLER_MARK_LORE = "Mark: lore beat"
BINDING_NAME_CHRONICLER_MARK_SHOT = "Mark: beautiful shot"
BINDING_NAME_CHRONICLER_MARK_FUNNY = "Mark: funny moment"
BINDING_NAME_CHRONICLER_MARK_REDO = "Mark: needs a redo"
BINDING_NAME_CHRONICLER_MARK = "Mark: generic"
BINDING_NAME_CHRONICLER_SYNC = "Sync flash (press after starting a recording)"

local frame = CreateFrame("Frame")
local session          -- the session table events are appended to
local anchor           -- { epoch = <whole second>, gt = GetTime() at that second }
local playerGUID
local lastZone, lastSubZone
local questTitles = {} -- questID -> title, so turn-ins can be named
local damaged = {}     -- creature GUID -> { at = GetTime(), name = name }
local credited = {}    -- creature GUID -> true once a kill is recorded
local book             -- the book or plaque currently open
local lastSweep = 0

-- Time --------------------------------------------------------------------

-- time() only has whole seconds. GetTime() has milliseconds but counts from an
-- arbitrary point. Waiting for time() to tick over pins the two together, so
-- every event gets a wall-clock time accurate to about one frame.
local function now()
	if anchor then
		return math.floor((anchor.epoch + (GetTime() - anchor.gt)) * 1000 + 0.5) / 1000
	end
	return time()
end

local calibrating
local function calibrate()
	calibrating = time()
	frame:SetScript("OnUpdate", function()
		local t = time()
		if t ~= calibrating then
			anchor = { epoch = t, gt = GetTime() }
			frame:SetScript("OnUpdate", nil)
		end
	end)
end

-- Helpers -----------------------------------------------------------------

local function round(n, places)
	local m = 10 ^ (places or 2)
	return math.floor(n * m + 0.5) / m
end

-- "Creature-0-4372-0-17-299-000015A2B3" -> "Creature", 299
local function parseGUID(guid)
	if type(guid) ~= "string" or guid == "" then return nil, nil end
	local kind, _, _, _, _, id = strsplit("-", guid)
	return kind, tonumber(id)
end

local function isCreature(kind)
	return kind == "Creature" or kind == "Vehicle"
end

local function where()
	local zone, sub = GetRealZoneText(), GetSubZoneText()
	local mapID, x, y
	if C_Map and C_Map.GetBestMapForUnit then
		mapID = C_Map.GetBestMapForUnit("player")
		if mapID and C_Map.GetPlayerMapPosition then
			local pos = C_Map.GetPlayerMapPosition(mapID, "player")
			if pos then x, y = pos:GetXY() end
		end
	end
	return zone, sub, mapID, x, y
end

local function record(kind, data)
	if not session then return end
	data = data or {}
	data.e = kind
	data.t = now()
	data.lvl = UnitLevel("player")
	local zone, sub, mapID, x, y = where()
	data.z = zone
	if sub and sub ~= "" then data.sz = sub end
	data.m = mapID
	if x and y and (x > 0 or y > 0) then
		data.x = round(x * 100)
		data.y = round(y * 100)
	end
	local events = session.events
	events[#events + 1] = data
	return data
end

local function say(msg)
	if not (ChroniclerDB and ChroniclerDB.settings.silent) then
		print("|cffd4a017Chronicler|r " .. msg)
	end
end

-- Turns a GlobalStrings format such as "You receive loot: %sx%d." into a Lua
-- pattern with captures, so loot parsing works in every client language.
local function toPattern(fmt)
	if type(fmt) ~= "string" then return nil end
	local p = fmt:gsub("([%(%)%.%+%-%*%?%[%]%^%$])", "%%%1")
	p = p:gsub("%%%d%$s", "(.+)"):gsub("%%%d%$d", "(%%d+)")
	p = p:gsub("%%s", "(.+)"):gsub("%%d", "(%%d+)")
	return "^" .. p .. "$"
end

local lootPatterns, learnPatterns, explorePatterns
local function buildPatterns()
	lootPatterns = {}
	for _, spec in ipairs({
		{ "LOOT_ITEM_SELF_MULTIPLE", "loot" }, { "LOOT_ITEM_SELF", "loot" },
		{ "LOOT_ITEM_PUSHED_SELF_MULTIPLE", "received" }, { "LOOT_ITEM_PUSHED_SELF", "received" },
		{ "LOOT_ITEM_CREATED_SELF_MULTIPLE", "created" }, { "LOOT_ITEM_CREATED_SELF", "created" },
	}) do
		local p = toPattern(_G[spec[1]])
		if p then lootPatterns[#lootPatterns + 1] = { p, spec[2] } end
	end
	learnPatterns = {}
	for _, name in ipairs({ "ERR_LEARN_SPELL_S", "ERR_LEARN_RECIPE_S", "ERR_LEARN_ABILITY_S" }) do
		local p = toPattern(_G[name])
		if p then learnPatterns[#learnPatterns + 1] = p end
	end
	explorePatterns = {}
	for _, name in ipairs({ "ERR_ZONE_EXPLORED_XP", "ERR_ZONE_EXPLORED" }) do
		local p = toPattern(_G[name])
		if p then explorePatterns[#explorePatterns + 1] = p end
	end
end

local QUALITY_BY_COLOR = {
	["9d9d9d"] = 0, ["ffffff"] = 1, ["1eff00"] = 2, ["0070dd"] = 3,
	["a335ee"] = 4, ["ff8000"] = 5, ["e6cc80"] = 6, ["00ccff"] = 7,
}

local function itemFromLink(link, count, source)
	local id = tonumber(link:match("|Hitem:(%d+)"))
	if not id then return nil end
	local item = { id = id, name = link:match("%[(.-)%]"), n = count or 1, src = source }
	local color = link:match("|cff(%x%x%x%x%x%x)")
	if color then item.q = QUALITY_BY_COLOR[color:lower()] end
	if GetItemInfo then
		local name, _, quality, ilvl, reqLevel, itemType, subType, _, equipLoc, icon = GetItemInfo(id)
		if name then
			item.name = name
			item.q = quality
			item.ilvl = ilvl
			item.req = reqLevel
			item.type = itemType
			item.sub = subType
			if equipLoc and equipLoc ~= "" then item.slot = equipLoc end
			item.icon = icon
		end
	end
	return item
end

-- Session -----------------------------------------------------------------

local function startSession()
	playerGUID = UnitGUID("player")
	local name, realm = UnitName("player"), GetRealmName()
	local race, raceToken = UnitRace("player")
	local class, classToken = UnitClass("player")
	local version, build, buildDate, interface = GetBuildInfo()
	session = {
		schema = SCHEMA,
		id = string.format("%s-%s-%d", realm or "realm", name or "player", time()),
		started = time(),
		char = {
			name = name, realm = realm, guid = playerGUID,
			race = race, raceToken = raceToken, class = class, classToken = classToken,
			faction = UnitFactionGroup("player"), level = UnitLevel("player"),
		},
		build = { version = version, build = build, date = buildDate, interface = interface },
		events = {},
	}
	local sessions = ChroniclerDB.sessions
	sessions[#sessions + 1] = session
	lastZone, lastSubZone = GetRealZoneText(), GetSubZoneText()
	record("session_start")
end

-- Marks (key bindings and /chron mark) -----------------------------------

function Chronicler_Mark(kind, note)
	kind = MARK_KINDS[kind] and kind or "mark"
	local e = record("mark", { kind = kind, note = (note and note ~= "") and note or nil })
	if e then say(MARK_KINDS[kind] .. " marked" .. (e.note and (": " .. e.note) or "")) end
end

-- Sync flash ----------------------------------------------------------------
--
-- For recording on a second PC: a full-screen white frame and a raid-warning
-- sound, logged with the exact moment they appeared. Find the flash in the
-- footage and the companion knows how the video lines up with the game clock.

local flash
local function buildFlash()
	-- No parent, so it still shows with the UI hidden (Alt+Z).
	flash = CreateFrame("Frame", nil, nil)
	flash:SetFrameStrata("TOOLTIP")
	flash:SetAllPoints(WorldFrame)
	local tex = flash:CreateTexture(nil, "BACKGROUND")
	tex:SetAllPoints(flash)
	tex:SetColorTexture(1, 1, 1, 1)
	flash.text = flash:CreateFontString(nil, "OVERLAY")
	flash.text:SetFont(STANDARD_TEXT_FONT, 42, "OUTLINE")
	flash.text:SetTextColor(0, 0, 0, 1)
	flash.text:SetPoint("CENTER", flash, "CENTER")
	flash:Hide()
end

function Chronicler_Sync()
	if not session then return end
	if not flash then buildFlash() end
	local t = now()
	local ms = math.floor((t % 1) * 1000 + 0.5) % 1000
	flash.text:SetText(string.format("CHRONICLER SYNC  %s.%03d", date("%H:%M:%S", math.floor(t)), ms))
	flash:Show()
	PlaySound(SOUNDKIT and SOUNDKIT.RAID_WARNING or 8959, "Master")
	local e = record("sync")
	if e then e.t = t end
	local hide = function() flash:Hide() end
	if C_Timer and C_Timer.After then C_Timer.After(0.25, hide) else hide() end
end

-- Event handlers ----------------------------------------------------------

local handlers = {}

function handlers.ADDON_LOADED(name)
	if name ~= ADDON_NAME then return end
	ChroniclerDB = ChroniclerDB or {}
	ChroniclerDB.schema = SCHEMA
	ChroniclerDB.sessions = ChroniclerDB.sessions or {}
	ChroniclerDB.settings = ChroniclerDB.settings or { silent = false }
	buildPatterns()
end

function handlers.PLAYER_LOGIN()
	calibrate()
	startSession()
	print("|cffd4a017Chronicler|r is logging. |cffffffff/chron|r for status.")
end

function handlers.PLAYER_LOGOUT()
	record("session_end")
end

local function onZone()
	local zone, sub = GetRealZoneText(), GetSubZoneText()
	if zone ~= lastZone or sub ~= lastSubZone then
		record("zone", { from = lastZone ~= zone and lastZone or nil })
		lastZone, lastSubZone = zone, sub
	end
end
handlers.ZONE_CHANGED_NEW_AREA = onZone
handlers.ZONE_CHANGED = onZone
handlers.ZONE_CHANGED_INDOORS = onZone

local function questNPC(data)
	local kind, id = parseGUID(UnitGUID("npc"))
	data.npc = UnitName("npc")
	data.npcId = id
	data.npcKind = kind
	return data
end

local function currentQuestID()
	local id = GetQuestID and GetQuestID()
	if id and id ~= 0 then return id end
end

function handlers.QUEST_DETAIL()
	local qid, title = currentQuestID(), GetTitleText()
	if qid then questTitles[qid] = title end
	record("quest_detail", questNPC({
		qid = qid, title = title, text = GetQuestText(), obj = GetObjectiveText(),
	}))
end

function handlers.QUEST_ACCEPTED(a, b)
	-- Classic clients pass (questLogIndex, questID); retail passes (questID).
	local qid = b or a
	local title = questTitles[qid]
	if not title and C_QuestLog and C_QuestLog.GetTitleForQuestID then
		title = C_QuestLog.GetTitleForQuestID(qid)
	end
	if not title and b and GetQuestLogTitle then title = GetQuestLogTitle(a) end
	if title then questTitles[qid] = title end
	record("quest_accept", { qid = qid, title = title })
end

function handlers.QUEST_PROGRESS()
	local qid, title = currentQuestID(), GetTitleText()
	if qid then questTitles[qid] = title end
	record("quest_progress", questNPC({ qid = qid, title = title, text = GetProgressText() }))
end

function handlers.QUEST_COMPLETE()
	local qid, title = currentQuestID(), GetTitleText()
	if qid then questTitles[qid] = title end
	record("quest_complete", questNPC({ qid = qid, title = title, text = GetRewardText() }))
end

function handlers.QUEST_TURNED_IN(qid, xp, money)
	record("quest_turnin", { qid = qid, title = questTitles[qid], xp = xp, money = money })
end

local function objectiveMessage(msg)
	if type(msg) == "string" and msg:find("%d+/%d+") then
		record("objective", { text = msg })
	end
end

local function exploreMessage(msg)
	if type(msg) ~= "string" then return false end
	for _, p in ipairs(explorePatterns) do
		local area = msg:match(p)
		if area then
			record("explore", { area = area })
			return true
		end
	end
	return false
end

function handlers.UI_INFO_MESSAGE(a, b)
	local msg = type(b) == "string" and b or a
	if not exploreMessage(msg) then objectiveMessage(msg) end
end

function handlers.GOSSIP_SHOW()
	local text
	if C_GossipInfo and C_GossipInfo.GetText then
		text = C_GossipInfo.GetText()
	elseif GetGossipText then
		text = GetGossipText()
	end
	local options
	if C_GossipInfo and C_GossipInfo.GetOptions then
		for _, opt in ipairs(C_GossipInfo.GetOptions() or {}) do
			options = options or {}
			options[#options + 1] = opt.name
		end
	end
	if (text and text ~= "") or options then
		record("gossip", questNPC({ text = text, options = options }))
	end
end

local SPEECH = {
	CHAT_MSG_MONSTER_SAY = "say", CHAT_MSG_MONSTER_YELL = "yell",
	CHAT_MSG_MONSTER_EMOTE = "emote", CHAT_MSG_MONSTER_WHISPER = "whisper",
	CHAT_MSG_MONSTER_PARTY = "party", CHAT_MSG_RAID_BOSS_EMOTE = "boss_emote",
	CHAT_MSG_RAID_BOSS_WHISPER = "boss_whisper",
}
for event, kind in pairs(SPEECH) do
	handlers[event] = function(text, speaker, ...)
		local guid = select(10, ...)
		local guidKind, id = parseGUID(guid)
		record("speech", { kind = kind, speaker = speaker, npcId = id, npcKind = guidKind, text = text })
	end
end

function handlers.ITEM_TEXT_BEGIN()
	book = { title = ItemTextGetItem and ItemTextGetItem(), pages = {} }
end

function handlers.ITEM_TEXT_READY()
	if not book then handlers.ITEM_TEXT_BEGIN() end
	local page = (ItemTextGetPage and ItemTextGetPage()) or (#book.pages + 1)
	book.pages[page] = ItemTextGetText()
end

function handlers.ITEM_TEXT_CLOSED()
	if not book then return end
	local pages, n = {}, 0
	for i in pairs(book.pages) do n = math.max(n, i) end
	for i = 1, n do pages[#pages + 1] = book.pages[i] or "" end
	if #pages > 0 then record("book", { title = book.title, pages = pages }) end
	book = nil
end

local function recordKill(guid, name, killingBlow)
	if credited[guid] then return end
	credited[guid] = true
	damaged[guid] = nil
	local kind, id = parseGUID(guid)
	record("kill", { name = name, npcId = id, npcKind = kind, blow = killingBlow or nil })
end

local function sweep()
	local t = GetTime()
	if t - lastSweep < 60 then return end
	lastSweep = t
	for guid, d in pairs(damaged) do
		if t - d.at > 600 then damaged[guid] = nil end
	end
	-- A GUID is never reused within a session, but the table would grow forever.
	local count = 0
	for _ in pairs(credited) do count = count + 1 end
	if count > 5000 then credited = {} end
end

function handlers.COMBAT_LOG_EVENT_UNFILTERED()
	local _, sub, _, srcGUID, _, _, _, dstGUID, dstName = CombatLogGetCurrentEventInfo()
	if sub == "UNIT_DIED" then
		local d = damaged[dstGUID]
		if d then recordKill(dstGUID, dstName or d.name, false) end
		return
	end
	local mine = srcGUID == playerGUID or (srcGUID ~= nil and srcGUID == UnitGUID("pet"))
	if not mine or dstGUID == playerGUID then return end
	if sub == "PARTY_KILL" then
		local kind = parseGUID(dstGUID)
		if isCreature(kind) or kind == "Player" then recordKill(dstGUID, dstName, true) end
	elseif sub:sub(-7) == "_DAMAGE" then
		local kind = parseGUID(dstGUID)
		if isCreature(kind) or kind == "Player" then
			damaged[dstGUID] = { at = GetTime(), name = dstName }
			sweep()
		end
	end
end

function handlers.CHAT_MSG_LOOT(msg)
	for _, spec in ipairs(lootPatterns) do
		local link, count = msg:match(spec[1])
		if link then
			local item = itemFromLink(link, tonumber(count), spec[2])
			if item then record("loot", item) end
			return
		end
	end
end

function handlers.CHAT_MSG_SKILL(msg)
	record("skill", { text = msg })
end

function handlers.CHAT_MSG_SYSTEM(msg)
	if exploreMessage(msg) then return end
	for _, p in ipairs(learnPatterns) do
		local what = msg:match(p)
		if what then
			local id = tonumber(what:match("|H%a+:(%d+)"))
			record("learn", { what = what:match("%[(.-)%]") or what, spellId = id })
			return
		end
	end
end

function handlers.PLAYER_LEVEL_UP(level)
	record("level", { level = level })
end

function handlers.PLAYER_DEAD()
	record("death")
end

function handlers.CINEMATIC_START()
	record("cinematic_start")
end

function handlers.CINEMATIC_STOP()
	record("cinematic_stop")
end

function handlers.PLAY_MOVIE(movieID)
	record("movie", { movieId = movieID })
end

if hooksecurefunc and AbandonQuest then
	hooksecurefunc("AbandonQuest", function()
		record("quest_abandon", { title = GetAbandonQuestName and GetAbandonQuestName() or nil })
	end)
end

frame:SetScript("OnEvent", function(_, event, ...)
	local handler = handlers[event]
	if handler then handler(...) end
end)

for event in pairs(handlers) do
	-- Some events only exist in some clients; registering a missing one errors.
	pcall(frame.RegisterEvent, frame, event)
end

-- Slash commands ----------------------------------------------------------

local function countEvents()
	local sessions, events = 0, 0
	for _, s in ipairs(ChroniclerDB.sessions) do
		sessions = sessions + 1
		events = events + #s.events
	end
	return sessions, events
end

local function help()
	print("|cffd4a017Chronicler|r commands:")
	print("  /chron status - what has been logged")
	print("  /chron mark [lore|shot|funny|redo] [note] - mark this moment")
	print("  /chron note <text> - a mark with a note")
	print("  /chron sync - sync flash and sound, for lining up recordings made on another PC")
	print("  /chron silent - toggle chat feedback for marks")
	print("  /chron clear - forget all logged sessions (after the companion has ingested them)")
end

SLASH_CHRONICLER1 = "/chron"
SLASH_CHRONICLER2 = "/chronicler"
SlashCmdList.CHRONICLER = function(input)
	local cmd, rest = (input or ""):match("^%s*(%S*)%s*(.-)%s*$")
	cmd = cmd:lower()
	if cmd == "" or cmd == "status" then
		local sessions, events = countEvents()
		print(string.format("|cffd4a017Chronicler|r %d events this session, %d sessions / %d events stored. Clock %s.",
			session and #session.events or 0, sessions, events, anchor and "calibrated" or "calibrating"))
	elseif cmd == "mark" then
		local kind, note = rest:match("^(%S*)%s*(.-)$")
		if MARK_KINDS[kind:lower()] then
			Chronicler_Mark(kind:lower(), note)
		else
			Chronicler_Mark("mark", rest)
		end
	elseif cmd == "note" then
		Chronicler_Mark("mark", rest)
	elseif cmd == "sync" then
		Chronicler_Sync()
	elseif cmd == "silent" then
		ChroniclerDB.settings.silent = not ChroniclerDB.settings.silent
		print("|cffd4a017Chronicler|r mark feedback " .. (ChroniclerDB.settings.silent and "off" or "on"))
	elseif cmd == "clear" then
		if rest == "confirm" then
			ChroniclerDB.sessions = {}
			startSession()
			print("|cffd4a017Chronicler|r cleared. Only make sure the companion ingested everything first.")
		else
			local sessions, events = countEvents()
			print(string.format("|cffd4a017Chronicler|r this deletes %d sessions / %d events from the addon. The companion keeps its own copy of everything it has ingested. Type /chron clear confirm to go ahead.", sessions, events))
		end
	else
		help()
	end
end
