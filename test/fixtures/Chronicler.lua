
ChroniclerDB = {
	["errors"] = {
		{
			["build"] = 11507,
			["ctx"] = "CHAT_MSG_SKILL",
			["first"] = 1790000077,
			["key"] = "test/addon/harness.lua:569: boom",
			["last"] = 1790000077,
			["level"] = 10,
			["msg"] = "test/addon/harness.lua:569: boom",
			["n"] = 2,
			["session"] = "Mankrik-Aldric-1790000000",
			["sub"] = "Goldshire",
			["version"] = "?",
			["zone"] = "Elwynn Forest",
		}, -- [1]
	},
	["items"] = {
		[1372] = {
			["bind"] = 0,
			["classId"] = 4,
			["first"] = 1790000014,
			["icon"] = 135009,
			["id"] = 1372,
			["ilvl"] = 5,
			["link"] = "|cff9d9d9d|Hitem:1372::::|h[Ragged Leather Vest]|h|r",
			["name"] = "Ragged Leather Vest",
			["q"] = 0,
			["req"] = 1,
			["scanned"] = true,
			["sell"] = 3,
			["slot"] = "INVTYPE_CHEST",
			["stack"] = 1,
			["sub"] = "Leather",
			["subId"] = 2,
			["tip"] = {
				"Ragged Leather Vest|9e9e9e", -- [1]
				"Chest	Leather", -- [2]
				"11 Armor", -- [3]
				"Durability 25 / 25", -- [4]
			},
			["type"] = "Armor",
		},
		[159] = {
			["bind"] = 0,
			["classId"] = 0,
			["first"] = 1790000014,
			["icon"] = 132794,
			["id"] = 159,
			["ilvl"] = 5,
			["link"] = "|cffffffff|Hitem:159::::|h[Refreshing Spring Water]|h|r",
			["name"] = "Refreshing Spring Water",
			["q"] = 1,
			["req"] = 1,
			["scanned"] = true,
			["sell"] = 1,
			["spell"] = "Drink",
			["spellId"] = 430,
			["stack"] = 20,
			["sub"] = "Consumable",
			["subId"] = 0,
			["tip"] = {
				"Refreshing Spring Water", -- [1]
				"Use: Restores 151 mana over 18 sec.|00ff00", -- [2]
			},
			["type"] = "Consumable",
		},
		[2488] = {
			["bind"] = 1,
			["classId"] = 2,
			["first"] = 1790000041,
			["icon"] = 135274,
			["id"] = 2488,
			["ilvl"] = 7,
			["link"] = "|cffffffff|Hitem:2488::::|h[Gladius]|h|r",
			["name"] = "Gladius",
			["q"] = 1,
			["req"] = 2,
			["scanned"] = true,
			["sell"] = 60,
			["slot"] = "INVTYPE_WEAPON",
			["stack"] = 1,
			["stats"] = {
				["ITEM_MOD_STRENGTH_SHORT"] = 1,
			},
			["sub"] = "One-Handed Swords",
			["subId"] = 7,
			["tip"] = {
				"Gladius", -- [1]
				"One-Hand	Sword", -- [2]
				"5 - 11 Damage	Speed 2.60", -- [3]
				"+1 Strength", -- [4]
			},
			["type"] = "Weapon",
		},
		[2589] = {
			["bind"] = 0,
			["classId"] = 7,
			["first"] = 1790000041,
			["icon"] = 132889,
			["id"] = 2589,
			["ilvl"] = 5,
			["link"] = "|cffffffff|Hitem:2589::::|h[Linen Cloth]|h|r",
			["name"] = "Linen Cloth",
			["q"] = 1,
			["reagent"] = true,
			["req"] = 0,
			["scanned"] = true,
			["sell"] = 13,
			["stack"] = 20,
			["sub"] = "Cloth",
			["subId"] = 5,
			["tip"] = {
				"Linen Cloth", -- [1]
				"Stitched together from threads spun by the humble.|ffd100", -- [2]
			},
			["type"] = "Trade Goods",
		},
	},
	["objects"] = {
		[171938] = "Cactus Apple",
		[201] = "Solid Chest",
	},
	["schema"] = 2,
	["sessions"] = {
		{
			["build"] = {
				["build"] = "61582",
				["date"] = "Jun 1 2026",
				["interface"] = 11507,
				["version"] = "1.15.7",
			},
			["char"] = {
				["bind"] = "Northshire Abbey",
				["class"] = "Paladin",
				["classToken"] = "PALADIN",
				["faction"] = "Alliance",
				["guid"] = "Player-4372-0ABCDEF1",
				["guild"] = "Chroniclers",
				["level"] = 1,
				["money"] = 1000,
				["name"] = "Aldric",
				["race"] = "Human",
				["raceToken"] = "Human",
				["realm"] = "Mankrik",
				["sex"] = 2,
				["xp"] = 50,
				["xpMax"] = 400,
			},
			["events"] = {
				{
					["e"] = "session_start",
					["lvl"] = 1,
					["m"] = 1429,
					["sz"] = "Northshire Valley",
					["t"] = 1790000000,
					["x"] = 48,
					["y"] = 42,
					["z"] = "Elwynn Forest",
				}, -- [1]
				{
					["e"] = "gear",
					["lvl"] = 1,
					["m"] = 1429,
					["slots"] = {
						{
							["id"] = 1372,
							["link"] = "|cff9d9d9d|Hitem:1372::::|h[Ragged Leather Vest]|h|r",
							["name"] = "Ragged Leather Vest",
							["slot"] = 5,
						}, -- [1]
					},
					["sz"] = "Northshire Valley",
					["t"] = 1790000000,
					["x"] = 48,
					["y"] = 42,
					["z"] = "Elwynn Forest",
				}, -- [2]
				{
					["e"] = "talents",
					["lvl"] = 1,
					["m"] = 1429,
					["sz"] = "Northshire Valley",
					["t"] = 1790000000,
					["tabs"] = {
						{
							["name"] = "Holy",
							["spent"] = 0,
							["talents"] = {
							},
						}, -- [1]
					},
					["unspent"] = 0,
					["x"] = 48,
					["y"] = 42,
					["z"] = "Elwynn Forest",
				}, -- [3]
				{
					["e"] = "stats",
					["lvl"] = 1,
					["m"] = 1429,
					["stats"] = {
						["agi"] = 22,
						["ap"] = 45,
						["armor"] = 45,
						["block"] = 5,
						["crit"] = 5.2,
						["dodge"] = 5,
						["fire"] = 10,
						["hp"] = 100,
						["int"] = 24,
						["parry"] = 5,
						["power"] = 60,
						["spellCrit"] = 3,
						["spi"] = 25,
						["sta"] = 23,
						["str"] = 21,
					},
					["sz"] = "Northshire Valley",
					["t"] = 1790000000,
					["x"] = 48,
					["y"] = 42,
					["z"] = "Elwynn Forest",
				}, -- [4]
				{
					["e"] = "reputation",
					["factions"] = {
						{
							["high"] = 9000,
							["low"] = 3000,
							["name"] = "Stormwind",
							["standing"] = 5,
							["value"] = 3250,
						}, -- [1]
					},
					["lvl"] = 1,
					["m"] = 1429,
					["sz"] = "Northshire Valley",
					["t"] = 1790000000,
					["x"] = 48,
					["y"] = 42,
					["z"] = "Elwynn Forest",
				}, -- [5]
				{
					["e"] = "skills",
					["lvl"] = 1,
					["m"] = 1429,
					["skills"] = {
						{
							["max"] = 75,
							["name"] = "Mining",
							["rank"] = 2,
						}, -- [1]
					},
					["sz"] = "Northshire Valley",
					["t"] = 1790000000,
					["x"] = 48,
					["y"] = 42,
					["z"] = "Elwynn Forest",
				}, -- [6]
				{
					["e"] = "bags",
					["items"] = {
						{
							["id"] = 159,
							["n"] = 5,
						}, -- [1]
					},
					["lvl"] = 1,
					["m"] = 1429,
					["money"] = 1000,
					["sz"] = "Northshire Valley",
					["t"] = 1790000000,
					["x"] = 48,
					["y"] = 42,
					["z"] = "Elwynn Forest",
				}, -- [7]
				{
					["e"] = "quest_detail",
					["lvl"] = 1,
					["m"] = 1429,
					["npc"] = "Deputy Willem",
					["npcId"] = 823,
					["npcKind"] = "Creature",
					["obj"] = "Kill 10 Kobold Vermin, then return to Marshal McBride.",
					["qid"] = 7,
					["rewardMoney"] = 50,
					["rewardXp"] = 170,
					["rewards"] = {
						{
							["id"] = 1372,
							["n"] = 1,
							["name"] = "Ragged Leather Vest",
						}, -- [1]
					},
					["sz"] = "Northshire Valley",
					["t"] = 1790000001.1,
					["text"] = "Your first task is one of cleansing.\nA clan of kobolds have infested the woods.",
					["title"] = "Kobold Camp Cleanup",
					["x"] = 48,
					["y"] = 42,
					["z"] = "Elwynn Forest",
				}, -- [8]
				{
					["e"] = "npc",
					["faction"] = "Alliance",
					["full"] = true,
					["hp"] = 500,
					["level"] = 10,
					["lvl"] = 1,
					["m"] = 1429,
					["name"] = "Deputy Willem",
					["npcId"] = 823,
					["npcKind"] = "Creature",
					["react"] = 5,
					["src"] = "talk",
					["sz"] = "Northshire Valley",
					["t"] = 1790000001.1,
					["tip"] = {
						"Brother Danil", -- [1]
						"<General Supplies>", -- [2]
						"Level 15", -- [3]
					},
					["title"] = "General Supplies",
					["x"] = 48,
					["y"] = 42,
					["z"] = "Elwynn Forest",
				}, -- [9]
				{
					["e"] = "quest_accept",
					["lvl"] = 1,
					["m"] = 1429,
					["qid"] = 7,
					["sz"] = "Northshire Valley",
					["t"] = 1790000003.1,
					["title"] = "Kobold Camp Cleanup",
					["x"] = 48,
					["y"] = 42,
					["z"] = "Elwynn Forest",
				}, -- [10]
				{
					["e"] = "npc",
					["lvl"] = 1,
					["m"] = 1429,
					["name"] = "Kobold Vermin",
					["npcId"] = 6,
					["npcKind"] = "Creature",
					["react"] = 2,
					["src"] = "combat",
					["sz"] = "Northshire Valley",
					["t"] = 1790000004.1,
					["x"] = 48,
					["y"] = 42,
					["z"] = "Elwynn Forest",
				}, -- [11]
				{
					["blow"] = true,
					["e"] = "kill",
					["lvl"] = 1,
					["m"] = 1429,
					["name"] = "Kobold Vermin",
					["npcId"] = 6,
					["npcKind"] = "Creature",
					["sz"] = "Northshire Valley",
					["t"] = 1790000004.1,
					["x"] = 48,
					["y"] = 42,
					["z"] = "Elwynn Forest",
				}, -- [12]
				{
					["e"] = "npc",
					["lvl"] = 1,
					["m"] = 1429,
					["name"] = "Kobold Vermin",
					["npcId"] = 6,
					["npcKind"] = "Creature",
					["react"] = 2,
					["src"] = "combat",
					["sz"] = "Northshire Valley",
					["t"] = 1790000007.1,
					["x"] = 48,
					["y"] = 42,
					["z"] = "Elwynn Forest",
				}, -- [13]
				{
					["e"] = "kill",
					["lvl"] = 1,
					["m"] = 1429,
					["name"] = "Kobold Vermin",
					["npcId"] = 6,
					["npcKind"] = "Creature",
					["sz"] = "Northshire Valley",
					["t"] = 1790000007.1,
					["x"] = 48,
					["y"] = 42,
					["z"] = "Elwynn Forest",
				}, -- [14]
				{
					["e"] = "npc",
					["lvl"] = 1,
					["m"] = 1429,
					["name"] = "Kobold Vermin",
					["npcId"] = 6,
					["npcKind"] = "Creature",
					["react"] = 2,
					["src"] = "combat",
					["sz"] = "Northshire Valley",
					["t"] = 1790000007.1,
					["x"] = 48,
					["y"] = 42,
					["z"] = "Elwynn Forest",
				}, -- [15]
				{
					["e"] = "objective",
					["lvl"] = 1,
					["m"] = 1429,
					["sz"] = "Northshire Valley",
					["t"] = 1790000007.1,
					["text"] = "Kobold Vermin slain: 2/10",
					["x"] = 48,
					["y"] = 42,
					["z"] = "Elwynn Forest",
				}, -- [16]
				{
					["e"] = "loot",
					["icon"] = 135009,
					["id"] = 1372,
					["ilvl"] = 5,
					["lvl"] = 1,
					["m"] = 1429,
					["n"] = 1,
					["name"] = "Ragged Leather Vest",
					["q"] = 0,
					["req"] = 1,
					["slot"] = "INVTYPE_CHEST",
					["src"] = "loot",
					["sub"] = "Leather",
					["sz"] = "Northshire Valley",
					["t"] = 1790000007.1,
					["type"] = "Armor",
					["x"] = 48,
					["y"] = 42,
					["z"] = "Elwynn Forest",
				}, -- [17]
				{
					["e"] = "loot",
					["id"] = 2589,
					["lvl"] = 1,
					["m"] = 1429,
					["n"] = 2,
					["name"] = "Linen Cloth",
					["q"] = 1,
					["src"] = "loot",
					["sz"] = "Northshire Valley",
					["t"] = 1790000007.1,
					["x"] = 48,
					["y"] = 42,
					["z"] = "Elwynn Forest",
				}, -- [18]
				{
					["e"] = "speech",
					["kind"] = "say",
					["lvl"] = 1,
					["m"] = 1429,
					["npcId"] = 197,
					["npcKind"] = "Creature",
					["speaker"] = "Marshal McBride",
					["sz"] = "Northshire Valley",
					["t"] = 1790000007.1,
					["text"] = "Gnolls have been spotted near the vineyards!",
					["x"] = 48,
					["y"] = 42,
					["z"] = "Elwynn Forest",
				}, -- [19]
				{
					["e"] = "npc",
					["lvl"] = 1,
					["m"] = 1429,
					["name"] = "Marshal McBride",
					["npcId"] = 197,
					["npcKind"] = "Creature",
					["src"] = "speech",
					["sz"] = "Northshire Valley",
					["t"] = 1790000007.1,
					["x"] = 48,
					["y"] = 42,
					["z"] = "Elwynn Forest",
				}, -- [20]
				{
					["e"] = "gossip",
					["lvl"] = 1,
					["m"] = 1429,
					["npc"] = "Deputy Willem",
					["npcId"] = 823,
					["npcKind"] = "Creature",
					["options"] = {
						"I would like to train.", -- [1]
					},
					["sz"] = "Northshire Valley",
					["t"] = 1790000012.1,
					["text"] = "Hello, $C. The Light guides us.",
					["x"] = 48,
					["y"] = 42,
					["z"] = "Elwynn Forest",
				}, -- [21]
				{
					["e"] = "book",
					["lvl"] = 1,
					["m"] = 1429,
					["pages"] = {
						"Here lie the brave.", -- [1]
						"May they rest.", -- [2]
					},
					["sz"] = "Northshire Valley",
					["t"] = 1790000012.1,
					["title"] = "Plaque of the Fallen",
					["x"] = 48,
					["y"] = 42,
					["z"] = "Elwynn Forest",
				}, -- [22]
				{
					["e"] = "quest_progress",
					["lvl"] = 1,
					["m"] = 1429,
					["npc"] = "Deputy Willem",
					["npcId"] = 823,
					["npcKind"] = "Creature",
					["qid"] = 7,
					["sz"] = "Northshire Valley",
					["t"] = 1790000012.1,
					["text"] = "Have you finished?",
					["title"] = "Kobold Camp Cleanup",
					["x"] = 48,
					["y"] = 42,
					["z"] = "Elwynn Forest",
				}, -- [23]
				{
					["e"] = "quest_complete",
					["lvl"] = 1,
					["m"] = 1429,
					["npc"] = "Deputy Willem",
					["npcId"] = 823,
					["npcKind"] = "Creature",
					["qid"] = 7,
					["rewardMoney"] = 50,
					["rewardXp"] = 170,
					["rewards"] = {
						{
							["id"] = 1372,
							["n"] = 1,
							["name"] = "Ragged Leather Vest",
						}, -- [1]
					},
					["sz"] = "Northshire Valley",
					["t"] = 1790000012.1,
					["text"] = "You have done well, $N.",
					["title"] = "Kobold Camp Cleanup",
					["x"] = 48,
					["y"] = 42,
					["z"] = "Elwynn Forest",
				}, -- [24]
				{
					["ctx"] = "quest",
					["delta"] = 50,
					["e"] = "money",
					["lvl"] = 1,
					["m"] = 1429,
					["sz"] = "Northshire Valley",
					["t"] = 1790000012.1,
					["total"] = 1050,
					["x"] = 48,
					["y"] = 42,
					["z"] = "Elwynn Forest",
				}, -- [25]
				{
					["e"] = "quest_turnin",
					["lvl"] = 1,
					["m"] = 1429,
					["money"] = 50,
					["qid"] = 7,
					["sz"] = "Northshire Valley",
					["t"] = 1790000012.1,
					["title"] = "Kobold Camp Cleanup",
					["x"] = 48,
					["xp"] = 170,
					["y"] = 42,
					["z"] = "Elwynn Forest",
				}, -- [26]
				{
					["e"] = "level",
					["level"] = 2,
					["lvl"] = 2,
					["m"] = 1429,
					["sz"] = "Northshire Valley",
					["t"] = 1790000012.1,
					["x"] = 48,
					["y"] = 42,
					["z"] = "Elwynn Forest",
				}, -- [27]
				{
					["e"] = "stats",
					["lvl"] = 2,
					["m"] = 1429,
					["stats"] = {
						["agi"] = 22,
						["ap"] = 45,
						["armor"] = 45,
						["block"] = 5,
						["crit"] = 5.2,
						["dodge"] = 5,
						["fire"] = 10,
						["hp"] = 100,
						["int"] = 24,
						["parry"] = 5,
						["power"] = 60,
						["spellCrit"] = 3,
						["spi"] = 25,
						["sta"] = 23,
						["str"] = 21,
					},
					["sz"] = "Northshire Valley",
					["t"] = 1790000012.1,
					["x"] = 48,
					["y"] = 42,
					["z"] = "Elwynn Forest",
				}, -- [28]
				{
					["e"] = "talents",
					["lvl"] = 2,
					["m"] = 1429,
					["sz"] = "Northshire Valley",
					["t"] = 1790000012.1,
					["tabs"] = {
						{
							["name"] = "Holy",
							["spent"] = 0,
							["talents"] = {
							},
						}, -- [1]
					},
					["unspent"] = 0,
					["x"] = 48,
					["y"] = 42,
					["z"] = "Elwynn Forest",
				}, -- [29]
				{
					["e"] = "screenshot",
					["lvl"] = 2,
					["m"] = 1429,
					["reason"] = "level",
					["sz"] = "Northshire Valley",
					["t"] = 1790000012.1,
					["x"] = 48,
					["y"] = 42,
					["z"] = "Elwynn Forest",
				}, -- [30]
				{
					["desc"] = "Heals a friendly target.",
					["e"] = "learn",
					["lvl"] = 2,
					["m"] = 1429,
					["spellId"] = 635,
					["sz"] = "Northshire Valley",
					["t"] = 1790000012.1,
					["what"] = "Holy Light",
					["x"] = 48,
					["y"] = 42,
					["z"] = "Elwynn Forest",
				}, -- [31]
				{
					["e"] = "skill",
					["lvl"] = 2,
					["m"] = 1429,
					["sz"] = "Northshire Valley",
					["t"] = 1790000012.1,
					["text"] = "Your skill in Mining has increased to 2.",
					["x"] = 48,
					["y"] = 42,
					["z"] = "Elwynn Forest",
				}, -- [32]
				{
					["amount"] = 45,
					["e"] = "xp",
					["lvl"] = 2,
					["m"] = 1429,
					["sz"] = "Northshire Valley",
					["t"] = 1790000012.1,
					["text"] = "Kobold Vermin dies, you gain 45 experience.",
					["x"] = 48,
					["y"] = 42,
					["z"] = "Elwynn Forest",
				}, -- [33]
				{
					["amount"] = 25,
					["e"] = "rep",
					["faction"] = "Stormwind",
					["lvl"] = 2,
					["m"] = 1429,
					["sz"] = "Northshire Valley",
					["t"] = 1790000012.1,
					["text"] = "Reputation with Stormwind increased by 25.",
					["x"] = 48,
					["y"] = 42,
					["z"] = "Elwynn Forest",
				}, -- [34]
				{
					["ctype"] = "Humanoid",
					["e"] = "npc",
					["full"] = true,
					["hp"] = 90,
					["level"] = 3,
					["lvl"] = 2,
					["m"] = 1429,
					["name"] = "Defias Thug",
					["npcId"] = 38,
					["npcKind"] = "Creature",
					["react"] = 2,
					["src"] = "nameplate",
					["sz"] = "Northshire Valley",
					["t"] = 1790000020.1,
					["x"] = 46,
					["y"] = 42,
					["z"] = "Elwynn Forest",
				}, -- [35]
				{
					["ctype"] = "Beast",
					["e"] = "npc",
					["family"] = "Spider",
					["full"] = true,
					["hp"] = 600,
					["level"] = 10,
					["lvl"] = 2,
					["m"] = 1429,
					["name"] = "Mother Fang",
					["npcId"] = 471,
					["npcKind"] = "Creature",
					["rank"] = "rareelite",
					["rare"] = true,
					["react"] = 2,
					["src"] = "mouseover",
					["sz"] = "Northshire Valley",
					["t"] = 1790000020.1,
					["tip"] = {
						"Mother Fang", -- [1]
						"Level 10 Rare Elite Beast", -- [2]
					},
					["x"] = 46,
					["y"] = 42,
					["z"] = "Elwynn Forest",
				}, -- [36]
				{
					["e"] = "screenshot",
					["lvl"] = 2,
					["m"] = 1429,
					["reason"] = "rare",
					["sz"] = "Northshire Valley",
					["t"] = 1790000020.1,
					["x"] = 46,
					["y"] = 42,
					["z"] = "Elwynn Forest",
				}, -- [37]
				{
					["e"] = "npc",
					["lvl"] = 2,
					["m"] = 1429,
					["name"] = "Kobold Worker",
					["npcId"] = 257,
					["npcKind"] = "Creature",
					["react"] = 2,
					["src"] = "combat",
					["sz"] = "Northshire Valley",
					["t"] = 1790000020.1,
					["x"] = 46,
					["y"] = 42,
					["z"] = "Elwynn Forest",
				}, -- [38]
				{
					["e"] = "npc",
					["lvl"] = 2,
					["m"] = 1429,
					["name"] = "Young Wolf",
					["npcId"] = 299,
					["npcKind"] = "Creature",
					["react"] = 4,
					["src"] = "combat",
					["sz"] = "Northshire Valley",
					["t"] = 1790000020.1,
					["x"] = 46,
					["y"] = 42,
					["z"] = "Elwynn Forest",
				}, -- [39]
				{
					["blow"] = true,
					["e"] = "kill",
					["lvl"] = 2,
					["m"] = 1429,
					["name"] = "Defias Thug",
					["npcId"] = 38,
					["npcKind"] = "Creature",
					["sz"] = "Northshire Valley",
					["t"] = 1790000020.1,
					["x"] = 46,
					["y"] = 42,
					["z"] = "Elwynn Forest",
				}, -- [40]
				{
					["close"] = true,
					["done"] = 90,
					["dur"] = 8,
					["e"] = "fight",
					["enemies"] = {
						{
							["level"] = 3,
							["name"] = "Defias Thug",
							["npcId"] = 38,
						}, -- [1]
					},
					["kills"] = 1,
					["lvl"] = 2,
					["m"] = 1429,
					["minHp"] = 12,
					["spells"] = {
						{
							["n"] = 1,
							["name"] = "Melee",
						}, -- [1]
						{
							["n"] = 1,
							["name"] = "Seal of Righteousness",
						}, -- [2]
					},
					["sz"] = "Northshire Valley",
					["t"] = 1790000028.1,
					["taken"] = 88,
					["x"] = 46,
					["y"] = 42,
					["z"] = "Elwynn Forest",
				}, -- [41]
				{
					["e"] = "loot_window",
					["items"] = {
						{
							["id"] = 2589,
							["n"] = 2,
							["name"] = "Linen Cloth",
						}, -- [1]
						{
							["id"] = 159,
							["n"] = 1,
							["name"] = "Refreshing Spring Water",
						}, -- [2]
					},
					["lvl"] = 2,
					["m"] = 1429,
					["money"] = "12 Copper",
					["sources"] = {
						{
							["id"] = 38,
							["kind"] = "Creature",
							["level"] = 3,
							["name"] = "Defias Thug",
						}, -- [1]
					},
					["sz"] = "Northshire Valley",
					["t"] = 1790000028.1,
					["x"] = 46,
					["y"] = 42,
					["z"] = "Elwynn Forest",
				}, -- [42]
				{
					["e"] = "object",
					["lvl"] = 2,
					["m"] = 1429,
					["name"] = "Cactus Apple",
					["objId"] = 171938,
					["sz"] = "Northshire Valley",
					["t"] = 1790000028.1,
					["x"] = 46,
					["y"] = 42,
					["z"] = "Elwynn Forest",
				}, -- [43]
				{
					["e"] = "loot_window",
					["items"] = {
						{
							["id"] = 11583,
							["n"] = 1,
							["name"] = "Cactus Apple",
						}, -- [1]
					},
					["lvl"] = 2,
					["m"] = 1429,
					["sources"] = {
						{
							["id"] = 171938,
							["kind"] = "GameObject",
							["name"] = "Cactus Apple",
						}, -- [1]
					},
					["sz"] = "Northshire Valley",
					["t"] = 1790000028.1,
					["x"] = 46,
					["y"] = 42,
					["z"] = "Elwynn Forest",
				}, -- [44]
				{
					["e"] = "loot_window",
					["items"] = {
						{
							["id"] = 2589,
							["n"] = 1,
							["name"] = "Linen Cloth",
						}, -- [1]
					},
					["lvl"] = 2,
					["m"] = 1429,
					["sources"] = {
						{
							["id"] = 200,
							["kind"] = "GameObject",
						}, -- [1]
					},
					["sz"] = "Northshire Valley",
					["t"] = 1790000041.1,
					["x"] = 46,
					["y"] = 42,
					["z"] = "Elwynn Forest",
				}, -- [45]
				{
					["e"] = "object",
					["lvl"] = 2,
					["m"] = 1429,
					["name"] = "Solid Chest",
					["objId"] = 201,
					["sz"] = "Northshire Valley",
					["t"] = 1790000041.1,
					["x"] = 46,
					["y"] = 42,
					["z"] = "Elwynn Forest",
				}, -- [46]
				{
					["e"] = "loot_window",
					["items"] = {
						{
							["id"] = 2589,
							["n"] = 1,
							["name"] = "Linen Cloth",
						}, -- [1]
					},
					["lvl"] = 2,
					["m"] = 1429,
					["sources"] = {
						{
							["id"] = 201,
							["kind"] = "GameObject",
							["name"] = "Solid Chest",
						}, -- [1]
					},
					["sz"] = "Northshire Valley",
					["t"] = 1790000041.1,
					["x"] = 46,
					["y"] = 42,
					["z"] = "Elwynn Forest",
				}, -- [47]
				{
					["e"] = "npc",
					["faction"] = "Alliance",
					["full"] = true,
					["hp"] = 700,
					["level"] = 15,
					["lvl"] = 2,
					["m"] = 1429,
					["name"] = "Brother Danil",
					["npcId"] = 152,
					["npcKind"] = "Creature",
					["react"] = 5,
					["src"] = "talk",
					["sz"] = "Northshire Valley",
					["t"] = 1790000041.1,
					["tip"] = {
						"Brother Danil", -- [1]
						"<General Supplies>", -- [2]
						"Level 15", -- [3]
					},
					["title"] = "General Supplies",
					["x"] = 46,
					["y"] = 42,
					["z"] = "Elwynn Forest",
				}, -- [48]
				{
					["e"] = "vendor",
					["items"] = {
						{
							["icon"] = 1,
							["id"] = 159,
							["name"] = "Refreshing Spring Water",
							["per"] = 1,
							["price"] = 25,
						}, -- [1]
						{
							["costs"] = {
								{
									["id"] = 2589,
									["name"] = "Linen Cloth",
									["value"] = 3,
								}, -- [1]
							},
							["icon"] = 1,
							["id"] = 2488,
							["name"] = "Gladius",
							["per"] = 1,
							["price"] = 700,
							["stock"] = 2,
						}, -- [2]
					},
					["lvl"] = 2,
					["m"] = 1429,
					["npc"] = "Brother Danil",
					["npcId"] = 152,
					["npcKind"] = "Creature",
					["repair"] = true,
					["sz"] = "Northshire Valley",
					["t"] = 1790000041.1,
					["x"] = 46,
					["y"] = 42,
					["z"] = "Elwynn Forest",
				}, -- [49]
				{
					["ctx"] = "merchant",
					["delta"] = -25,
					["e"] = "money",
					["lvl"] = 2,
					["m"] = 1429,
					["sz"] = "Northshire Valley",
					["t"] = 1790000041.1,
					["total"] = 1025,
					["x"] = 46,
					["y"] = 42,
					["z"] = "Elwynn Forest",
				}, -- [50]
				{
					["e"] = "trainer",
					["greeting"] = "The Light calls to you.",
					["lvl"] = 2,
					["m"] = 1429,
					["npc"] = "Brother Danil",
					["npcId"] = 152,
					["npcKind"] = "Creature",
					["services"] = {
						{
							["cost"] = 100,
							["level"] = 2,
							["name"] = "Seal of Righteousness",
							["rank"] = "Rank 2",
							["status"] = "available",
						}, -- [1]
						{
							["cost"] = 200,
							["level"] = 4,
							["name"] = "Blessing of Might",
							["rank"] = "Rank 1",
							["status"] = "unavailable",
						}, -- [2]
					},
					["sz"] = "Northshire Valley",
					["t"] = 1790000043.1,
					["x"] = 46,
					["y"] = 42,
					["z"] = "Elwynn Forest",
				}, -- [51]
				{
					["e"] = "taxi_map",
					["lvl"] = 2,
					["m"] = 1429,
					["nodes"] = {
						{
							["cost"] = 0,
							["name"] = "Stormwind",
							["type"] = "CURRENT",
							["x"] = 50,
							["y"] = 60,
						}, -- [1]
						{
							["cost"] = 50,
							["name"] = "Sentinel Hill",
							["type"] = "REACHABLE",
							["x"] = 30,
							["y"] = 70,
						}, -- [2]
					},
					["npc"] = "Brother Danil",
					["npcId"] = 152,
					["npcKind"] = "Creature",
					["sz"] = "Northshire Valley",
					["t"] = 1790000043.1,
					["x"] = 46,
					["y"] = 42,
					["z"] = "Elwynn Forest",
				}, -- [52]
				{
					["cost"] = 50,
					["e"] = "flight",
					["lvl"] = 2,
					["m"] = 1429,
					["sz"] = "Northshire Valley",
					["t"] = 1790000043.1,
					["to"] = "Sentinel Hill",
					["x"] = 46,
					["y"] = 42,
					["z"] = "Elwynn Forest",
				}, -- [53]
				{
					["e"] = "flight_end",
					["lvl"] = 2,
					["m"] = 1429,
					["sz"] = "Northshire Valley",
					["t"] = 1790000047.1,
					["x"] = 46,
					["y"] = 42,
					["z"] = "Elwynn Forest",
				}, -- [54]
				{
					["e"] = "bind",
					["lvl"] = 2,
					["m"] = 1429,
					["sz"] = "Northshire Valley",
					["t"] = 1790000047.1,
					["where"] = "Lion's Pride Inn",
					["x"] = 46,
					["y"] = 42,
					["z"] = "Elwynn Forest",
				}, -- [55]
				{
					["e"] = "equip",
					["id"] = 2488,
					["link"] = "|cffffffff|Hitem:2488::::|h[Gladius]|h|r",
					["lvl"] = 2,
					["m"] = 1429,
					["name"] = "Gladius",
					["slot"] = 16,
					["sz"] = "Northshire Valley",
					["t"] = 1790000047.1,
					["x"] = 46,
					["y"] = 42,
					["z"] = "Elwynn Forest",
				}, -- [56]
				{
					["e"] = "talents",
					["lvl"] = 10,
					["m"] = 1429,
					["sz"] = "Northshire Valley",
					["t"] = 1790000047.1,
					["tabs"] = {
						{
							["name"] = "Holy",
							["spent"] = 1,
							["talents"] = {
								{
									["col"] = 2,
									["max"] = 5,
									["name"] = "Divine Strength",
									["rank"] = 1,
									["tier"] = 1,
								}, -- [1]
							},
						}, -- [1]
					},
					["unspent"] = 0,
					["x"] = 46,
					["y"] = 42,
					["z"] = "Elwynn Forest",
				}, -- [57]
				{
					["ch"] = "say",
					["e"] = "chat",
					["from"] = "Someone",
					["lvl"] = 10,
					["m"] = 1429,
					["sz"] = "Northshire Valley",
					["t"] = 1790000047.1,
					["text"] = "anyone for Hogger?",
					["x"] = 46,
					["y"] = 42,
					["z"] = "Elwynn Forest",
				}, -- [58]
				{
					["e"] = "zone",
					["lvl"] = 10,
					["m"] = 1429,
					["sz"] = "Goldshire",
					["t"] = 1790000077.1,
					["x"] = 42,
					["y"] = 65,
					["z"] = "Elwynn Forest",
				}, -- [59]
				{
					["area"] = "Goldshire",
					["e"] = "explore",
					["lvl"] = 10,
					["m"] = 1429,
					["sz"] = "Goldshire",
					["t"] = 1790000077.1,
					["x"] = 42,
					["y"] = 65,
					["z"] = "Elwynn Forest",
				}, -- [60]
				{
					["e"] = "screenshot",
					["lvl"] = 10,
					["m"] = 1429,
					["reason"] = "discovery",
					["sz"] = "Goldshire",
					["t"] = 1790000077.1,
					["x"] = 42,
					["y"] = 65,
					["z"] = "Elwynn Forest",
				}, -- [61]
				{
					["e"] = "sync",
					["lvl"] = 10,
					["m"] = 1429,
					["sz"] = "Goldshire",
					["t"] = 1790000077.1,
					["x"] = 42,
					["y"] = 65,
					["z"] = "Elwynn Forest",
				}, -- [62]
				{
					["e"] = "mark",
					["kind"] = "lore",
					["lvl"] = 10,
					["m"] = 1429,
					["sz"] = "Goldshire",
					["t"] = 1790000077.1,
					["x"] = 42,
					["y"] = 65,
					["z"] = "Elwynn Forest",
				}, -- [63]
				{
					["e"] = "mark",
					["kind"] = "shot",
					["lvl"] = 10,
					["m"] = 1429,
					["note"] = "sunset over the lake",
					["sz"] = "Goldshire",
					["t"] = 1790000077.1,
					["x"] = 42,
					["y"] = 65,
					["z"] = "Elwynn Forest",
				}, -- [64]
				{
					["e"] = "mark",
					["kind"] = "mark",
					["lvl"] = 10,
					["m"] = 1429,
					["note"] = "wolf pathing weird",
					["sz"] = "Goldshire",
					["t"] = 1790000077.1,
					["x"] = 42,
					["y"] = 65,
					["z"] = "Elwynn Forest",
				}, -- [65]
				{
					["e"] = "quest_abandon",
					["lvl"] = 10,
					["m"] = 1429,
					["sz"] = "Goldshire",
					["t"] = 1790000077.1,
					["title"] = "Kobold Camp Cleanup",
					["x"] = 42,
					["y"] = 65,
					["z"] = "Elwynn Forest",
				}, -- [66]
				{
					["e"] = "npc",
					["lvl"] = 10,
					["m"] = 1429,
					["name"] = "Hogger",
					["npcId"] = 448,
					["npcKind"] = "Creature",
					["react"] = 2,
					["src"] = "combat",
					["sz"] = "Goldshire",
					["t"] = 1790000077.1,
					["z"] = "Elwynn Forest",
				}, -- [67]
				{
					["by"] = "Melee",
					["e"] = "death",
					["killer"] = "Hogger",
					["killerId"] = 448,
					["lvl"] = 10,
					["m"] = 1429,
					["sz"] = "Goldshire",
					["t"] = 1790000077.1,
					["z"] = "Elwynn Forest",
				}, -- [68]
				{
					["e"] = "screenshot",
					["lvl"] = 10,
					["m"] = 1429,
					["reason"] = "death",
					["sz"] = "Goldshire",
					["t"] = 1790000077.1,
					["z"] = "Elwynn Forest",
				}, -- [69]
				{
					["e"] = "skill",
					["lvl"] = 10,
					["m"] = 1429,
					["sz"] = "Goldshire",
					["t"] = 1790000077.1,
					["text"] = "Your skill in Fishing has increased to 3.",
					["z"] = "Elwynn Forest",
				}, -- [70]
				{
					["e"] = "skill",
					["lvl"] = 10,
					["m"] = 1429,
					["sz"] = "Goldshire",
					["t"] = 1790000077.1,
					["text"] = "Your skill in Fishing has increased to 4.",
					["z"] = "Elwynn Forest",
				}, -- [71]
				{
					["e"] = "bags",
					["items"] = {
						{
							["id"] = 159,
							["n"] = 5,
						}, -- [1]
					},
					["lvl"] = 10,
					["m"] = 1429,
					["money"] = 1025,
					["sz"] = "Goldshire",
					["t"] = 1790000077.1,
					["z"] = "Elwynn Forest",
				}, -- [72]
				{
					["e"] = "reputation",
					["factions"] = {
						{
							["high"] = 9000,
							["low"] = 3000,
							["name"] = "Stormwind",
							["standing"] = 5,
							["value"] = 3250,
						}, -- [1]
					},
					["lvl"] = 10,
					["m"] = 1429,
					["sz"] = "Goldshire",
					["t"] = 1790000077.1,
					["z"] = "Elwynn Forest",
				}, -- [73]
				{
					["e"] = "skills",
					["lvl"] = 10,
					["m"] = 1429,
					["skills"] = {
						{
							["max"] = 75,
							["name"] = "Mining",
							["rank"] = 2,
						}, -- [1]
					},
					["sz"] = "Goldshire",
					["t"] = 1790000077.1,
					["z"] = "Elwynn Forest",
				}, -- [74]
				{
					["e"] = "session_end",
					["lvl"] = 10,
					["m"] = 1429,
					["sz"] = "Goldshire",
					["t"] = 1790000077.1,
					["z"] = "Elwynn Forest",
				}, -- [75]
			},
			["id"] = "Mankrik-Aldric-1790000000",
			["schema"] = 2,
			["started"] = 1790000000,
			["track"] = {
				"1790000014.10,1429,48.00,42.00,1.57,7.0,0,1170,60,42", -- [1]
				"1790000018.10,1429,47.00,42.00,1.57,7.0,0,1170,60,42", -- [2]
				"1790000020.10,1429,46.00,42.00,1.57,14.0,129,1170,60,42", -- [3]
				"1790000043.10,1429,46.00,42.00,1.57,7.0,0,1170,60,42", -- [4]
				"1790000045.10,1429,46.00,42.00,1.57,7.0,2,1170,60,42", -- [5]
				"1790000047.10,1429,46.00,42.00,1.57,7.0,0,1170,60,42", -- [6]
			},
		}, -- [1]
	},
	["settings"] = {
		["scanner"] = false,
		["screenshots"] = true,
		["silent"] = false,
		["social"] = true,
		["track"] = true,
	},
}
