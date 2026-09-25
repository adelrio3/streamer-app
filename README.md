# Chronicler

A companion for playing through World of Warcraft on camera. You play once, record everything, and Chronicler keeps the notes for you.

- **The addon** (`addon/Chronicler`) runs in game and logs, with timestamps accurate to about a frame:
  - every quest's full text as you read it (description, objectives, progress, completion), who gave it, where, and at what level
  - NPC speech, yells and emotes, gossip text, books and plaques page by page, cinematics
  - every kill (creature ID, killing blow or not), every item looted, received or crafted (with quality, item level and icon)
  - zone and subzone changes, discoveries, level-ups, deaths, spells and recipes learned, skill-ups
  - **marks**: one key press flags a moment as *lore beat*, *beautiful shot*, *funny* or *redo*
  - **sync flash**: a white flash and sound that lines footage up exactly
- **The web app** (`web/`, hosted on Netlify, data in Supabase) is open in Chrome on each computer and bridges them:
  - on the **gaming PC** it watches the addon's log, uploads new play sessions, and installs or updates the addon for you
  - on the **recording computer** it listens to OBS for when each recording starts and stops, and reads the recordings folder
  - both computers measure their clocks against the server, so game events land on the right second of footage automatically, and a sync flash makes it exact
  - the Codex: every quest, creature, NPC, item, text and mark, each with a ▶ link into the footage
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
| `/chron clear` | Empty the addon's log once it has been uploaded, to keep the SavedVariables file small |

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
