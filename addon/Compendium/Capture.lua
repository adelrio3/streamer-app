-- Compendium capture: everything beyond the core log.
--
--   NPCs        every creature you target, mouse over, see on a nameplate, fight
--               near or hear speak, with level, rank, type, family and reaction
--   Loot        every loot window: what dropped, from whom, including what you left
--   Items       a full catalog entry per item: all tooltip lines (flavor text too),
--               stats, sell price, icon, use effect
--   Vendors     stock, prices, limited quantities and non-gold costs
--   Trainers    what they teach and for how much
--   Flights     flight masters, known routes and costs, flights taken, hearthstone
--   Track       position and state every 2 s (mounted, UI hidden, indoors, combat,
--               time of day...) for finding footage
--   Fights      a summary per fight, close calls, who killed you
--   Character   gear, talents, stats, reputation, gold, XP, skills and bags over time
--   Screenshots automatic ones at big moments, and your own
--   Social      group, duels and chat (off unless /comp social on)

local ADDON_NAME, ns = ...
local record, now, parseGUID, on = ns.record, ns.now, ns.parseGUID, ns.on

local function settings() return CompendiumDB.settings end
local function session() return ns.session() end
local function idFromLink(link) return link and tonumber(link:match("|Hitem:(%d+)")) end
local function nameFromLink(link) return link and link:match("%[(.-)%]") end

local DEFAULTS = { screenshots = true, social = false, track = true, scanner = false }

on("ADDON_LOADED", function(name)
	if name ~= ADDON_NAME then return end
	for k, v in pairs(DEFAULTS) do
		if settings()[k] == nil then settings()[k] = v end
	end
end)

-- What window is open, so money changes can say where they came from.
local context = {}
local function contextName()
	for _, k in ipairs({ "merchant", "trainer", "taxi", "mail", "auction", "trade", "loot", "quest", "bank" }) do
		if context[k] then return k end
	end
end
for event, key in pairs({
	MERCHANT_SHOW = "merchant", TRAINER_SHOW = "trainer", TAXIMAP_OPENED = "taxi", MAIL_SHOW = "mail",
	AUCTION_HOUSE_SHOW = "auction", TRADE_SHOW = "trade", LOOT_OPENED = "loot", QUEST_COMPLETE = "quest", BANKFRAME_OPENED = "bank",
}) do
	on(event, function() context[key] = GetTime() end)
end
for event, key in pairs({
	MERCHANT_CLOSED = "merchant", TRAINER_CLOSED = "trainer", TAXIMAP_CLOSED = "taxi", MAIL_CLOSED = "mail",
	AUCTION_HOUSE_CLOSED = "auction", TRADE_CLOSED = "trade", LOOT_CLOSED = "loot", QUEST_FINISHED = "quest", BANKFRAME_CLOSED = "bank",
}) do
	-- Leave a moment for the money update that follows closing a window.
	on(event, function()
		if C_Timer and C_Timer.After then C_Timer.After(1, function() context[key] = nil end) else context[key] = nil end
	end)
end

-- Tooltip scanning ----------------------------------------------------------

local scanTip = CreateFrame("GameTooltip", "CompendiumScanTip", nil, "GameTooltipTemplate")

local function hex(r, g, b)
	if not r then return nil end
	return string.format("%02x%02x%02x", math.floor(r * 255 + 0.5), math.floor(g * 255 + 0.5), math.floor(b * 255 + 0.5))
end

-- Every line of a tooltip as "left", or "left\tright", with "|color" after
-- when the left text is not white.
local function tooltipLines(setter)
	scanTip:SetOwner(WorldFrame, "ANCHOR_NONE")
	scanTip:ClearLines()
	setter(scanTip)
	local lines = {}
	for i = 1, scanTip:NumLines() do
		local left = _G["CompendiumScanTipTextLeft" .. i]
		local right = _G["CompendiumScanTipTextRight" .. i]
		local lt = left and left:GetText()
		local rt = right and right:IsShown() and right:GetText()
		if (lt and lt ~= "") or (rt and rt ~= "") then
			local line = lt or ""
			if rt and rt ~= "" then line = line .. "\t" .. rt end
			local color = left and hex(left:GetTextColor())
			if color and color ~= "ffffff" then line = line .. "|" .. color end
			lines[#lines + 1] = line
		end
	end
	scanTip:Hide()
	return lines
end

-- Item catalog --------------------------------------------------------------
--
-- CompendiumDB.items[id] holds everything the client knows about an item.
-- Items not yet in the client cache are asked for and scanned when they arrive.

local pending, queued, tries = {}, {}, {}

local function wantItem(id)
	id = tonumber(id)
	if not id or id <= 0 or queued[id] then return end
	local known = CompendiumDB.items[id]
	if known and known.scanned then return end
	queued[id] = true
	pending[#pending + 1] = id
end
ns.wantItem = wantItem

local function scanItem(id)
	local name, link, quality, ilvl, reqLevel, itemType, subType, maxStack, equipLoc, icon, sellPrice, classID, subclassID, bindType, _, setID, isReagent = GetItemInfo(id)
	if not name then return false end
	local info = CompendiumDB.items[id] or {}
	info.id, info.name, info.link, info.q, info.ilvl, info.req = id, name, link, quality, ilvl, reqLevel
	info.type, info.sub, info.stack, info.icon, info.sell = itemType, subType, maxStack, icon, sellPrice
	info.classId, info.subId, info.bind, info.set = classID, subclassID, bindType, setID
	if equipLoc and equipLoc ~= "" then info.slot = equipLoc end
	if isReagent then info.reagent = true end
	info.tip = tooltipLines(function(tip) tip:SetHyperlink("item:" .. id) end)
	local stats = (C_Item and C_Item.GetItemStats and C_Item.GetItemStats(link)) or (GetItemStats and GetItemStats(link))
	if stats and next(stats) then info.stats = stats end
	if GetItemSpell then
		local spellName, spellId = GetItemSpell(id)
		if spellName then info.spell, info.spellId = spellName, spellId end
	end
	info.first = info.first or time()
	info.scanned = true
	CompendiumDB.items[id] = info
	return true
end

local function processItems()
	local budget = 5
	local i = 1
	while i <= #pending and budget > 0 do
		local id = pending[i]
		budget = budget - 1
		if scanItem(id) then
			table.remove(pending, i)
			queued[id] = nil
		else
			-- Not cached yet: GetItemInfo asked the server; try again later.
			tries[id] = (tries[id] or 0) + 1
			if tries[id] > 20 then table.remove(pending, i); queued[id] = nil else i = i + 1 end
		end
	end
end

on("GET_ITEM_INFO_RECEIVED", function(id)
	if queued[id] then processItems() end
end)

-- Items you hover anywhere (bags, chat links, vendor, quest rewards...).
local function hookTooltip(tip)
	if tip and tip.HookScript and tip:HasScript("OnTooltipSetItem") then
		tip:HookScript("OnTooltipSetItem", function(self)
			local _, link = self:GetItem()
			wantItem(idFromLink(link))
		end)
	end
end

-- Remembers the last tooltip of a world object (a chest, a herb, a cactus),
-- to name what you loot from it. Tooltips of units, items and spells are
-- not objects and must not name one.
local lastTip = { title = nil, at = 0, object = false }
-- Opening a chest, herb, ore or a cactus is a cast at the object by name:
-- "Opening", "Herb Gathering", "Mining", "Pick Lock" and their kin.
local OPENING = {
	[3365] = true, [6478] = true, [6477] = true, [6247] = true, [22810] = true, [21651] = true, [6289] = true, [1804] = true,
	[2366] = true, [2368] = true, [3570] = true, [11993] = true, [28695] = true, [50300] = true,
	[2575] = true, [2576] = true, [3564] = true, [10248] = true, [29354] = true, [50310] = true,
	[7620] = true, [7731] = true, [7732] = true, [18248] = true, [33095] = true, [51294] = true,
}
local OPENING_NAMES = { Opening = true, ["Herb Gathering"] = true, Mining = true, ["Pick Lock"] = true, Fishing = true, Skinning = true }
local lastCast = { target = nil, at = 0 }
on("UNIT_SPELLCAST_SENT", function(unit, target, _, spellID)
	if unit ~= "player" or type(target) ~= "string" or target == "" then return end
	local opening = OPENING[spellID]
	if not opening then
		local name = GetSpellInfo and GetSpellInfo(spellID)
		if not name and C_Spell and C_Spell.GetSpellName then name = C_Spell.GetSpellName(spellID) end
		opening = name and OPENING_NAMES[name]
	end
	if not opening then return end
	lastCast.target = target
	lastCast.at = GetTime()
end)

-- Names of objects learned so far (id -> name), so an object named once is
-- named in every later session too.
local function objectName(id, name)
	CompendiumDB.objects = CompendiumDB.objects or {}
	if name and name ~= "" then
		if CompendiumDB.objects[id] ~= name then
			CompendiumDB.objects[id] = name
			record("object", { objId = id, name = name })
		end
		return name
	end
	return CompendiumDB.objects[id]
end
local function hookTitle(tip)
	if tip and tip.HookScript then
		tip:HookScript("OnShow", function()
			local line = _G[(tip:GetName() or "") .. "TextLeft1"]
			local unit = tip.GetUnit and select(2, tip:GetUnit())
			local item = tip.GetItem and select(2, tip:GetItem())
			local spell = tip.GetSpell and tip:GetSpell()
			lastTip.title = line and line:GetText()
			lastTip.object = not (unit or item or spell)
			lastTip.at = GetTime()
		end)
	end
end

-- NPCs ----------------------------------------------------------------------

local seen = {}   -- unit GUID -> its "npc" event, one per spawn per session
-- The rank (elite, rare, rareelite, worldboss) of a unit seen this session, for the live link.
ns.rankOf = function(guid) local ev = guid and seen[guid]; return ev and ev.rank or nil end
local rares = {}  -- npc IDs already announced this session

local RANK = { elite = true, rare = true, rareelite = true, worldboss = true }

local function screenshot(reason)
	if not settings().screenshots or not Screenshot then return end
	ns.pendingShot = reason
	-- C_Timer.After only takes a Lua function, not the game's own Screenshot.
	if C_Timer and C_Timer.After then C_Timer.After(0.3, function() Screenshot() end) else Screenshot() end
end

local REACTION_FLAGS = { [0x10] = 5, [0x20] = 4, [0x40] = 2 } -- friendly, neutral, hostile

local notCreature = {} -- players, pets, objects: skip quickly

local function noteGUID(guid, name, source, flags)
	if not guid or guid == "" or notCreature[guid] or not session() then return end
	local ev = seen[guid]
	if ev then
		if name and not ev.name then ev.name = name end
		return ev
	end
	local kind, id = parseGUID(guid)
	if not ns.isCreature(kind) then notCreature[guid] = true return end
	ev = record("npc", { name = name, npcId = id, npcKind = kind, src = source })
	seen[guid] = ev
	if flags and bit and bit.band then
		for mask, react in pairs(REACTION_FLAGS) do
			if bit.band(flags, mask) ~= 0 then ev.react = react end
		end
	end
	return ev
end

local function noteUnit(unit, source)
	local guid = UnitGUID(unit)
	if not guid then return end
	local ev = noteGUID(guid, UnitName(unit), source)
	if not ev or ev.full then return ev end
	ev.full = true
	ev.level = UnitLevel(unit)
	local rank = UnitClassification(unit)
	if rank and rank ~= "normal" then ev.rank = rank end
	if ev.rank and ev.rank:find("rare") and ns.liveEvent then ns.liveEvent("rare", ev) end
	ev.ctype = UnitCreatureType(unit)
	ev.family = UnitCreatureFamily(unit)
	ev.react = UnitReaction(unit, "player") or ev.react
	ev.hp = UnitHealthMax(unit)
	if UnitPowerMax then
		local mana = UnitPowerMax(unit, 0)
		if mana and mana > 0 then ev.mana = mana end
	end
	local faction = UnitFactionGroup(unit)
	if faction then ev.faction = faction end
	if UnitIsTapDenied and UnitIsTapDenied(unit) then ev.tapped = true end
	-- The tooltip carries the subtitle ("<Innkeeper>") and any extra lines.
	local lines = tooltipLines(function(tip) tip:SetUnit(unit) end)
	if #lines > 1 then ev.tip = lines end
	for _, line in ipairs(lines) do
		local title = line:match("^<(.+)>")
		if title then ev.title = title break end
	end
	if (rank == "rare" or rank == "rareelite" or rank == "worldboss") and ev.npcId and not rares[ev.npcId] then
		rares[ev.npcId] = true
		ev.rare = true
		screenshot("rare")
	end
	return ev
end
ns.noteUnit = noteUnit

on("NAME_PLATE_UNIT_ADDED", function(unit) noteUnit(unit, "nameplate") end)
for _, event in ipairs({ "CHAT_MSG_MONSTER_SAY", "CHAT_MSG_MONSTER_YELL", "CHAT_MSG_MONSTER_EMOTE", "CHAT_MSG_MONSTER_WHISPER", "CHAT_MSG_MONSTER_PARTY", "CHAT_MSG_RAID_BOSS_EMOTE" }) do
	on(event, function(_, speaker, ...) noteGUID(select(10, ...), speaker, "speech") end)
end
on("UPDATE_MOUSEOVER_UNIT", function() noteUnit("mouseover", "mouseover") end)
on("PLAYER_TARGET_CHANGED", function() noteUnit("target", "target") end)
for _, event in ipairs({ "GOSSIP_SHOW", "QUEST_DETAIL", "QUEST_GREETING", "MERCHANT_SHOW", "TRAINER_SHOW", "TAXIMAP_OPENED", "BANKFRAME_OPENED" }) do
	on(event, function() noteUnit("npc", "talk") end)
end

-- Invisible nameplates: with the scanner on, every NPC within nameplate range
-- is logged without drawing anything on screen.
local SCANNER_CVARS = { nameplateShowEnemies = "1", nameplateShowFriends = "1", nameplateMinAlpha = "0", nameplateMaxAlpha = "0", nameplateSelectedAlpha = "0", nameplateMaxDistance = "41" }
local function applyScanner(enable)
	if not (GetCVar and SetCVar) then return end
	local s = settings()
	if enable then
		s.scannerSaved = s.scannerSaved or {}
		for cvar, value in pairs(SCANNER_CVARS) do
			if s.scannerSaved[cvar] == nil then s.scannerSaved[cvar] = GetCVar(cvar) end
			pcall(SetCVar, cvar, value)
		end
	elseif s.scannerSaved then
		for cvar, value in pairs(s.scannerSaved) do pcall(SetCVar, cvar, value) end
		s.scannerSaved = nil
	end
end

-- Loot windows --------------------------------------------------------------

local looted = {} -- source GUIDs already recorded this session

local lastLootSources
on("LOOT_OPENED", function()
	if not session() then return end
	local items, sources, money = {}, {}, nil
	for i = 1, (GetNumLootItems and GetNumLootItems() or 0) do
		local slotType = GetLootSlotType and GetLootSlotType(i)
		local _, name, quantity = GetLootSlotInfo(i)
		local link = GetLootSlotLink(i)
		if slotType == 2 or (not link and name and name:find("%d")) then
			money = name
		elseif link then
			local id = idFromLink(link)
			items[#items + 1] = { id = id, name = nameFromLink(link), n = quantity }
			wantItem(id)
		end
		if GetLootSourceInfo then
			local info = { GetLootSourceInfo(i) }
			for j = 1, #info, 2 do
				if info[j] then sources[info[j]] = true end
			end
		end
	end
	if not next(sources) then
		local target = UnitGUID("target")
		if target and UnitIsDead and UnitIsDead("target") then sources[target] = true end
	end
	for guid in pairs(sources) do
		if looted[guid] then return end -- same corpse opened again
	end
	local src = {}
	for guid in pairs(sources) do
		looted[guid] = true
		local kind, id = parseGUID(guid)
		local npc = seen[guid]
		local name = npc and npc.name
		if not name and kind == "GameObject" then
			local now = GetTime()
			if now - lastCast.at < 12 then name = lastCast.target end
			if not name and lastTip.object and now - lastTip.at < 8 then name = lastTip.title end
			name = objectName(id, name)
		end
		src[#src + 1] = { kind = kind, id = id, name = name, level = npc and npc.level, rank = npc and npc.rank }
	end
	if #items == 0 and not money then return end
	lastLootSources = { at = GetTime(), list = src }
	record("loot_window", { items = items, money = money, sources = src, fishing = IsFishingLoot and IsFishingLoot() or nil })
end)

-- Who the loot that follows came from (for the live link).
ns.lastLoot = function()
	if lastLootSources and GetTime() - lastLootSources.at < 15 then return lastLootSources.list[1] end
end

-- Vendors, trainers, flight masters ------------------------------------------

local function npcFields(data)
	local kind, id = parseGUID(UnitGUID("npc"))
	data.npc, data.npcId, data.npcKind = UnitName("npc"), id, kind
	return data
end

local function merchantItem(i)
	local name, icon, price, quantity, available, purchasable, usable, extendedCost
	if GetMerchantItemInfo then
		name, icon, price, quantity, available, purchasable, usable, extendedCost = GetMerchantItemInfo(i)
	elseif C_MerchantFrame and C_MerchantFrame.GetItemInfo then
		local info = C_MerchantFrame.GetItemInfo(i)
		if info then
			name, icon, price, quantity, available, purchasable, usable, extendedCost = info.name, info.texture, info.price, info.stackCount, info.numAvailable, info.isPurchasable, info.isUsable, info.hasExtendedCost
		end
	end
	if not name then return nil end
	local link = GetMerchantItemLink(i)
	local item = { id = idFromLink(link), name = name, price = price, per = quantity, icon = icon }
	if available and available >= 0 then item.stock = available end
	if usable == false then item.unusable = true end
	if extendedCost and GetMerchantItemCostInfo then
		item.costs = {}
		for j = 1, (GetMerchantItemCostInfo(i) or 0) do
			local _, value, costLink, currencyName = GetMerchantItemCostItem(i, j)
			item.costs[#item.costs + 1] = { value = value, id = idFromLink(costLink), name = nameFromLink(costLink) or currencyName }
			wantItem(idFromLink(costLink))
		end
	end
	wantItem(item.id)
	return item
end

local vendorVisit
local function snapshotMerchant()
	if not vendorVisit then return end
	local items = {}
	for i = 1, (GetMerchantNumItems and GetMerchantNumItems() or 0) do
		local item = merchantItem(i)
		if item then items[#items + 1] = item end
	end
	vendorVisit.items = items
end

on("MERCHANT_SHOW", function()
	vendorVisit = record("vendor", npcFields({ repair = CanMerchantRepair and CanMerchantRepair() or nil }))
	snapshotMerchant()
end)
-- Stock details can arrive a moment after the window opens.
on("MERCHANT_UPDATE", snapshotMerchant)
on("MERCHANT_CLOSED", function() vendorVisit = nil end)
-- What an item you "receive" really is: bought while a shop is open, mail at a mailbox.
ns.lootContext = function()
	if vendorVisit then return "bought" end
	if context.mail then return "mail" end
	return nil
end

on("TRAINER_SHOW", function()
	local services = {}
	for i = 1, (GetNumTrainerServices and GetNumTrainerServices() or 0) do
		local name, rank, category = GetTrainerServiceInfo(i)
		if name and category ~= "header" then
			services[#services + 1] = {
				name = name, rank = rank ~= "" and rank or nil, status = category,
				cost = GetTrainerServiceCost and GetTrainerServiceCost(i) or nil,
				level = GetTrainerServiceLevelReq and GetTrainerServiceLevelReq(i) or nil,
			}
		end
	end
	record("trainer", npcFields({ services = services, greeting = GetTrainerGreetingText and GetTrainerGreetingText() or nil }))
end)

on("TAXIMAP_OPENED", function()
	local nodes = {}
	for i = 1, (NumTaxiNodes and NumTaxiNodes() or 0) do
		local x, y = TaxiNodePosition(i)
		nodes[#nodes + 1] = { name = TaxiNodeName(i), type = TaxiNodeGetType(i), cost = TaxiNodeCost(i), x = x and ns.round(x * 100), y = y and ns.round(y * 100) }
	end
	record("taxi_map", npcFields({ nodes = nodes }))
end)

if hooksecurefunc and TakeTaxiNode then
	hooksecurefunc("TakeTaxiNode", function(i)
		record("flight", { to = TaxiNodeName(i), cost = TaxiNodeCost(i) })
	end)
end

local function bound()
	record("bind", { where = GetBindLocation and GetBindLocation() or nil })
end
on("HEARTHSTONE_BOUND", bound)
on("PLAYER_BIND", bound)

-- Track: position and state every 2 seconds ----------------------------------
--
-- Stored as compact strings in session.track:
--   "t,mapID,x,y,facing,speed,flags,gameMinutes,fps,latency"
-- flags: 1 mounted, 2 flight path, 4 swimming, 8 indoors, 16 resting,
-- 32 in combat, 64 dead or ghost, 128 UI hidden, 256 stealthed, 512 falling,
-- 1024 AFK.

local FLAG_TESTS = {
	{ 1, function() return IsMounted and IsMounted() end },
	{ 2, function() return UnitOnTaxi and UnitOnTaxi("player") end },
	{ 4, function() return IsSwimming and IsSwimming() end },
	{ 8, function() return IsIndoors and IsIndoors() end },
	{ 16, function() return IsResting and IsResting() end },
	{ 32, function() return UnitAffectingCombat and UnitAffectingCombat("player") end },
	{ 64, function() return UnitIsDeadOrGhost and UnitIsDeadOrGhost("player") end },
	{ 128, function() return UIParent and not UIParent:IsShown() end },
	{ 256, function() return IsStealthed and IsStealthed() end },
	{ 512, function() return IsFalling and IsFalling() end },
	{ 1024, function() return UnitIsAFK and UnitIsAFK("player") end },
}

local function stateFlags()
	local f = 0
	for _, test in ipairs(FLAG_TESTS) do
		if test[2]() then f = f + test[1] end
	end
	return f
end
ns.stateFlags = stateFlags

local lastPoint, lastPointAt, lastFlags = nil, 0, 0

local function trackTick()
	local s = session()
	if not s or not settings().track then return end
	local _, _, mapID, x, y = ns.where()
	local facing = GetPlayerFacing and GetPlayerFacing() or 0
	local speed = GetUnitSpeed and GetUnitSpeed("player") or 0
	local flags = stateFlags()
	local h, m = 0, 0
	if GetGameTime then h, m = GetGameTime() end
	local fps = GetFramerate and GetFramerate() or 0
	local latency = 0
	if GetNetStats then latency = select(3, GetNetStats()) or 0 end
	local body = string.format("%s,%.2f,%.2f,%.2f,%.1f,%d,%d", mapID or "", (x or 0) * 100, (y or 0) * 100, facing or 0, speed or 0, flags, h * 60 + m)
	local t = now()
	-- Standing still: one point every 30 s is enough.
	if body ~= lastPoint or t - lastPointAt >= 30 then
		s.track = s.track or {}
		s.track[#s.track + 1] = string.format("%.2f,%s,%d,%d", t, body, math.floor(fps + 0.5), latency)
		lastPoint, lastPointAt = body, t
	end
	-- Landing after a flight path.
	if bit and bit.band(lastFlags, 2) ~= 0 and bit.band(flags, 2) == 0 then record("flight_end") end
	lastFlags = flags
	processItems()
end

-- Fights --------------------------------------------------------------------

local fight
local lastHit -- { name, npcId, spell, at }

local function healthPct()
	local max = UnitHealthMax("player")
	if not max or max == 0 then return 100 end
	return math.floor(UnitHealth("player") / max * 100 + 0.5)
end

on("PLAYER_REGEN_DISABLED", function()
	fight = { start = now(), done = 0, taken = 0, healed = 0, spells = {}, enemies = {}, minHp = healthPct(), kills = 0 }
end)

local function onHealth(unit)
	if unit == "player" and fight then
		local pct = healthPct()
		if pct < fight.minHp then fight.minHp = pct end
	end
end
on("UNIT_HEALTH", onHealth)
on("UNIT_HEALTH_FREQUENT", onHealth)

on("PLAYER_REGEN_ENABLED", function()
	local f = fight
	fight = nil
	if not f or not session() then return end
	local spells = {}
	for name, count in pairs(f.spells) do spells[#spells + 1] = { name = name, n = count } end
	table.sort(spells, function(a, b) return a.n > b.n end)
	while #spells > 10 do table.remove(spells) end
	local enemies = {}
	for guid, name in pairs(f.enemies) do
		local npc = seen[guid]
		local _, id = parseGUID(guid)
		enemies[#enemies + 1] = { name = name, npcId = id, level = npc and npc.level, rank = npc and npc.rank }
	end
	record("fight", {
		dur = ns.round(now() - f.start, 1), done = f.done, taken = f.taken, healed = f.healed > 0 and f.healed or nil,
		spells = spells, enemies = enemies, minHp = f.minHp, close = f.minHp <= 15 or nil, kills = f.kills > 0 and f.kills or nil,
	})
end)

ns.deathInfo = function()
	screenshot("death")
	if lastHit and GetTime() - lastHit.at < 15 then
		return { killer = lastHit.name, killerId = lastHit.npcId, by = lastHit.spell }
	end
end

on("COMBAT_LOG_EVENT_UNFILTERED", function()
	local _, sub, _, srcGUID, srcName, srcFlags, _, dstGUID, dstName, dstFlags, _, a12, a13, _, a15 = CombatLogGetCurrentEventInfo()
	local me = ns.playerGUID()
	-- Everything fighting near you is someone you saw.
	if srcGUID ~= me then noteGUID(srcGUID, srcName, "combat", srcFlags) end
	if dstGUID ~= me then noteGUID(dstGUID, dstName, "combat", dstFlags) end
	local mine = srcGUID == me or (srcGUID and srcGUID == UnitGUID("pet"))
	local amount, spell
	if sub == "SWING_DAMAGE" then
		amount, spell = a12, "Melee"
	elseif sub == "ENVIRONMENTAL_DAMAGE" then
		amount, spell = a13, a12
	elseif sub:sub(-7) == "_DAMAGE" then
		amount, spell = a15, a13
	elseif sub == "SPELL_HEAL" or sub == "SPELL_PERIODIC_HEAL" then
		if mine and fight then fight.healed = fight.healed + (a15 or 0) end
		return
	end
	if sub == "PARTY_KILL" and mine and fight then fight.kills = fight.kills + 1 end
	if not amount then return end
	if dstGUID == me then
		local _, id = parseGUID(srcGUID)
		lastHit = { name = srcName or (sub == "ENVIRONMENTAL_DAMAGE" and spell) or "Unknown", npcId = id, spell = spell, at = GetTime() }
		if fight then
			fight.taken = fight.taken + amount
			if srcGUID and srcGUID ~= "" then fight.enemies[srcGUID] = srcName end
		end
	elseif mine and fight then
		fight.done = fight.done + amount
		fight.spells[spell or "?"] = (fight.spells[spell or "?"] or 0) + 1
		if dstGUID then fight.enemies[dstGUID] = dstName end
	end
end)

-- Character -----------------------------------------------------------------

local SLOTS = 19
local equipped = {}

local function gearSnapshot()
	local slots = {}
	for slot = 1, SLOTS do
		local link = GetInventoryItemLink("player", slot)
		equipped[slot] = idFromLink(link)
		if link then
			slots[#slots + 1] = { slot = slot, id = idFromLink(link), name = nameFromLink(link), link = link }
			wantItem(idFromLink(link))
		end
	end
	record("gear", { slots = slots })
end

on("PLAYER_EQUIPMENT_CHANGED", function(slot)
	if not session() or not slot or slot > SLOTS then return end
	local link = GetInventoryItemLink("player", slot)
	local id = idFromLink(link)
	if id == equipped[slot] then return end
	record("equip", { slot = slot, id = id, name = nameFromLink(link), link = link, was = equipped[slot] })
	equipped[slot] = id
	wantItem(id)
end)

local function talentSnapshot()
	if not GetNumTalentTabs then return end
	local tabs = {}
	for tab = 1, GetNumTalentTabs() do
		-- Classic Era: name, icon, spent; later clients: id, name, description, icon, spent.
		local a, b, c, _, e = GetTalentTabInfo(tab)
		local tabName, spent = a, c
		if type(a) == "number" then tabName, spent = b, e end
		local talents = {}
		for i = 1, (GetNumTalents(tab) or 0) do
			local name, _, tier, column, rank, maxRank = GetTalentInfo(tab, i)
			if name and rank and rank > 0 then talents[#talents + 1] = { name = name, rank = rank, max = maxRank, tier = tier, col = column } end
		end
		tabs[#tabs + 1] = { name = tabName, spent = spent, talents = talents }
	end
	record("talents", { tabs = tabs, unspent = UnitCharacterPoints and UnitCharacterPoints("player") or nil })
end

local STAT_NAMES = { "str", "agi", "sta", "int", "spi" }
local RESIST_NAMES = { "holy", "fire", "nature", "frost", "shadow", "arcane" }

local function statsSnapshot()
	local st = {}
	for i, key in ipairs(STAT_NAMES) do
		local _, value = UnitStat("player", i)
		st[key] = value
	end
	local _, armor = UnitArmor("player")
	st.armor = armor
	st.hp = UnitHealthMax("player")
	st.power = UnitPowerMax and UnitPowerMax("player") or nil
	local base, pos, neg = UnitAttackPower("player")
	if base then st.ap = base + (pos or 0) + (neg or 0) end
	for i, key in ipairs(RESIST_NAMES) do
		local _, total = UnitResistance("player", i)
		if total and total > 0 then st[key] = total end
	end
	for key, fn in pairs({ crit = GetCritChance, dodge = GetDodgeChance, parry = GetParryChance, block = GetBlockChance }) do
		if fn then st[key] = ns.round(fn() or 0) end
	end
	if GetSpellCritChance then st.spellCrit = ns.round(GetSpellCritChance(2) or 0) end
	record("stats", { stats = st })
end

local function repSnapshot()
	if not GetNumFactions then return end
	local list = {}
	for i = 1, GetNumFactions() do
		local name, _, standing, low, high, value, _, _, isHeader, _, hasRep = GetFactionInfo(i)
		if name and (not isHeader or hasRep) then list[#list + 1] = { name = name, standing = standing, value = value, low = low, high = high } end
	end
	record("reputation", { factions = list })
end

local function skillsSnapshot()
	if not GetNumSkillLines then return end
	local list = {}
	for i = 1, GetNumSkillLines() do
		local name, isHeader, _, rank, _, _, max = GetSkillLineInfo(i)
		if name and not isHeader then list[#list + 1] = { name = name, rank = rank, max = max } end
	end
	record("skills", { skills = list })
end

local function bagsSnapshot()
	local counts = {}
	for bag = 0, 4 do
		local slots = (C_Container and C_Container.GetContainerNumSlots and C_Container.GetContainerNumSlots(bag)) or (GetContainerNumSlots and GetContainerNumSlots(bag)) or 0
		for slot = 1, slots do
			local link, count
			if C_Container and C_Container.GetContainerItemInfo then
				local info = C_Container.GetContainerItemInfo(bag, slot)
				if info then link, count = info.hyperlink, info.stackCount end
			elseif GetContainerItemLink then
				link = GetContainerItemLink(bag, slot)
				count = link and select(2, GetContainerItemInfo(bag, slot))
			end
			local id = idFromLink(link)
			if id then
				counts[id] = (counts[id] or 0) + (count or 1)
				wantItem(id)
			end
		end
	end
	local items = {}
	for id, n in pairs(counts) do items[#items + 1] = { id = id, n = n } end
	record("bags", { items = items, money = GetMoney() })
end

local lastMoney
on("PLAYER_MONEY", function()
	local money = GetMoney()
	if lastMoney and money ~= lastMoney and session() then
		record("money", { delta = money - lastMoney, total = money, ctx = contextName() })
	end
	lastMoney = money
end)

on("CHAT_MSG_COMBAT_XP_GAIN", function(msg)
	record("xp", { text = msg, amount = tonumber(msg:match("(%d+)")) })
end)

local repUp = ns.toPattern(FACTION_STANDING_INCREASED)
local repDown = ns.toPattern(FACTION_STANDING_DECREASED)
on("CHAT_MSG_COMBAT_FACTION_CHANGE", function(msg)
	local ev = { text = msg }
	local faction, amount = msg:match(repUp or "^$")
	if faction then ev.faction, ev.amount = faction, tonumber(amount) end
	faction, amount = msg:match(repDown or "^$")
	if faction then ev.faction, ev.amount = faction, -tonumber(amount) end
	record("rep", ev)
end)

on("CHARACTER_POINTS_CHANGED", function() if session() then talentSnapshot() end end)
on("PLAYER_LEVEL_UP", function()
	-- Stats and talents settle a moment after the level-up itself.
	local later = function() statsSnapshot() talentSnapshot() end
	if C_Timer and C_Timer.After then C_Timer.After(2, later) else later() end
	screenshot("level")
end)

on("TIME_PLAYED_MSG", function(total, level)
	record("played", { total = total, level = level })
end)

table.insert(ns.sessionStartHooks, function(s)
	seen, rares, looted, equipped = {}, {}, {}, {}
	lastMoney = GetMoney()
	s.char.guild = GetGuildInfo and GetGuildInfo("player") or nil
	s.char.bind = GetBindLocation and GetBindLocation() or nil
	s.char.money = lastMoney
	s.char.xp = UnitXP and UnitXP("player") or nil
	s.char.xpMax = UnitXPMax and UnitXPMax("player") or nil
	s.char.sex = UnitSex and UnitSex("player") or nil
	s.track = {}
	gearSnapshot()
	talentSnapshot()
	statsSnapshot()
	repSnapshot()
	skillsSnapshot()
	bagsSnapshot()
	if not ns.hooked then
		ns.hooked = true
		hookTooltip(GameTooltip)
		hookTooltip(ItemRefTooltip)
		hookTitle(GameTooltip)
	end
	if settings().scanner then applyScanner(true) end
	if C_Timer and C_Timer.NewTicker and not ns.ticker then ns.ticker = C_Timer.NewTicker(2, trackTick) end
end)

table.insert(ns.sessionEndHooks, function()
	bagsSnapshot()
	repSnapshot()
	skillsSnapshot()
end)

-- Screenshots -----------------------------------------------------------------

on("SCREENSHOT_SUCCEEDED", function()
	record("screenshot", { reason = ns.pendingShot or "manual" })
	ns.pendingShot = nil
end)
local discovered = { ns.toPattern(ERR_ZONE_EXPLORED_XP), ns.toPattern(ERR_ZONE_EXPLORED) }
local function discovery(a, b)
	local msg = type(b) == "string" and b or a
	if type(msg) ~= "string" then return end
	for _, p in ipairs(discovered) do
		if msg:match(p) then screenshot("discovery") return end
	end
end
on("UI_INFO_MESSAGE", discovery)
on("CHAT_MSG_SYSTEM", discovery)

-- Social (off unless /comp social on) -------------------------------------

local CHAT = {
	CHAT_MSG_SAY = "say", CHAT_MSG_YELL = "yell", CHAT_MSG_PARTY = "party", CHAT_MSG_PARTY_LEADER = "party",
	CHAT_MSG_GUILD = "guild", CHAT_MSG_WHISPER = "whisper", CHAT_MSG_WHISPER_INFORM = "whisper_to",
	CHAT_MSG_EMOTE = "emote", CHAT_MSG_TEXT_EMOTE = "emote", CHAT_MSG_RAID = "raid",
}
for event, channel in pairs(CHAT) do
	on(event, function(text, from)
		if ns.isLiveLine and ns.isLiveLine(text) then return end -- the live link's own whispers
		if settings().social then record("chat", { ch = channel, from = from, text = text }) end
	end)
end

local lastGroup
on("GROUP_ROSTER_UPDATE", function()
	if not settings().social then return end
	local members = {}
	local n = GetNumGroupMembers and GetNumGroupMembers() or 0
	for i = 1, n do
		local unit = (IsInRaid and IsInRaid()) and ("raid" .. i) or (i == 1 and "player" or ("party" .. (i - 1)))
		local name = UnitName(unit)
		if name then
			local _, class = UnitClass(unit)
			members[#members + 1] = { name = name, class = class, level = UnitLevel(unit) }
		end
	end
	local key = table.concat((function() local t = {} for _, m in ipairs(members) do t[#t + 1] = m.name end return t end)(), ",")
	if key ~= lastGroup then
		lastGroup = key
		record("group", { members = members })
	end
end)
on("DUEL_REQUESTED", function(name) if settings().social then record("duel", { with = name }) end end)
on("DUEL_FINISHED", function() if settings().social then record("duel_end") end end)

-- Commands ------------------------------------------------------------------

local function toggle(key, label, after)
	return function(arg)
		local s = settings()
		if arg == "on" then s[key] = true elseif arg == "off" then s[key] = false else s[key] = not s[key] end
		print(string.format("|cff5a9bffCompendium|r %s %s", label, s[key] and "on" or "off"))
		if after then after(s[key]) end
	end
end

ns.commands.shots = toggle("screenshots", "automatic screenshots")
ns.commands.social = toggle("social", "group, duel and chat logging")
ns.commands.track = toggle("track", "position tracking")
ns.commands.scanner = toggle("scanner", "invisible nameplate scanner", applyScanner)
ns.commands.items = function()
	local n = 0
	for _ in pairs(CompendiumDB.items) do n = n + 1 end
	print(string.format("|cff5a9bffCompendium|r %d items in the catalog, %d waiting for item info.", n, #pending))
end
for _, line in ipairs({
	"/comp shots [on|off] - automatic screenshots at big moments",
	"/comp scanner [on|off] - log every NPC in range using invisible nameplates",
	"/comp social [on|off] - log group, duels and chat",
	"/comp track [on|off] - position tracking for the footage finder",
	"/comp items - item catalog size",
}) do
	ns.helpLines[#ns.helpLines + 1] = line
end
