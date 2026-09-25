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

1. **Install the addon.** Copy `addon/Chronicler` into `World of Warcraft\_classic_era_\Interface\AddOns\` (or `_anniversary_`, `_classic_`, `_retail_`). The `.toc` covers Classic Era 1.15.9 (interface 11509) and the next few patches. After a bigger patch, check the number in game with `/dump select(4, GetBuildInfo())`, run `npm run add-interface -- <number>` and copy the folder again (or tick *Load out of date AddOns* in the meantime).
2. **Bind the mark keys.** Open Game Menu › Key Bindings › AddOns › Chronicler.
3. **Start the companion.** Double-click `start.cmd` (Windows) or run `./start.sh`. From a terminal you can run `npm run open`. It opens <http://127.0.0.1:4050>.
4. **Setup page.** Enter your WoW folder and your OBS recordings folder. Optionally enable the OBS connection: in OBS, go to Tools › WebSocket Server Settings and enable the server, then enter its port and password here.

WoW only writes addon data to disk when you log out or `/reload`. The companion watches the file and ingests on its own a few seconds later. There is also an **Ingest** button.

## Recording on a second PC

If OBS runs on a separate streaming/recording PC, the two machines' clocks disagree and the capture chain adds a small delay. Two ways to line things up, and you can use both:

1. **Sync flash (always works).** Start recording, then press your **Sync** key (or `/chron sync`). The screen flashes white for a quarter second with a raid-warning sound, and the addon logs the exact moment. It still shows with the UI hidden (Alt+Z). In the companion, open the recording, pause on the first white frame (use the frame-step buttons, or type the time from your editor), and press **Line up with sync flash**. That measures both the clock gap and the capture delay. Other recordings from the same days that you didn't flash reuse the measured gap automatically (*sync-inferred*), but flashing after every start is the most exact.
2. **OBS over your network (automatic).** Run the companion on the **gaming PC**, enable OBS's WebSocket server on the recording PC, and put the recording PC's IP address as the OBS host on the Setup page. The companion then timestamps each start and stop with the gaming PC's clock. Recordings are matched to OBS by file name, so the recordings folder can be a network share or a copy.

The recordings folder just has to be reachable from wherever the companion runs: a network share of the recording PC's output folder is simplest.

## In game

| Command | What it does |
|---|---|
| `/chron` | How much has been logged, and whether the clock is calibrated |
| `/chron mark lore <note>` | Mark a lore beat. Other kinds: `shot`, `funny`, `redo`, or leave the kind out |
| `/chron note <text>` | A mark with a note |
| `/chron sync` | Sync flash and sound, for recordings made on another PC (also a key binding) |
| `/chron silent` | Stop marks from printing to chat (so it stays out of footage) |
| `/chron clear` | Empty the addon's log once the companion has ingested it, to keep the SavedVariables file small |

The companion keeps its own copy of everything it has ingested, in `data/`. Clearing the addon never loses anything the companion has already seen.

## If `/chron` does nothing

- **Nothing at all** means WoW didn't load the addon. Check that the path is exactly `Interface\AddOns\Chronicler\Chronicler.toc` (the GitHub ZIP adds extra folders around it), that it is ticked in the character screen's AddOns list, and that *Load out of date AddOns* is ticked if it is marked out of date.
- **"installed but its main file failed to load"** means a Lua error. Type `/console scriptErrors 1`, `/reload`, and copy the error.
- When it works, you see *Chronicler is logging* in chat after logging in.

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
