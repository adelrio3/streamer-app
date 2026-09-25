# Chronicler

A companion for playing through World of Warcraft on camera. You play once, record everything, and Chronicler keeps the notes for you.

- **The addon** (`addon/Chronicler`) runs in game and logs, with timestamps accurate to about a frame:
  - every quest's full text as you read it (description, objectives, progress, completion), who gave it, where, and at what level
  - NPC speech, yells and emotes, gossip text, books and plaques page by page, cinematics
  - every kill (creature ID, killing blow or not), every item looted, received or crafted (with quality, item level and icon)
  - zone and subzone changes, discoveries, level-ups, deaths, spells and recipes learned, skill-ups
  - **marks**: one key press flags a moment as *lore beat*, *beautiful shot*, *funny* or *redo*
- **The companion** (`companion/`) reads that log, finds your OBS recordings and lines them up. For any quest, creature, item, line of dialogue or mark, it can jump to the exact second in the footage. For each recording it exports:
  - **Premiere markers** (Final Cut Pro XML): a sequence of the recording with one marker per event
  - **Captions** (.srt): the same events as a caption track
  - **Kill counter data** (.csv): running counts per creature, per video and lifetime
  - **YouTube chapters** from zone changes, ready for a raw longplay upload
  - **Every event** as .csv

You don't need a scout run or hand-written notes. The Codex fills itself as you play.

## Setup

Requires [Node.js](https://nodejs.org) 22 or newer. There are no other dependencies.

1. **Install the addon.** Copy `addon/Chronicler` into `World of Warcraft\_classic_era_\Interface\AddOns\` (or `_anniversary_`, `_classic_`, `_retail_`). If the character screen says the addon is out of date, tick *Load out of date AddOns*. The `.toc` lists the interface versions known at the time of writing.
2. **Bind the mark keys.** Open Game Menu › Key Bindings › AddOns › Chronicler.
3. **Start the companion.** Double-click `start.cmd` (Windows) or run `./start.sh`. From a terminal you can run `npm run open`. It opens <http://127.0.0.1:4050>.
4. **Setup page.** Enter your WoW folder and your OBS recordings folder. Optionally enable the OBS connection: in OBS, go to Tools › WebSocket Server Settings and enable the server, then enter its port and password here.

WoW only writes addon data to disk when you log out or `/reload`. The companion watches the file and ingests on its own a few seconds later. There is also an **Ingest** button.

## In game

| Command | What it does |
|---|---|
| `/chron` | How much has been logged, and whether the clock is calibrated |
| `/chron mark lore <note>` | Mark a lore beat. Other kinds: `shot`, `funny`, `redo`, or leave the kind out |
| `/chron note <text>` | A mark with a note |
| `/chron silent` | Stop marks from printing to chat (so it stays out of footage) |
| `/chron clear` | Empty the addon's log once the companion has ingested it, to keep the SavedVariables file small |

The companion keeps its own copy of everything it has ingested, in `data/`. Clearing the addon never loses anything the companion has already seen.

## Recording tips

- Record in **Hybrid MP4** (OBS 30.2+) or remux MKVs (File › Remux Recordings) if you want the in-browser player to work. Timestamps and exports work with any format.
- Keep OBS's default file name format, or put yours in the Setup page. The companion reads each recording's start time from the file name. With the OBS connection enabled it logs the exact start and stop instead, including automatic file splits.
- If markers consistently land early or late, set a clock correction on the Setup page.

## Using the exports in Premiere

- **Markers.** File › Import the `.xml`. You get a sequence containing the recording with every event as a marker. Marker names start with the category (`[quest]`, `[lore]`, `[combat]`, `[loot]`, `[mark]`…), so you can filter them in the Markers panel. On the recording page you can untick categories first, for example to export only marks and lore.
- **Captions.** Import the `.srt` and drop it on the timeline. You can read every event while you scrub.
- **Kill counter.** `kills.csv` has, for each kill, the timecode and the running count. Drive a counter overlay from it in After Effects or with a script.

## Where things live

```
addon/Chronicler/     the WoW addon (Lua)
companion/server.js   entry point: serve (default), ingest, export
companion/src/        SavedVariables parser, ingest, recordings, codex, exports, OBS link, HTTP API
companion/public/     the web UI
data/                 your ingested sessions, settings, OBS log and exports (not committed)
test/                 node --test suites; test/addon/harness.lua runs the addon against a fake WoW client
```

## Development

```
npm test
```

The addon tests run the real `Chronicler.lua` in Lua 5.1 against a simulated WoW API. They are skipped if no `lua5.1`/`luajit`/`lua` is installed. The simulation can't prove the addon works in the real client, only that its logic is right. See [docs/ROADMAP.md](docs/ROADMAP.md) for what to check on the first real session, and for what comes next.
