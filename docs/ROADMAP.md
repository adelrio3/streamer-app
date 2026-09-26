# Roadmap

The mission: every quest in the game, across every expansion, including class and profession quests. The footage and a first-hand Codex are what that mission produces. The channel is built from them in three formats: shorts, zone episodes, and long-form longplays and sleep content.

## Phase 1: capture (this release)

The addon logs everything and the web app ties it to footage across two computers. No scout pass and no notes by hand.

### First real session checklist

1. Gaming PC: the web app shows the WoW folder as watched and the addon as installed (This computer page).
2. Recording Mac: the web app shows OBS as connected and the recordings folder chosen.
3. Start recording on the Mac, press the Sync key in game, then pick up a quest, kill a few mobs, loot, talk to an NPC, read a plaque, and press a mark key.
4. Stop recording, `/reload` in game. Within a minute the session appears on both computers (Sessions page) and the recording shows events (Recordings page).
5. On the Mac, open the recording, line it up with the flash, click a few events: the video should land within a frame or two.
6. Download the Premiere markers (.xml) and import them in Premiere.

## Locations (done)

Zone maps with layers (quests, creatures, people, vendors, gathering, loot, deaths and close calls, lore, marks/screenshots/level-ups, route), creature-density and time-spent heat, per-quest maps with kills while active and objective progress, per-creature sighting maps with density, a live position marker on recording pages, own map images cropped in the app.

## Captured since 0.3.0

NPCs near you, loot windows and drop rates, the full item catalog, vendors, trainers, flight masters, fights, character progression, the 2-second position track, screenshots and optional social logging; with Characters, Bestiary, Items, Vendors, Highlights, Footage finder, Screenshots and global search in the web app.

## Next ideas

- Import WoW's own combat log (`/combatlog`) for exact fight replays.
- Mic on its own OBS track, transcribed and lined up with game events.
- Near-live markers in OBS through WoW's chat log file.
- Per-zone coverage: subzones visited vs. not, and quests seen but not done, as a checklist for completionists.
- Route on the recording page synced to the video (done) extended with a scrub-to-position: click the map to jump the video to when you were there.
- Item cards and kill counters rendered as overlays (Phase 4).

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

The addon and web app already carry the client version on every session, and the Codex groups by expansion. What each new era needs:

- The quest database for that expansion (Phase 2).
- Chromie Time and level-scaling awareness for retail, where the same zone can be played at any level.
- Retail-only events worth logging: in-game cinematics by ID, campaign chapters, world quests (probably excluded from "every quest"), and dialogue from talking heads.
