# Chronicler

A companion for playing through World of Warcraft on camera. You play once, record everything, and Chronicler keeps the notes for you.

- **The addon** (`addon/Chronicler`) runs in game and logs, with timestamps accurate to about a frame:
  - every quest's full text as you read it, who gave it, its rewards, where, and at what level
  - NPC speech, gossip, books and plaques page by page, cinematics
  - **every NPC and creature near you**: targeted, moused over, on a nameplate, fighting within combat-log range, or speaking; with level, elite/rare rank, type, family, reaction and subtitle. `/chron scanner on` adds invisible nameplates to catch everything within about 40 yards
  - **every loot window**: what dropped and from whom (including what you left behind), coins, herbs, ore and chests
  - **a full item catalog**: every tooltip line (flavor text included), stats, sell price, icon, use effect, for anything you loot, see, buy, wear, carry or hover
  - **vendors** with stock, prices, limited quantities and item costs; **trainers** and their prices; **flight masters**, routes and costs, flights taken; hearthstone location
  - **fights**: duration, damage dealt and taken, abilities, enemies, close calls, and who killed you
  - **your character over time**: gear and every change, talents, stats per level, reputation, gold with where it came from, XP, skills and bags
  - **position and state every 2 seconds** (mounted, flight path, UI hidden, indoors, swimming, in-game time of day) for the footage finder
  - **automatic screenshots** at rares, level-ups, discoveries and deaths, plus your own
  - optional group, duel and chat logging (`/chron social on`)
  - **marks** (lore beat, beautiful shot, funny, redo) and the **sync flash**
- **The web app** (`web/`, hosted on Netlify, data in Supabase) is open in Chrome on each computer and bridges them:
  - on the **gaming PC** it watches the addon's log, uploads new play sessions, and installs or updates the addon for you
  - on the **recording computer** it listens to OBS for when each recording starts and stops, and reads the recordings folder
  - both computers measure their clocks against the server, so game events land on the right second of footage automatically, and a sync flash makes it exact
  - **Chronicle**: Overview (activity, status, recent milestones), Characters (each one's journey with a class-coloured hero and XP ring), Quests (each with a map of pickup, objectives, kills while active, turn-in and route), Zones (with a loose-ends checklist: quests not turned in, rares and creatures never killed, shops and trainers never opened), Locations (zone maps with layers, creature-density and time-spent heat, nearest services on click, your own map images cropped in the app, GeoJSON export), Lore (every text and line of dialogue, filterable by zone for scripts)
  - **World**: Bestiary (creatures you can fight, drop rates, every sighting's coordinates and density), People (quest givers, vendors, trainers, flight masters, townsfolk), Items (icons, full tooltips, every source) and the herbs, ore and chests you opened
  - **Footage**: Recordings (with a live map: a marker follows the video, click the route to jump), a Highlights reel, Footage finder, Screenshots, Marks (deletable); every entry links to the second of footage it happened in
  - **This computer › Start over** deletes everything and blocks old sessions from returning
  - one search box across all of it
  - per recording: **Premiere markers** (.xml), **captions** (.srt), **kill counter data** (.csv), **YouTube chapters** and a full event list

Videos never leave the recording computer. Only the logs and recording times are stored in Supabase.

## Setup

One-time, in a browser:

1. **Supabase:** create a project and run [`supabase/schema.sql`](supabase/schema.sql) in its SQL Editor.
2. **Netlify:** import this repository as a site and connect it to the Supabase project (the Supabase extension sets the keys; or add `SUPABASE_URL` and `SUPABASE_ANON_KEY` as environment variables). [`netlify.toml`](netlify.toml) has the rest.
3. Open the site in **Chrome** on each computer (Edge also works on Windows), create your login on the first one, and follow the **This computer** page.

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
| `/chron clear` | Empty the addon's log once it has been uploaded. Sessions older than 30 days are dropped automatically |

Key bindings: Options › Keybindings › AddOns › Chronicler.

WoW only writes the addon's log to disk on logout or `/reload`; the app uploads it a few seconds later.

## Where things live

```
addon/Chronicler/        the WoW addon (Lua)
web/                     the web app Netlify publishes
web/lib/                 SavedVariables parser, sessions, clock bridge and timelines, codex, exports,
                         OBS link, folder access, Supabase storage, this computer's background jobs
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
```
