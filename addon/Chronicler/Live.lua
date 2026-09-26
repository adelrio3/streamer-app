-- Live link. WoW only writes the addon's log to disk at logout or /reload,
-- so nothing here reaches the web app while you play. The one file the game
-- does write as it happens is the chat log (Logs\WoWChatLog.txt). This
-- module whispers what happens (loot, quest progress, kills, deaths, levels)
-- to your own character, in a compact form, so the chat log carries it out
-- of the game for the stream overlay. Whispers are the one kind of chat an
-- addon may send on its own: say, yell and channels need a key press or a
-- click behind them, or the game answers "Interface action failed because
-- of an AddOn" and drops the message. The whispers are filtered out of
-- every chat window, so nothing shows on stream.

local ADDON_NAME, ns = ...

local PREFIX = "CHRON1"
local SEP, EVSEP = "~", "~~"
local MAX = 240 -- a chat message holds 255 bytes
local MIN_GAP = 0.6 -- seconds between messages (the server throttles chat)
local HEARTBEAT = 60

local queue = {}
local target = nil -- your own character, as a whisper target
local sent = 0
local lastSend = 0
local lastBeat = 0
local unflushed = false -- something was sent since the log was last flushed

local function settings()
	ChroniclerDB = ChroniclerDB or {}
	ChroniclerDB.settings = ChroniclerDB.settings or {}
	return ChroniclerDB.settings
end

local function enabled()
	return settings().live ~= false
end

local function clean(v)
	if v == nil or v == "" then return "-" end
	v = tostring(v):gsub("~", "-"):gsub("[\r\n]", " ")
	return v
end

local function push(kind, ...)
	if not enabled() then return end
	local parts = { kind }
	for i = 1, select("#", ...) do parts[#parts + 1] = clean((select(i, ...))) end
	local line = table.concat(parts, SEP)
	if #line > MAX then line = line:sub(1, MAX) end
	queue[#queue + 1] = line
	if #queue > 300 then table.remove(queue, 1) end
end

-- Whispers go to yourself. Name-Realm works on every server.
local function whisperTarget()
	if target then return target end
	local name = UnitName("player")
	if not name or name == "" then return nil end
	local realm = (GetNormalizedRealmName and GetNormalizedRealmName()) or (GetRealmName and GetRealmName():gsub("%s", "")) or ""
	target = realm ~= "" and (name .. "-" .. realm) or name
	return target
end

-- Is this chat line one of ours? Used to hide it and to keep it out of the
-- social log.
local function isLiveLine(text)
	return type(text) == "string" and text:find(PREFIX .. SEP, 1, true) == 1
end
ns.isLiveLine = isLiveLine

-- Hides the addon's whispers from every chat window (both the "To you:"
-- copy and the "you whisper:" copy). The chat log on disk still gets them.
local function filter(_, event, text)
	return isLiveLine(text)
end

local function flush()
	if #queue == 0 or not enabled() then return end
	local to = whisperTarget()
	if not to then return end
	local now = GetTime()
	if now - lastSend < MIN_GAP then return end
	local msg, n = "", 0
	while queue[1] do
		local line = queue[1]
		local next = n == 0 and line or (msg .. EVSEP .. line)
		if n > 0 and #next > MAX then break end
		msg = next
		n = n + 1
		table.remove(queue, 1)
	end
	if n == 0 then return end
	if SendChatMessage then SendChatMessage(PREFIX .. SEP .. msg, "WHISPER", nil, to) end
	sent = sent + 1
	lastSend = now
	unflushed = true
end

-- The game keeps the chat log in a buffer and writes it to disk only when
-- the buffer fills (or at logout), so a few short lines would sit there for
-- a long time. Turning logging off and on again closes and reopens the
-- file, which writes the buffer out. The API itself prints nothing (the
-- "Chat logging enabled" lines come from the /chatlog command's Lua code).
local FLUSH_AFTER = 1.5 -- seconds after the last send
local function flushLog()
	if not unflushed or not LoggingChat then return end
	if GetTime() - lastSend < FLUSH_AFTER then return end
	LoggingChat(false)
	LoggingChat(true)
	unflushed = false
end

local function heartbeat()
	local zone, sub, _, x, y = ns.where()
	push("H", UnitLevel("player"), UnitXP and UnitXP("player") or 0, UnitXPMax and UnitXPMax("player") or 0, zone, sub,
		x and ns.round(x * 100) or "-", y and ns.round(y * 100) or "-", GetMoney and GetMoney() or 0)
	lastBeat = GetTime()
end

-- Everything the addon records passes through here (see record() in
-- Chronicler.lua); the kinds the overlay cares about go out.
ns.liveEvent = function(kind, data)
	if not enabled() then return end
	data = data or {}
	if kind == "loot" then
		if data.src == "created" then return end
		local src = ns.lastLoot and ns.lastLoot()
		push("L", data.id, data.name, data.q, data.n, src and src.name, src and src.id)
	elseif kind == "quest_accept" then push("Q", "accept", data.qid, data.title)
	elseif kind == "quest_turnin" then push("Q", "turnin", data.qid, data.title, data.xp, data.money)
	elseif kind == "quest_abandon" then push("Q", "abandon", data.qid, data.title)
	elseif kind == "quest_complete" then push("Q", "complete", data.qid, data.title)
	elseif kind == "objective" then push("Q", "progress", "-", data.text)
	elseif kind == "kill" then push("K", data.npcId, data.name)
	elseif kind == "death" then push("D", data.killer, data.killerId)
	elseif kind == "level" then push("V", data.level) heartbeat()
	elseif kind == "zone" then push("Z", data.z, data.sz)
	elseif kind == "rare" then push("R", data.npcId, data.name, data.level, data.rank)
	elseif kind == "money" then
		if (data.delta or 0) > 0 then push("M", data.delta, data.total) end
	elseif kind == "xp" then push("X", data.amount)
	elseif kind == "skill" then push("S", data.text)
	elseif kind == "explore" then push("E", data.area)
	elseif kind == "mark" then push("A", data.kind, data.note)
	elseif kind == "screenshot" then push("P", data.reason)
	end
end

local function tick()
	if not enabled() then return end
	flush()
	flushLog()
	if GetTime() - lastBeat > HEARTBEAT then heartbeat() end
end

ns.on("PLAYER_LOGIN", function()
	if not enabled() then return end
	if LoggingChat then LoggingChat(true) end
	if ChatFrame_AddMessageEventFilter then
		ChatFrame_AddMessageEventFilter("CHAT_MSG_WHISPER", filter)
		ChatFrame_AddMessageEventFilter("CHAT_MSG_WHISPER_INFORM", filter)
	end
	local name, realm = UnitName("player"), GetRealmName and GetRealmName() or ""
	push("B", (C_AddOns and C_AddOns.GetAddOnMetadata and C_AddOns.GetAddOnMetadata(ADDON_NAME, "Version")) or (GetAddOnMetadata and GetAddOnMetadata(ADDON_NAME, "Version")) or "?", name, realm, UnitLevel("player"))
	if C_Timer and C_Timer.NewTicker then C_Timer.NewTicker(0.5, tick) end
end)

-- Whatever is still waiting goes out before the game closes.
ns.on("PLAYER_LOGOUT", function()
	lastSend = -MIN_GAP
	flush()
end)

ns.commands.live = function(arg)
	arg = (arg or ""):lower()
	if arg == "on" then
		settings().live = true
		if LoggingChat then LoggingChat(true) end
		print("|cffd4a017Chronicler|r live link on: what happens goes to Logs\\WoWChatLog.txt for the stream overlay.")
	elseif arg == "off" then
		settings().live = false
		queue = {}
		print("|cffd4a017Chronicler|r live link off.")
	elseif arg == "test" then
		-- A line the app and the overlay both show, to prove the whole chain.
		if not enabled() then print("|cffd4a017Chronicler|r live link is off: /chron live on first.") return end
		push("T", time())
		lastSend = -MIN_GAP
		flush()
		lastSend = -FLUSH_AFTER
		flushLog()
		print(string.format("|cffd4a017Chronicler|r test line whispered to %s. Within a few seconds: the Live overlay page on this PC shows \"test line received\", and the overlay shows LIVE LINK OK.", whisperTarget() or "you"))
	else
		local logging = LoggingChat and LoggingChat() or false
		print(string.format("|cffd4a017Chronicler|r live link %s · chat log %s · whispers to %s · %d messages sent, %d lines waiting. /chron live on|off|test",
			enabled() and "on" or "off", logging and "on (Logs\\WoWChatLog.txt)" or "OFF", whisperTarget() or "?", sent, #queue))
	end
end
ns.helpLines[#ns.helpLines + 1] = "/chron live on|off|test - live link for the stream overlay (whispers to yourself, hidden from chat; on by default); test sends a line the app confirms"
