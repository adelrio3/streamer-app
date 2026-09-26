# Chronicler

A companion for playing through World of Warcraft on camera. You play once, record everything, and Chronicler keeps the notes for you.

- **The addon** (`addon/Chronicler`) runs in game and logs, with timestamps accurate to about a frame:
  - every quest's full text as you read it, who gave it, its rewards, where, and at what level
  - NPC speech, gossip, books and plaques page by page, cinematics
  - **every NPC and creature near you**: targeted, moused over, on a nameplate, fighting within combat-log range, or speaking; with level, elite/rare rank, type, family, reaction and subtitle. `/chron scanner on` adds invisible nameplates to catch everything within about 40 yards
  - **every loot window**: what dropped and from whom (including what you left behind), coins, herbs, ore, chests and anything else you open (a cactus, a crate), named from the tooltip or the opening cast and remembered for every later session
  - **a full item catalog**: every tooltip line (flavor text included), stats, sell price, icon, use effect, for anything you loot, see, buy, wear, carry or hover
  - **vendors** with stock, prices, limited quantities and item costs; **trainers** and their prices; **flight masters**, routes and costs, flights taken; hearthstone location
  - **fights**: duration, damage dealt and taken, abilities, enemies, close calls, and who killed you
  - **your character over time**: gear and every change, talents, stats per level, reputation, gold with where it came from, XP, skills and bags
  - **position and state every 2 seconds** (mounted, flight path, UI hidden, indoors, swimming, in-game time of day) for the footage finder
  - **automatic screenshots** at rares, level-ups, discoveries and deaths, plus your own
  - optional group, duel and chat logging (`/chron social on`)
  - **marks** (lore beat, beautiful shot, funny, redo) and the **sync flash**
  - the **live link**: the addon writes what happens into the game's chat log as hidden lines, so the file carries it out as you play; `/chron live off` stops it
  - every **Lua error** it catches (its own and other addons'), with the stack and where you were: `/chron errors`
- **The web app** (`web/`, hosted on Netlify, data in Supabase) is open in Chrome on each computer and bridges them:
  - on the **gaming PC** it watches the addon's log, uploads new play sessions, and installs or updates the addon for you
  - on the **recording computer** it listens to OBS for when each recording starts and stops, and reads the recordings folder
  - both computers measure their clocks against the server, so game events land on the right second of footage automatically, and a sync flash makes it exact
  - **Chronicle**: Overview (a live feed of the game as it happens, playtime, gold, level and quest charts, status, recent milestones), Characters (each one's page: a Dashboard of where they stand right now, Progress with the class-coloured XP ring, gear, talents, stats, quests and recordings, Places with the zones visited and maps explored, and a Journal in the character's own words, one entry per outing, as long as the outing deserved), Lore (the heart of it: every storyline lived to its end retold as a young-adult narrative with a whole arc, about an unnamed adventurer rather than any one character, on a treasure-chest shelf; the class-only chapters rolled into one event, the ones still being lived waiting beside them; books, plaques and everything overheard behind the Texts tab)
  - **World**, a wiki built from first-hand experience: only what you have come across, measured against everything in Classic. Names stay grey until done (a creature until killed, with your kill count in the name; a person until met; an item until obtained; a quest until turned in). Locations (an RPG-style menu: continents → zones → the zone's page with its map, the areas you discovered, its quests, people and creatures), Quests (the same menu with quest completion by zone, plus class, profession and event quests), Storylines (the quest chains you have set foot in, as chapters, with a Markdown outline for writing an episode), Bestiary (by kind), People (by zone), Items (kinds → types → the items you have come across, quest items last), Gathering. The sidebar shows each section's percentage of the whole game.
  - **Footage**: Recordings (with a live map: a marker follows the video, click the route to jump), a Highlights reel, Footage finder, Screenshots, Marks (deletable), Narration (what you said, transcribed on the gaming PC as you spoke); every entry links to the second of footage it happened in; Shorts (the moments worth a vertical, with a 9:16 Premiere sequence each) and Episodes (a zone episode assembled from every recorded stretch spent there, with quest markers and chapters); the map page has a Route replay that renders your route as B-roll (WebM or PNG sequence).
  - **Stream**: Live overlay (OBS browser sources fed as you play: drop toasts with icons and effects by rarity, a quest tracker that fills in as objectives update, item counters for this session or all time, kills and streaks, deaths, levels and zone callouts; each widget in its own window to place as you like, or all in one; a chroma key colour for feeds without transparency; colours, textures and particle effects that follow the race of the character playing, Human to Troll; pop-out previews and test buttons) and Drops (everything that dropped in any stretch of time, CSV)
  - **This computer › Start over** deletes everything and blocks old sessions from returning
  - one search box across all of it
  - per recording: **Premiere markers** (.xml), **captions** (.srt), **narration captions** (.srt), **kill counter data** (.csv), **YouTube chapters**, a full event list, and an **overlay pack**: transparent PNG item cards, quest and level banners and a kill counter, with an XML sequence that places them on the tracks above the recording
  - **This computer › Addon errors**: every Lua error the addon caught, with a one-click dump to paste into a bug report

Videos never leave the recording computer. Only the logs and recording times are stored in Supabase.

## Setup

One-time, in a browser:

1. **Supabase:** create a project and run [`supabase/schema.sql`](supabase/schema.sql) in its SQL Editor (run it again after updating: it only adds what is missing). Under **Authentication › URL Configuration** set the **Site URL** to the site's address (the Netlify address you open) and add it to **Redirect URLs** too; otherwise confirmation and sign-in emails send you to `localhost:3000`.
2. **Netlify:** import this repository as a site and connect it to the Supabase project (the Supabase extension sets the keys; or add `SUPABASE_URL` and `SUPABASE_ANON_KEY` as environment variables). [`netlify.toml`](netlify.toml) has the rest.
3. Open the site in **Chrome** on each computer (Edge also works on Windows), create your login on the first one (a password, or an emailed sign-in link), and follow the **This computer** page.

Every push to the branch Netlify builds is live a minute later. The addon updates from the app too: **This computer › Update addon**, then `/reload` in game.

## In game

| Command | What it does |
|---|---|
| `/chron` | How much has been logged, and whether the clock is calibrated |
| `/chron sync` | Sync flash and sound (also a key binding): press right after starting a recording |
| `/chron mark lore <note>` | Mark a lore beat. Other kinds: `shot`, `funny`, `redo`, or leave the kind out |
| `/chron note <text>` | A mark with a note |
| `/chron silent` | Stop marks from printing to chat (so it stays out of footage) |
| `/chron scanner on\|off` | Log every NPC within about 40 yards using invisible nameplates (changes your nameplate settings; `off` restores them) |
| `/chron shots on\|off` | Automatic screenshots at rares, level-ups, discoveries and deaths (on by default) |
| `/chron social on\|off` | Also log group, duels and chat (off by default) |
| `/chron track on\|off` | Position tracking for the footage finder (on by default) |
| `/chron items` | Size of the item catalog |
| `/chron live on\|off\|test` | The live link for the stream overlay (on by default; writes hidden lines to the chat log and turns chat logging on; `pad KB` sets how much filler follows each line, since the game writes the file only when its 64 KB buffer fills; the app on the gaming PC empties the file once it is over 1 MB and you have been logged out for 3 minutes). `test` sends a line the Live overlay page confirms and the overlay shows as LIVE LINK OK; `/chron live` alone prints the addon's status |
| `/chron errors [clear]` | Lua errors caught so far; the web app collects them under This computer › Addon errors |
| `/chron clear` | Empty the addon's log once it has been uploaded. Sessions older than 30 days are dropped automatically |

Key bindings: Options › Keybindings › AddOns › Chronicler.

WoW only writes the addon's log to disk on logout or `/reload`; the app uploads it a few seconds later.

## Where things live

```
addon/Chronicler/        the WoW addon (Lua)
web/                     the web app Netlify publishes (overlay.html is the OBS browser source)
web/lib/                 SavedVariables parser, sessions, clock bridge and timelines, codex, exports,
                         OBS link, folder access, Supabase storage, this computer's background jobs,
                         the quest database (questdb.js), the live link (live.js), voice notes,
                         the overlay pack (overlaypack.js, zip.js)
web/data/classic/        every Classic quest, quest giver, rare and zone (from Questie, GPL-3.0),
                         generated by tools/import-questie.js
netlify/functions/       hands the browser the Supabase URL and public key
supabase/schema.sql      database tables and access rules
tools/                   build step (copies the addon into the site), local dev server, add-interface
test/                    node --test suites; test/addon/harness.lua runs the addon against a fake WoW client
```

## Development

```
npm test          # all tests (addon tests need lua5.1)
npm run serve     # the web app at http://127.0.0.1:8888 (paste Supabase URL and key when asked)
npm run add-interface -- 11510   # after a WoW patch changes the interface number
node tools/import-questie.js ../QuestieDB ../Questie   # refresh web/data/classic from Questie's repos
```
