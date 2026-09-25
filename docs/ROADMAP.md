# Roadmap

The mission: every quest in the game, across every expansion, including class and profession quests. The footage and a first-hand Codex are what that mission produces. The channel is built from them in three formats: shorts, zone episodes, and long-form longplays and sleep content.

## Phase 1: capture (this release)

The addon logs everything and the companion ties it to footage. No scout pass and no notes by hand.

### First real session checklist

The addon was built against the documented WoW API and tested in a simulated client, not in the live game. On your first Classic Era session:

1. Log in with the addon enabled. If WoW says it is out of date, check your interface number with `/dump select(4, GetBuildInfo())` and run `npm run add-interface -- <number>`.
2. Pick up a quest, kill a few mobs, loot, talk to an NPC, read a plaque, and press each mark key once.
3. Type `/chron`. The event count should be climbing and the clock should say *calibrated*.
4. `/reload`, then check the Sessions page. Every one of those actions should be there. Anything missing is a client API difference to fix in the addon. Note which ones.
5. Record a minute in OBS while doing the above, pressing the Sync key right after you start recording if OBS is on another PC. Line the recording up with the flash on its page in the companion, then click a few events. The video should land within a frame or two of each.
6. Import that recording's `.xml` into Premiere and confirm the markers appear. If they don't, the `.srt` import is the fallback.

## Phase 2: the guide (completion without a scout)

- **Quest database.** Import a complete quest list for Classic, with quest givers, coordinates, level ranges, prerequisites, faction and class/profession restrictions. The open-source Questie addon's database is the obvious source. It is GPL-licensed, so it can be used by a personal tool; check the licence before redistributing anything built from it.
- **Zone checklist.** For the zone you are in: what's done (from your log), what's available now, what's locked behind a prerequisite, and what's for another faction or class and why.
- **Class and profession quests** tracked separately, since they cut across zones and span levels.
- **"Next up" suggestions**, a light ordering of the nearest available quests. Advice only, never a mandatory route. The anti-perfectionism rule: if you miss something, it shows up on the checklist later. You don't redo the zone.
- **A map view** with the pickups, objectives and turn-ins you have already logged.

## Phase 3: production

- **Storylines.** Quest chains detected from prerequisites in your log, which you name and order as story arcs.
- **Script workspace.** A storyline's quest text, NPC dialogue and books pulled into one place to narrate from. You write around the primary sources you actually read.
- **Episode ladder per zone:** shorts (single moments, from marks), a zone episode (the zone's arcs), and contributions to a long-form pool (longplay segments and sleep compilations built from *shot* marks and quiet travel).
- **Clip lists.** For an episode, the exact in/out points of every quest in its storylines, exported as a Premiere sequence.
- Progress measured in **episodes shipped**, not completion percentage.

## Phase 4: on-screen data

- **Item cards** rendered from the logged item data (name, quality colour, icon, type, item level), exported as transparent PNGs timed to the loot moment.
- **Kill counter overlays** rendered as transparent video from `kills.csv`, so they drop straight onto the timeline.
- **Quest title cards** at accept and turn-in.

## Phase 5: every expansion

The addon and companion already carry the client version on every session, and the Codex groups by expansion. What each new era needs:

- The quest database for that expansion (Phase 2).
- Chromie Time and level-scaling awareness for retail, where the same zone can be played at any level.
- Retail-only events worth logging: in-game cinematics by ID, campaign chapters, world quests (probably excluded from "every quest"), and dialogue from talking heads.
