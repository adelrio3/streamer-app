-- Live link. WoW only writes the addon's log to disk at logout or /reload,
-- so nothing here reaches the web app while you play. The one file the game
-- does write as it happens is the chat log (Logs\WoWChatLog.txt). This
-- module writes what happens (loot, quest progress, kills, deaths, levels)
-- into it, in a compact form, as local system messages: SendSystemMessage
-- shows a line in chat without the server being involved, and the chat log
-- records it like any other line. The lines are filtered out of every chat
-- window, so nothing shows on stream.
--
-- The game keeps the chat log in a buffer of about 64 KB and writes it to
-- disk only when the buffer fills (or at logout; turning logging off does
-- not close the file). Whispers and channels don't help either: channels
-- are blocked for addons without a key press, and whispers sit in the same
-- buffer. So after each message the addon pushes a little over 64 KB of
-- hidden filler lines through, spread over a few ticks, and the file grows
-- within a couple of seconds.

local ADDON_NAME, ns = ...

local PREFIX = "CHRON1"
local SEP, EVSEP = "~", "~~"
local MAX = 240 -- one message
local MIN_GAP = 0.6 -- seconds between messages
local HEARTBEAT = 60

local PAD_PREFIX = "CHRONPAD"
local PAD_LINE = PAD_PREFIX .. SEP .. string.rep("=", 990) -- about 1 KB each in the file
local PAD_DEFAULT_KB = 80 -- a little over the game's buffer
local PAD_PER_TICK = 20 -- lines per half second; 80 KB takes about 2 seconds
local FLUSH_AFTER = 1.0 -- seconds of quiet after the last message before the filler goes

local queue = {}
local sent = 0
local lastSend = 0
local lastBeat = 0
local padLeft = 0 -- filler lines still to send
local padded = 0 -- filler lines sent, for the status line

local function settings()
	ChroniclerDB = ChroniclerDB or {}
	ChroniclerDB.settings = ChroniclerDB.settings or {}
	return ChroniclerDB.settings
end

local function enabled()
	return settings().live ~= false
end

local function padKB()
	local kb = tonumber(settings().livePadKB)
	if kb == nil then return PAD_DEFAULT_KB end
	return math.max(0, kb)
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

-- Is this chat line one of ours? Used to hide it and to keep it out of the
-- social log.
local function isLiveLine(text)
	return type(text) == "string" and (text:find(PREFIX .. SEP, 1, true) == 1 or text:find(PAD_PREFIX .. SEP, 1, true) == 1)
end
ns.isLiveLine = isLiveLine

-- Hides the addon's lines from every chat window. The chat log on disk
-- still gets them.
local function filter(_, event, text)
	if type(text) ~= "string" then return false end
	if text:find(PAD_PREFIX .. SEP, 1, true) == 1 then return true end
	if settings().liveShow then return false end -- /chron live show, for checking
	return text:find(PREFIX .. SEP, 1, true) == 1
end

local function emit(text)
	if SendSystemMessage then SendSystemMessage(text) end
end

local function flush()
	if #queue == 0 or not enabled() then return end
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
	emit(PREFIX .. SEP .. msg)
	sent = sent + 1
	lastSend = now
	padLeft = math.max(padLeft, padKB()) -- the filler follows once things go quiet
end

local function padTick()
	if padLeft <= 0 then return end
	if GetTime() - lastSend < FLUSH_AFTER then return end
	local n = math.min(padLeft, PAD_PER_TICK)
	for _ = 1, n do emit(PAD_LINE) end
	padLeft = padLeft - n
	padded = padded + n
end

-- Race and class tokens (Orc, NightElf, Scourge...; WARRIOR...): the overlay
-- picks its colours by race.
local function who()
	local _, race = UnitRace("player")
	local _, class = UnitClass("player")
	return race or "-", class or "-"
end

local function heartbeat()
	local zone, sub, _, x, y = ns.where()
	local race, class = who()
	push("H", UnitLevel("player"), UnitXP and UnitXP("player") or 0, UnitXPMax and UnitXPMax("player") or 0, zone, sub,
		x and ns.round(x * 100) or "-", y and ns.round(y * 100) or "-", GetMoney and GetMoney() or 0, race, class)
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
	padTick()
	if GetTime() - lastBeat > HEARTBEAT then heartbeat() end
end

ns.on("PLAYER_LOGIN", function()
	if not enabled() then return end
	if LoggingChat then LoggingChat(true) end
	if ChatFrame_AddMessageEventFilter then ChatFrame_AddMessageEventFilter("CHAT_MSG_SYSTEM", filter) end
	local name, realm = UnitName("player"), GetRealmName and GetRealmName() or ""
	local race, class = who()
	push("B", (C_AddOns and C_AddOns.GetAddOnMetadata and C_AddOns.GetAddOnMetadata(ADDON_NAME, "Version")) or (GetAddOnMetadata and GetAddOnMetadata(ADDON_NAME, "Version")) or "?", name, realm, UnitLevel("player"), race, class)
	if C_Timer and C_Timer.NewTicker then C_Timer.NewTicker(0.5, tick) end
end)

-- Whatever is still waiting goes out before the game closes (the game
-- writes the whole buffer at logout, so no filler is needed).
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
		padLeft = 0
		print("|cffd4a017Chronicler|r live link off.")
	elseif arg == "show" or arg == "hide" then
		settings().liveShow = arg == "show" or nil
		print("|cffd4a017Chronicler|r live link lines are now " .. (arg == "show" and "shown in chat (for checking)" or "hidden from chat") .. ".")
	elseif arg:match("^pad") then
		-- /chron live pad 80: push 80 KB of filler after each message (the
		-- game writes its chat log buffer of about 64 KB only when it fills).
		local kb = tonumber(arg:match("%d+"))
		if not kb then
			print(string.format("|cffd4a017Chronicler|r filler after each message: %d KB (the game's buffer is about 64 KB; 0 turns it off, %d is the default). /chron live pad <KB>", padKB(), PAD_DEFAULT_KB))
			return
		end
		settings().livePadKB = kb ~= PAD_DEFAULT_KB and kb or nil
		padLeft = math.max(padLeft, kb)
		lastSend = -FLUSH_AFTER
		print(string.format("|cffd4a017Chronicler|r filler set to %d KB after each message; %d KB going out now. Watch the size of Logs\\WoWChatLog.txt.", kb, kb))
	elseif arg == "test" then
		-- A line the app and the overlay both show, to prove the whole chain.
		if not enabled() then print("|cffd4a017Chronicler|r live link is off: /chron live on first.") return end
		push("T", time())
		lastSend = -MIN_GAP
		flush()
		print("|cffd4a017Chronicler|r test line written. Within a few seconds: the Live overlay page on this PC shows \"test line received\", and the overlay shows LIVE LINK OK.")
	else
		local logging = LoggingChat and LoggingChat() or false
		local version = (C_AddOns and C_AddOns.GetAddOnMetadata and C_AddOns.GetAddOnMetadata(ADDON_NAME, "Version")) or (GetAddOnMetadata and GetAddOnMetadata(ADDON_NAME, "Version")) or "?"
		print(string.format("|cffd4a017Chronicler|r %s · live link %s · chat log %s · lines %s · %d messages sent, %d waiting · filler %d KB after each (%d KB sent so far). /chron live on|off|test|show|hide|pad KB",
			version, enabled() and "on" or "off", logging and "on (Logs\\WoWChatLog.txt)" or "OFF", settings().liveShow and "shown" or "hidden", sent, #queue, padKB(), padded))
	end
end
ns.helpLines[#ns.helpLines + 1] = "/chron live on|off|test|show|hide|pad KB - live link for the stream overlay (writes to the chat log, hidden from chat; on by default); test writes a line the app confirms"
