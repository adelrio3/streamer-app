-- Live link. WoW only writes the addon's log to disk at logout or /reload,
-- so nothing here reaches the web app while you play. The one file the game
-- does write as it happens is the chat log (Logs\WoWChatLog.txt). This
-- module joins a hidden chat channel of your own and posts what happens
-- (loot, quest progress, kills, deaths, levels) into it, in a compact form,
-- so the chat log carries it out of the game for the stream overlay. The
-- channel is filtered out of every chat window, so nothing shows on stream.

local ADDON_NAME, ns = ...

local PREFIX = "CHRON1"
local SEP, EVSEP = "~", "~~"
local MAX = 240 -- a chat message holds 255 bytes
local MIN_GAP = 0.6 -- seconds between messages (the server throttles chat)
local HEARTBEAT = 60

local queue = {}
local channel = { name = nil, password = nil, index = 0 }
local lastSend = 0
local lastBeat = 0
local frames = {}

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

-- The channel is named after the character, so two characters never share one.
local function channelName()
	local guid = ns.playerGUID and ns.playerGUID() or (UnitGUID and UnitGUID("player")) or "0"
	local hex = tostring(guid):match("(%x+)$") or "0"
	hex = hex:sub(-8):lower()
	return "chron" .. hex, "k" .. hex:reverse()
end

local function channelIndex()
	if not channel.name or not GetChannelName then return nil end
	local id = GetChannelName(channel.name)
	if id and id > 0 then channel.index = id return id end
	return nil
end

local function join()
	if not enabled() then return end
	if not channel.name then channel.name, channel.password = channelName() end
	if channelIndex() then return end
	if JoinTemporaryChannel then JoinTemporaryChannel(channel.name, channel.password) end
end

-- Hides the channel (its messages and its join/leave notices) from every
-- chat window. The chat log on disk still gets everything.
local function filter(_, event, ...)
	if not channel.name then return false end
	for i = 1, select("#", ...) do
		local v = select(i, ...)
		if type(v) == "string" then
			local lower = v:lower()
			if lower:find(channel.name, 1, true) or v:find(PREFIX .. SEP, 1, true) == 1 then return true end
		end
	end
	return false
end

local function flush()
	if #queue == 0 or not enabled() then return end
	if channel.index == 0 and not channelIndex() then join() return end
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
	if SendChatMessage then SendChatMessage(PREFIX .. SEP .. msg, "CHANNEL", nil, channel.index) end
	lastSend = now
end

local function heartbeat()
	local zone, sub, _, x, y = ns.where()
	push("H", UnitLevel("player"), UnitXP and UnitXP("player") or 0, UnitXPMax and UnitXPMax("player") or 0, zone, sub,
		x and ns.round(x * 100) or "-", y and ns.round(y * 100) or "-", GetMoney and GetMoney() or 0)
	lastBeat = GetTime()
end

-- Everything the addon records passes through here (see record() in
-- Chronicler.lua); the kinds the overlay cares about go out.
local last = { loot = nil }
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
	if GetTime() - lastBeat > HEARTBEAT then heartbeat() end
end

ns.on("PLAYER_LOGIN", function()
	if not enabled() then return end
	if LoggingChat then LoggingChat(true) end
	if ChatFrame_AddMessageEventFilter then
		for _, ev in ipairs({ "CHAT_MSG_CHANNEL", "CHAT_MSG_CHANNEL_NOTICE", "CHAT_MSG_CHANNEL_NOTICE_USER", "CHAT_MSG_CHANNEL_JOIN", "CHAT_MSG_CHANNEL_LEAVE", "CHAT_MSG_CHANNEL_LIST" }) do
			ChatFrame_AddMessageEventFilter(ev, filter)
		end
	end
	local name, realm = UnitName("player"), GetRealmName and GetRealmName() or ""
	push("B", (C_AddOns and C_AddOns.GetAddOnMetadata and C_AddOns.GetAddOnMetadata(ADDON_NAME, "Version")) or (GetAddOnMetadata and GetAddOnMetadata(ADDON_NAME, "Version")) or "?", name, realm, UnitLevel("player"))
	if C_Timer and C_Timer.After then C_Timer.After(2, join) else join() end
	if C_Timer and C_Timer.NewTicker then C_Timer.NewTicker(0.5, tick) end
end)

ns.on("PLAYER_ENTERING_WORLD", function()
	if enabled() and C_Timer and C_Timer.After then C_Timer.After(5, join) end
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
		join()
		print("|cffd4a017Chronicler|r live link on: what happens goes to Logs\\WoWChatLog.txt for the stream overlay.")
	elseif arg == "off" then
		settings().live = false
		queue = {}
		print("|cffd4a017Chronicler|r live link off.")
	else
		print(string.format("|cffd4a017Chronicler|r live link %s, channel %s, %d lines waiting. /chron live on|off",
			enabled() and "on" or "off", channel.index > 0 and (channel.name or "?") or "not joined yet", #queue))
	end
end
ns.helpLines[#ns.helpLines + 1] = "/chron live on|off - live link for the stream overlay (posts to a hidden chat channel of your own; on by default)"
