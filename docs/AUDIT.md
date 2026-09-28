# Compendium: independent code audit

Date: 2026-09-28. Branch audited: `claude/wizardly-allen-e8wtuw` at commit `3454082`.

How to read this document:

- **VERIFIED** means I ran, tested or reproduced it in this Linux container (Node 22, Lua 5.1, no browser, no macOS, no OBS, no real video files, a fake Supabase). Every VERIFIED item names the script or command.
- **READ** means I traced it in the code and I am stating what the code would do. It has not been executed. Where it matters, I say what to run on the real machines to settle it.
- Nothing written *about* the project (CLAUDE.md, README.md, docs/, comments) was trusted. Section 7 lists where those documents and the code disagree.
- Line numbers are for the commit above. `file:line` references are clickable in most editors.
- The experiment scripts I used are reproduced in Appendix B so anyone can rerun them.

No file other than this one was changed.

---

## 1. `npm test`

First run, as the container came (no Lua interpreter):

```
# tests 97
# suites 0
# pass 95
# fail 0
# cancelled 0
# skipped 2
# todo 0
# duration_ms 1657.641258
```

The two skipped tests, both with the reason `no Lua interpreter installed`:

- `addon logs a full play session` (test/addon.test.js)
- `what the real addon sends decodes end to end` (test/live.test.js)

After `apt-get install -y lua5.1`, second run:

```
# tests 97
# pass 97
# fail 0
# skipped 0
```

VERIFIED. All tests pass. Note what the suite does *not* cover (Section 3 and 5 depend on this): there is no test of `web/lib/machine.js` at all (the folder scan, the stream-session follower, the cloud refresh, the settings writes), none of `app.js` (the batch, the session package, the pages), none of the shrinker scripts. CLAUDE.md says a two-computer smoke test lives "in the session scratchpad, not the repo"; that scratchpad belongs to a previous cloud session and is empty in this one (VERIFIED: `ls` of the scratchpad directory returned nothing), so that test no longer exists anywhere.

---

## 2. Map of the project

```
addon/Compendium/ (Lua 5.1, ~1,870 lines)
  Boot.lua        fallback /comp when Compendium.lua fails to load
  Compendium.lua  sessions, wall-clock anchor (time() + GetTime()), quests, lore,
                  kills, marks, sync flash, error capture, slash commands
  Capture.lua     NPCs, loot windows, item catalog, vendors, trainers, flights,
                  2-second position track, fights, character snapshots, social
  Live.lua        the live link: packs events into hidden CHRON1~ chat lines,
                  pads ~80 KB so the game flushes its chat log, heartbeat every 60 s
  → writes CompendiumDB (SavedVariables) at logout//reload, and Logs\WoWChatLog.txt as you play

web/ (no build step; Netlify publishes it; tools/build-web.js copies the addon into web/addon)
  index.html + app.js (4,249 lines)   the whole UI: router, every page, the batch, the
                                       session package, This computer, login
  overlay.html + overlay.js (621)      OBS browser source; polls live_state() every 1–2 s
  lib/
    machine.js (938)   what each computer does in the background: clock samples,
                       SavedVariables watch + upload (PC), chat-log tail + live row (PC),
                       recordings folder scan + OBS link + Source Record toggle (Mac),
                       cloud refresh every 10 s/60 s, stream-session follower
    cloud.js (262)     CloudStore over supabase-js; measureClock
    folders.js (173)   File System Access API: pick/remember folders, list videos, install addon
    timeline.js (256)  clockModel, startFromName, recordingRole, resolveRecordings
                       (parts + companions), aligner, buildTimelines
    sessions.js/luasv.js  parse SavedVariables → sessions; mergeSession
    live.js (336)      chat-log decoding, LiveState (the overlay's running totals)
    obs.js (141)       obs-websocket v5 client
    mov.js (72)        mvhd creation time + duration from QuickTime/MP4 box headers
    mp4.js (183)       streaming MP4 writer for WebCodecs output
    overlayvideo.js (803)  OverlayScene + renderOverlayVideo (the session package's overlay)
    exports.js (264)   FCP7 XML (markers, parts, companions), SRT, CSV, chapters
    codex.js, world.js, journey.js, maps.js, questdb.js, story.js, coverage.js,
    roster.js, search.js, narrative.js, tales.js, shorts.js, episode.js, replay.js,
    overlaypack.js, zip.js, voice.js, describe.js, footage.js
  data/classic/*.json (3 MB)  quest database from Questie (spawns.json 0.5 MB is never loaded)
  shrink/install.sh + shrink.sh   launchd helper on the Mac: ProRes cam → HEVC via ffmpeg

supabase/schema.sql   tables sessions, recordings (PK user_id+name), clock_samples, settings
                      (one JSON blob per user), items, tracks, live, voice; RPCs server_time,
                      live_state(token, seq)
netlify/functions/config.mjs   hands the browser the Supabase URL + anon key
tools/                build-web.js, serve.js, add-interface.js, import-questie.js
test/                 97 node:test tests + a Lua harness that runs the real addon
undefined/            48 PNG screenshots (14 MB) committed by mistake (see 6.4)
```

Data flow and dependencies:

```
                 gaming PC (Chrome)                        recording Mac (Chrome)
 WoW addon ──SavedVariables──▶ machine.pollWow (5 s) ─┐   folder scan machine.scanRec (20 s)
 WoW addon ──chat log───────▶ machine.pollLive (1 s) ─┤   OBS websocket (optional)
                                                      ▼          │
                                         Supabase: sessions, tracks, items, recordings,
                                         clock_samples, settings, live, voice
                                                      ▲          │
 machine.refresh (10 s when live is on) ◀─────────────┴──────────┘ machine.refresh (60 s)
 followRecordings → LiveState.reset/session events → live row → overlay.js (OBS browser source)

 app.js derived(): rows → resolveRecordings → recordings (game only, with parts + companions)
                   sessions + recordings + clock → buildTimelines → codex, world, characters, maps
                   everything else (wiki pages, exports, batch, package) reads derived()
```

The parts that matter most for the owner's three goals:

- **Recording**: machine.js `scanRec`, `followRecordings`, `setSourceRecord`; timeline.js `startFromName`, `resolveRecordings`; mov.js.
- **Editing**: exports.js `toFCPXML`; app.js `buildSessionPackage`, `runBatch`, `outstandingPackages`; overlayvideo.js; shrink.sh.
- **Wiki**: world.js, codex.js, questdb.js, app.js pages (`derived()`), and the "never show the undiscovered" rule.

---

## 3. Bugs and logic errors, ranked by impact

### B1. Recording rows are keyed by file name alone, so a camera file with the same name as the gameplay file swallows it (VERIFIED)

Where: `supabase/schema.sql:37` (`primary key (user_id, name)`), `web/lib/machine.js:670` (`this.row(v.name)` in `scanRec`), `web/lib/machine.js:657-664` (the "replaced" logic keys on `stem(name)`), `web/lib/folders.js:152-158` (`folderOfVideo` finds a file by name only, first match wins), `web/lib/cloud.js:139-144` (`saveRecording` upserts on `user_id,name`).

Why it matters here: two Source Record filters, one writing the gameplay file at the top of the folder and one writing the camera into a `cam` subfolder (which is exactly what This computer suggests, `web/app.js:3746`), both start in the same second and both default to OBS's `%CCYY-%MM-%DD %hh-%mm-%ss` name. Then:

- Different extensions (gameplay `.mov`/`.mp4`, camera `.mov`) keep them apart until the shrinker runs. The shrinker writes `cam/<same name>.mp4` (`web/shrink/shrink.sh:42`). If the gameplay is `.mp4`, the two files now share a name.
- Simulation `sim2b.mjs` (Appendix B): gameplay `X.mp4` + `cam/X.mov` → listed correctly as a game recording with a camera companion. After the shrinker replaces the `.mov` with `cam/X.mp4`: **one row remains, classified `cam`, the gameplay recording is gone from the Recordings page, and both files show `listed` on This computer with no warning.**
- Simulation `machine-sim.mjs` case 1: `X.mkv` at the top and `cam/X.mkv` → one row, role `cam`, no game recording.

If the gameplay is `.mov` and the camera `.mov`, the shrunk `cam/X.mp4` pairs correctly (case 2 of the same script) because the names still differ. So the outcome depends on which container the gameplay filter writes and on the two filters' filename formats. **Question for the owner** (Section 9).

### B2. The settings row is written whole by whichever computer saved last, and never re-read; a save on one computer silently reverts the other's changes (VERIFIED)

Where: `web/lib/cloud.js:152-154` (`saveSettings` upserts the entire `data` object), `web/lib/machine.js:479-494` (`collectErrors` saves the PC's copy whenever the addon caught a Lua error, its own or another addon's), `web/lib/machine.js:462-467` (`liveToken`), `web/app.js:3884` (Mac: session package options), `web/app.js:3921-3923` (recording size), `web/app.js:3856-3859` (`resetAt`), `web/app.js:1535` (`deletedSessions`), `web/app.js:2729`, `2763`, `2509`, `3524`. Settings are loaded once in `startApp` (`web/app.js:4176-4185`); `machine.refresh` (`web/lib/machine.js:840-874`) reloads sessions, recordings, items and voice, never settings.

Reproduced in `machine-sim.mjs` case 4: the Mac saves `sessionPack.shrinkCam = true`; the PC then records one addon error; the cloud row now has `sessionPack = undefined`. On the Mac's next reload the shrinker option, the package size, the folder path are gone. The same happens to the recording width/height (4K set on the Mac, reverted by the PC), the overlay layout and counters (set on the PC, reverted by a Mac save), `resetAt` and `deletedSessions`.

A second consequence (READ): **"Delete everything" on the PC is invisible to the Mac until the Mac reloads.** `scanRec` keeps `resetAt` from its own stale copy (`web/lib/machine.js:690`), so on its next pass (within 20 s) it re-creates a `recordings` row for every old file in the folder, and those rows outlive the reset.

### B3. The stream-session follower breaks at OBS's 45-minute file split under two orderings (VERIFIED)

Where: `web/lib/machine.js:882-927` (`followRecordings`), the chain walk at 892-898, the new-session block at 903-911, the stop at 913-921; `web/lib/machine.js:27` (`CONTINUES_MS = 3000`) and `web/lib/timeline.js:166` (`CONTINUES = 3000`).

- (a) If the first part's length reaches the cloud before the second part's row does, the PC fires `session stop` ("SESSION COMPLETE" on stream) 45 minutes in, and the session never resumes: when part 2 appears its chain head is the same file, `newest.start_ms > f.start` is false, and `f.ended` stays true (`machine-sim.mjs` case 5). The usual Mac order is the safe one (part 2 is listed as "under way" within 20 s of the split, part 1 gets its length only 45 s after its last write), so this needs the Mac tab to have been closed or asleep across the split and to list part 1 before part 2 when it catches up, with the PC's 10-second refresh landing between the two `putRow` calls. Unlikely per split, plausible over a season.
- (b) If part 2's start is more than 3 s after part 1's end, the chain breaks and the PC starts a **new** session: counters reset, "SESSION START" again, and the Journal cuts the outing in two (`machine-sim.mjs` case 6, `misc.mjs` case C). Both times come from file names with 1-second resolution and the first part's length from the movie header, so a 4-second gap only needs OBS to take a moment over the split. I cannot measure the real gap here; Appendix A says how.

### B4. A camera that starts more than 5 seconds after the gameplay is silently dropped from the edit (VERIFIED)

Where: `web/lib/timeline.js:126` (`COMPANION_SLACK = 5000`) and `:199`. A camera file must begin no more than 5 s after the **first** part of the game recording and cover its first 30 s. `misc.mjs` case A: camera starting 6 s late → no companion, the camera is not listed anywhere, the session package XML has no camera track, and nothing on screen says so. With one-click recording the filters are switched one after another in a loop (`web/lib/machine.js:822-835`), so the gap is normally well under a second, but a camera filter enabled by hand, or OBS taking a few seconds to spin up the ProRes encoder, is enough. A camera file that pairs with nothing is simply invisible.

### B5. A package that fails is retried forever by the overnight batch (READ)

Where: `web/app.js:3352-3361` (`outstandingPackages` excludes a recording only when `packs[name].overlay` exists), `web/app.js:3337-3339` (a failure stores `{ failed }`, no `overlay`), `web/app.js:3417-3420` (on failure: toast, 3-second sleep, `batch.done++`, `continue`). The next loop iteration finds the same recording first, builds it again, fails again. A render that fails deterministically (the browser refusing a 4K encoder configuration, `web/lib/overlayvideo.js:763`; an item-art fetch that throws) keeps the Mac busy all night, toasting every three seconds, while every later package waits behind it. `autoPack` does the opposite (`web/app.js:3483`: `!packs[r.name]` excludes failures forever). Two parts, two policies.

### B6. Without write access to the folder the batch waits 20 minutes for a shrinker it never started, then gives up; the go-flag can outlive the batch (READ)

Where: `web/app.js:3393-3401`: if Chrome refuses write access, a toast says so, but the loop continues; with `shrinkCam` on, every outstanding recording still has a `.mov` camera (`camMovs`), so nothing is `ready`, and the wait branch runs until the 20-minute give-up (`:3455-3458`). Nothing is built. Also, the flag file is removed only on Stop (`:3463`); on a give-up (20 min / 3 h) it stays in the folder, and the helper will start on its own the next time it can read the folder (after the owner grants Full Disk Access, say), which contradicts "nothing heavy runs on its own".

### B7. The shrinker's fallback moves a ProRes file across volumes into the boot disk's Trash (READ)

Where: `web/shrink/shrink.sh:52`: `osascript … Finder … delete` first, else `mv "$SRC" "$HOME/.Trash/"`. From a launchd job, telling Finder to delete a file needs an Automation permission for `bash → Finder` that a background job cannot ask for, so the fallback is likely. `mv` from `/Volumes/Project/Game Capture` to `~/.Trash` is a copy across file systems: a 60–100 GB ProRes file copied onto the Mac mini's internal drive, then deleted from the external one. The Finder would have used `/Volumes/Project/.Trashes` instead. Check: after one batch, look in `~/.Trash` and at the boot disk's free space.

### B8. A reload of the PC's tab mid-session rebuilds the overlay's counters from the last 512 KB of the chat log only (READ)

Where: `web/lib/machine.js:344-345`: on a fresh `LiveState` (every page load), the first read of the chat log starts at `file.size − 512 KB`. With ~80 KB of filler after every message (`addon/Compendium/Live.lua:28`) that is roughly the last six messages. The session's `since` survives the reload (`loadSince`, 48 h), but the kills, drops, streak and quest tracker do not; the next `pushLive` overwrites the cloud row with the small state. A Chrome crash or an accidental F5 on the PC during a stream resets the overlay to nearly zero.

### B9. The live quest tracker drops the oldest-accepted quest once 40 are tracked, even if it is still active (VERIFIED)

Where: `web/lib/live.js:244`: `this.quests.delete(this.quests.keys().next().value)` removes the first-inserted key. `misc.mjs` case H: after 41 accepts, `q1` (active) is gone. A long evening of accepting and turning in quests gets there; the "G" quest-log line then cannot mark it because it no longer exists, and progress lines for it recreate it without a title (`:223`).

### B10. Two fields for one fact: `duration` and `end_ms` can disagree on a row (READ)

Where: `web/app.js:3181` (the player rewrites `duration` from the `<video>` element when it differs by ≥ 1 s, leaving `end_ms`), `web/lib/machine.js:707` (the scan sets both), `web/lib/timeline.js:134` (`resolveRecordings` prefers `duration`). The stored `end_ms` then lies, and `followRecordings` uses `end_ms` first (`web/lib/machine.js:891`) while the timeline uses `duration`. Harmless until someone reads `end_ms`.

### B11. The addon anchors wall-clock time once, at login (READ)

Where: `addon/Compendium/Compendium.lua:41-58`. Event times are `time()` at login plus `GetTime()` elapsed. If Windows steps its clock during a session (a large NTP correction, a sleep/wake), the addon's times do not follow, while the PC's clock samples (`web/lib/machine.js:170-186`, every 10 min) do, so events land at the wrong second of footage by the size of the step. The sync flash corrects a constant offset, not a step in the middle. Real sessions are needed to see whether this ever happens; the "clock ±" pill on the PC's status bar drifting between sessions would be the sign.

### B12. Smaller things

- `recordingRole` needs a separator after `cam`: `cam.mov` at the top of the folder and `facecam 2026….mov` are classed as game recordings (VERIFIED, `misc.mjs` case E). `web/lib/timeline.js:117`.
- `wirePlayer` keeps a one-second retry loop alive as long as the recording page is open and the folder state is not `ok` (`web/app.js:3168-3172`); it stops only when the page changes.
- `startFeedTimer` (`web/app.js:700-710`) loads the live row from the cloud every 5 s on the Overview on the Mac (not on the PC); fine, but it is a second poller next to `refresh`.
- `every()` (`web/lib/machine.js:164-166`) logs every failed tick to the console; a chat-log read that keeps failing (permission lost) writes a warning per second for the life of the tab.
- `scanRec` reads the movie header only for files that have no row yet or that were "under way" (`web/lib/machine.js:681-685`, `:706`); a row whose length was wrong stays wrong across scans (CLAUDE.md claims otherwise, Section 7).

---

## 4. Performance

Measurements were made on this container's CPU (`bench.mjs`, `dbbench.mjs`, Appendix B); the Mac mini will differ, but the ratios hold.

### 4.1 One rebuild of everything on every change

`derived()` (`web/app.js:61-83`) throws away and rebuilds timelines, codex, world, characters and maps whenever `invalidate()` runs, and `changed(topic)` (`web/app.js:4031-4053`) calls `invalidate()` for every topic except `live`, `obs` and `clock`, including `wow` (the folder report changed) and `data`.

| Sessions | Events | Rebuild time |
|---|---|---|
| 20 | 28,800 | 0.2 s |
| 100 | 288,000 | 1.8 s |
| 200 | 864,000 | 5.4 s |

VERIFIED (`bench.mjs`, the fixture session tiled). A hundred evenings of play at ~3,000 events each is the middle row. Also rebuilt after every invalidation: `navPercents` (`web/app.js:4056-4087`) with `completionTree` and `storylines` (20–30 ms each, cheap) and `dataNotes` (`web/app.js:3997-4024`).

Where this bites:

- **The overnight batch loop** (`web/app.js:3406-3407`): `await m.scanRec(); invalidate(); outstandingPackages()` every 5 s while a camera file is shrinking, every 20 s otherwise. At the middle row that is a 1.8-second rebuild every 5 seconds for hours, next to ffmpeg. `scanRec` also calls `getFile()` on every video in the folder each pass (`web/lib/folders.js:163-173`).
- The PC's `refresh()` every 10 s while the live link is on (`web/lib/machine.js:104`): only real changes call `changed('data')` (`:874`), so idle refreshes are cheap, but each refresh re-downloads every session updated in the last two minutes in full (0.3–0.8 MB of JSON per session, VERIFIED sizes in `bench.mjs`), twelve times after every upload.

### 4.2 The overlay video

`renderOverlayVideo` (`web/lib/overlayvideo.js:741-788`) encodes **every frame** even when the scene did not change (`:771-774` skip only the drawing), at `bitrateFor` = 24 Mbps for 4K, 8 Mbps for 1080p (`:733-739`). READ: a 4-hour session at the recording size is 432,000 frames at 30 fps and, if the hardware encoder holds the target rate for a mostly flat green frame, about 43 GB of overlay for one evening. WebCodecs' `bitrate` is a target, not a ceiling, so the real size depends on Chrome's VideoToolbox path. **Measure one**: the size of any existing `*.overlay.mp4` next to a recording, divided by its length.

### 4.3 Timers that run for the life of the tab

| Where | Interval | Stops? |
|---|---|---|
| `machine.clockTick` | 10 min | on `stop()` |
| `machine.refresh` | 10 s (PC, live on) / 60 s | on `stop()` |
| `machine.pollWow` | 5 s, reads `getFile()` of each SavedVariables file | on `stop()` |
| `machine.pollLive` | 1 s, reads the chat log's tail | on `stop()` |
| `machine.scanRec` | 20 s, `getFile()` per video + header reads | on `stop()` |
| `pollSourceRecord` + `pollObsStats` | 10 s, 2+N websocket requests | on `stop()` |
| `startFeedTimer` | 5 s on the Overview | when leaving the page |
| overlay.js `poll` | 1–2 s per window (shared over a BroadcastChannel) | never (by design) |
| overlay.js `setInterval(renderKills)` | 250 ms | never |
| `runBatch` loop | 5–20 s with a full rebuild | on Stop or give-up |

Nothing here leaks a timer on its own; `saveConfig` → `restart()` clears and re-creates them. The cost is what each tick does (4.1), not the count.

### 4.4 Memory over a night

READ. Bounded: `LiveState.history` (6,000), `loot` (4,000), `events` (80), `known` (5,000), map images memoised per URL, object URLs revoked for the player. Unbounded but slow: `state.rows`/`state.sessions` (data), `rec.report` rebuilt each scan (small), console warnings from failing ticks. The batch's rebuild churn (4.1) is the thing most likely to make a tab left open all night feel heavy, along with the overlay encode holding a 4K canvas and an encoder queue.

### 4.5 Data loaded when not needed

- `loadAll` (`web/lib/cloud.js:34-49`) pulls every session with its full event list at start-up on both computers, including the Mac, which only needs event times for the timelines.
- `spawns.json` (516 KB) is never loaded (`spawnTable` is defined at `web/app.js:136` and never called), which is right for the wiki rule; the file and function are dead weight.
- `itemdb.json` (614 KB) is fetched for the Items page and for the sidebar percentage (`navPercents`), once.

---

## 5. Reliability of the Mac-side automation

For each part: what happens when it fails halfway, and whether the screen says so.

### 5.1 The recordings folder scan (`scanRec`, `web/lib/machine.js:644-724`)

- **Halfway failure**: each file's verdict is wrapped in try/catch (`:668-720`), so one unreadable file no longer stops the pass; the verdict table on This computer shows `error` and the message. Good.
- **What the screen cannot tell you**: a name collision (B1) shows two `listed` lines; a camera dropped for starting late (B4) shows `listed` too; a chain broken by a 4-second gap (B3b) shows two recordings with no hint they were one. There is no line on the Recordings page saying "this game recording has no camera" or "these two files look like a split that did not fold".
- **Timing sources**: a growing file has no header yet, so its start is the name; a finished `.mov`/`.mp4` gets its length from `mvhd` (`web/lib/mov.js:42-66`); an `.mkv` gets its end from the last write. Files under 4 KB are skipped only while they have no row.
- The scan only runs while the tab is open; files made while it was closed are picked up on the next start from the name or header (correct), and the "under way" notification does not fire for them.

### 5.2 The batch (`runBatch`, `web/app.js:3388-3472`)

- A failing package loops forever (B5).
- No write permission: waits 20 min doing nothing (B6).
- Progress is shown in place (`batchSay`), and the wait branch reads ffmpeg's `-progress` file, which is good. But the status file (`.compendium-shrink-status`) only ever says `shrinking X`, `done X`, `idle` or `error ffmpeg not found` (`web/shrink/shrink.sh:41,54,66,33`). A file ffmpeg failed on, or one whose length did not match, is logged to `~/Library/Logs/compendium-shrink.log` (`:55-62`) and the status stays at `shrinking X` until the next file starts. The batch page will report "no progress for N min" and eventually "silent for three hours" without ever saying which file failed or why.
- The batch keeps building only while the tab is open and awake; a Mac that sleeps mid-render leaves `batch` set with a half-written writable that is never closed. With the File System Access API an unclosed writable is discarded, so no partial `.overlay.mp4` is left behind (READ, `web/lib/mp4.js:155-162`), but `chronicler.packs` in localStorage records the failure and the batch retries it (B5).
- If the tab reloads mid-batch, the go-flag stays in the folder and the shrinker keeps going on its own until it has done every camera file, with nobody building packages.

### 5.3 The camera shrinker (`web/shrink/shrink.sh`, `install.sh`)

- Runs every 3 minutes from launchd (`install.sh:38-39`), exits at once without the flag. Leaves `.compendium-shrink-seen` on every run so the app can tell "never looked" from "looked but idle": good, and This computer reads it (`web/app.js:3893-3905`).
- **Halfway**: ffmpeg is killed or the Mac sleeps → the `.shrinking.mp4` temp file stays next to the original (it is removed only on ffmpeg's own failure or a length mismatch, `:58,61`), the lock directory `/tmp/compendium-shrink.lock` (`:34-36`) stays until reboot if bash itself was killed with SIGKILL, and every later run exits silently at the lock. `/tmp` is cleared on reboot, so a restart heals it; nothing on screen says why the shrinker "never runs".
- The Trash fallback copies across volumes (B7).
- The output keeps the original's modification time (`touch -r`, `:51`) so the scan does not think it is a new recording under way: good.
- The installer's fallback download URL is hard-coded to `https://wowchronicler.netlify.app/shrink/shrink.sh` (`install.sh:29`) unless `COMPENDIUM_SHRINK_URL` is set (This computer sets it, `web/app.js:3907`).
- Nothing rate-limits it against a recording in progress: it only skips files modified in the last 2 minutes (`:39`). If the owner presses the batch button and then starts a new recording, ffmpeg (hardware HEVC) runs beside OBS's encoders.

### 5.4 The session package (`buildSessionPackage`, `web/app.js:3277-3347`)

- Failure anywhere (item art, fonts, the encoder refusing the size, a write error) throws, is stored as `{ failed }` and shown on the recording page as "Failed: …" (`sessionPackPanel`, `:3244-3259`). From the batch it also toasts. Good, except for the retry loop (B5).
- The overlay is rendered for the **whole chain** (`seconds: r.duration`) into one file next to the head part, and the XML lays it on the top track. Fine for Premiere; see 4.2 for its size.
- The XML's camera `<file>` declares the sequence's width/height, not the camera's (`web/lib/exports.js:147`); Premiere reads the real dimensions from the media on import, so this is cosmetic.
- What is never checked: that the written `.overlay.mp4` actually plays (the writer's box tree is tested in `test/mp4.test.js`, but no test opens a file Chrome produced). Appendix A has the check.

---

## 6. Dead code, duplicated logic, disagreements

### 6.1 Dead code (VERIFIED by grep across `web/` and `test/`)

- `web/app.js:1835-1844` `otherMaps` — never called (the old "every zone map with database pins" view).
- `web/app.js:136-142` `spawnTable` — never called; `web/data/classic/spawns.json` is never fetched.
- `web/app.js:314-320` `dbQuestPanel` and `:221-231` `dbQuestFacts` — never called.
- `web/lib/questdb.js:200-247` `unfoundGivers`, `zoneRares`, `rarePins`; `:168-171` `sortCoverage` — never called (they are the database-pin functions the wiki rule retired). `searchEntries` is imported in `web/app.js:20` and never used (the search index is built from the codex only, `:2316`).
- Exports used nowhere outside their own file: `folders.forgetFolder/isHiddenFile/VIDEO_EXTENSIONS`, `footage.FLAGS/zoneNames`, `live.PREFIX/livePayload/ECHO_WINDOW`, `machine.defaultMachineConfig`, `maps.wowheadMapUrl`, `mov.MOVIE_EXTENSIONS`, `overlayvideo.DESIGN_H/THEMES/DEFAULT_LAYOUT/bitrateFor`, `questdb.RACE_BITS/RANK_NAMES/ITEM_CLASSES`, `roster.RACE_TOKENS/CLASS_TOKENS/PROFESSIONS/factionOf/parseRoster/rosterText` (the paste-a-roster feature was removed, the parser stayed), `sessions.EXPANSIONS/normalizeSession`, `shorts.SHORT_WINDOWS/MIN_SHORT/MAX_SHORT`, `world.npcKey`, `zip.crc32`. Harmless, but they are the fossils of features that were removed and make the modules read larger than they are.
- `config.obsMore` companion OBS instances (`web/lib/machine.js:726-743`, `:754-774`, the form at `web/app.js:3749-3755`) — kept "if enabled", superseded by Source Record filters.
- `web/lib/voice.js` and the Narration page are live code, but nothing in the owner's stated workflow uses them.

### 6.2 Duplicated logic

- The "does file B continue file A" rule exists twice with the same 3-second constant: `web/lib/timeline.js:166-185` (folding parts) and `web/lib/machine.js:27,892-898` (the follower's chain walk). They agree today; a change to one without the other splits sessions differently on the two computers.
- Item quality colours: `web/lib/live.js:13` `QUALITY_COLORS`, `web/lib/overlaypack.js:9` `QUALITY_COLORS`, `web/overlay.js:42` `QCOLOR`, `addon/Compendium/Compendium.lua:228` `QUALITY_BY_COLOR`, `web/lib/live.js:31` `QUALITY_BY_COLOR`.
- The overlay's callout logic is written twice: once in DOM/CSS for OBS (`web/overlay.js`, `web/overlay.css`) and once on a canvas for the rendered video (`web/lib/overlayvideo.js` `OverlayScene`), including the race particle tables (`RACE_FX` in both). Every visual change must be made twice or the recorded overlay will not match the stream.
- `recSummary` + timeline are recomputed per call (`web/app.js:2900-2905`) rather than cached with `derived()`.
- Two nearly identical "which recording covers this moment" paths: `aligner` (timeline.js) and the per-page `where` map built in `derived()`.

### 6.3 Places where two parts disagree about the same thing

- Failed session packages: the batch retries them forever, `autoPack` never retries (B5).
- `end_ms` vs `duration` (B10).
- `followRecordings` accepts `source === 'obs' || 'file'` rows (`web/lib/machine.js:884`), `resolveRecordings` accepts any row with a start and a length; a row whose source is `filename` (an `.mkv` timed from its name) is a recording on the Mac but never a stream session on the PC.
- Companion pairing: `resolveRecordings` pairs a camera only against the **head** part of a chain (parts are removed from `out` before pairing, `:186`); `followRecordings` does not care about companions. A camera started late in part 2 is neither a companion nor a session.
- The wiki rule. CLAUDE.md states "**Nothing undiscovered from the database is ever shown except locations**", and the owner restates it as firm. The code shows database names in three places:
  1. `web/app.js:1924-1926`: the Storyline page names every chapter of a started chain, the unfound ones in grey. CLAUDE.md documents this ("chapters you have not found stay grey"), so the document and the owner's rule disagree with each other.
  2. `web/app.js:170-171,185`: the zone page's quest table has a "Waiting on" column (`whyNot` → `waitingOn`) that names prerequisite quests from the database whether or not they were found (`web/lib/questdb.js:118-127`).
  3. `web/app.js:249-300` `dbQuestBody`: a found quest's objectives list names the target creatures from the database (`esc(o.name)` without a link when not hunted); arguably the quest text already names them.
  Search is clean (own index only). Map pins are clean (`dbPins = []`, `web/app.js:2003`).

### 6.4 The `undefined/` folder

48 PNG files, 14 MB, committed to the repo root in commit `db71adb` ("Recordings: files OBS splits off are one recording, in parts"). They are screenshots of the app (`v3-setup.png`, `cloud-mac-recording.png`, …) written by a screenshot script whose output directory variable was undefined. Not deployed (Netlify publishes `web/`), but it bloats every clone and has nothing to do with the commit it rode in on. VERIFIED with `git ls-files undefined | wc -l` and `du -sh`.

---

## 7. Claims in CLAUDE.md and README.md the code does not match

| Claim | Where | What the code does |
|---|---|---|
| "The headless two-computer smoke test lives in the session scratchpad (`cloud-smoke.cjs`)" | CLAUDE.md, Checks | The scratchpad is per cloud session; this one is empty. The test does not exist. VERIFIED. |
| "lengths come from the movie header, read for every finished movie file in `scanRec`" | CLAUDE.md, Recordings | Only files with no row yet, or rows going from under way to finished, get a header read (`web/lib/machine.js:681-685,706`). An existing row is never re-measured. |
| "`dbMapPins` returns nothing" | CLAUDE.md | There is no function called `dbMapPins` anywhere (`grep`). The map page has a local `dbPins = []`. |
| "`web/lib/questdb.js` indexes it (`indexDB`, `questState`, `zoneCoverage`, `unfoundGivers`, `zoneRares`); app.js lazy-loads it with `questDB()`/`spawnTable()`" | CLAUDE.md, Quest database | `unfoundGivers`, `zoneRares` and `spawnTable` are dead (6.1). |
| "`sessionPack.auto` (off by default) is the only thing that builds on its own" | CLAUDE.md | The shrinker runs on its own whenever the go-flag is in the folder, and the flag is left behind when the batch gives up (B6). |
| "the Journal cuts outings by recording … one outing per recording" | CLAUDE.md | True while the chain folds; a 4-second split gap makes two recordings and two outings (B3b). |
| "a creature until hunted (never a kill count in the name…)" vs README "a creature until killed, with your kill count in the name" | CLAUDE.md vs README.md line 25 | The Bestiary shows no kill count in the name (`wikiName`, `web/app.js:949`). README is wrong. |
| "**Nothing undiscovered from the database is ever shown except locations**" | CLAUDE.md | Three exceptions (6.3). |
| "so a line reaches the overlay in about two seconds" | CLAUDE.md, Live overlay | READ, cannot verify. The chain's worst case while idle is 0.3 s addon flush + up to 1 s PC poll + up to 1.5 s push gap + up to 2 s overlay poll ≈ 5 s; in the "quick" mode ≈ 2–3 s. |
| "`/comp clear` — Empty the addon's log" | README, In game table | Needs `/comp clear confirm` (`addon/Compendium/Compendium.lua:731-739`). |
| "Locations (done) … unfound quest givers and rare spawns on the maps … every zone map whether visited or not" | docs/ROADMAP.md | Retired; the functions are dead and the map page draws no database pins. ROADMAP is stale. |
| "its camera on hardware ProRes 422 in `.mov` … the ProRes to the Trash" | CLAUDE.md | To the Trash via Finder, else `mv` to `~/.Trash` on the boot disk (B7). |
| "after changing the addon, regenerate the fixture" | CLAUDE.md, Checks | The fixture matches the current addon (the Lua test that compares them passes), so this one holds. |
| "Delete everything … on both computers" | This computer page text (`web/app.js:3768`) | Only the computer that pressed it knows until the other reloads (B2). |

Claims I could confirm in code and tests, so the reader does not have to wonder: the sync-flash correction and its carry-over to nearby recordings (`test/timeline.test.js`), the 45-second growing rule, the chat-log purge at 1 MB after 3 minutes quiet, the split folding and the FCP XML layout of parts and companions (`test/companions.test.js`), the `live_state(p_token, p_seq)` cheap poll, the `data-needs="records"` hiding, the KEEP_DAYS 30 pruning, the "quiet accept" and "G" quest-log lines.

---

## 8. Complexity: what earns its place and what could go

For one owner with two computers, judged against the three purposes (recording, edit-ready sequence, personal wiki).

**Earns its complexity**

- The clock bridge (`measureClock` best-of-five round trips, `clockModel` per machine with interpolation, the sync flash) is the core of "events land on the right second" and is small and tested. Keep.
- The addon's wall-clock anchor (`Compendium.lua:41-58`) is what gives frame-accurate times. Keep (see B11 for its one weakness).
- `resolveRecordings` (roles, parts, companions) and `toFCPXML` are exactly the edit-ready-sequence feature. Keep, fix B1/B3/B4.
- The folder scan as the source of truth on the Mac (rather than OBS events) is the right call for Source Record filters. Keep.
- The wiki model (`codex.js`, `world.js`, `journey.js`, the quest database for percentages) is the second purpose. Keep.
- The MP4 writer and WebCodecs render: the only way to get an overlay without recording it. Keep, but see below.

**Could be removed or replaced by something simpler, and what would be lost**

1. **The live link's chat-log transport** (Live.lua filler, `pollLive`, `purgeChatLog`, `markNovel`, `followRecordings`, the `live` table and `live_state` RPC, `overlay.js` polling and leader election, the race themes). This is roughly a quarter of `machine.js`, all of `overlay.js`/`overlay.css`, `Live.lua`, and it exists to show the stream overlay live. The owner's stated purpose is an edit-ready sequence with the overlay *rendered afterwards* from the log; the session package already does that. If the owner does not stream live, the entire live chain, the `session` events, B3, B8 and B9 disappear. Lost: the live OBS browser source, the "playing now" card, the Live feed on the Overview, live item counters, the Drops-this-session view.
2. **Rendering the overlay video at the recording size and frame rate.** A 1080p 30 fps overlay scaled up in Premiere keys just as well for text and cards, renders four times fewer pixels, and is a quarter of the file. Lost: pixel-sharp 4K text on the overlay track.
3. **`OverlayScene` duplicating the DOM overlay on a canvas.** If the live overlay goes (1), the canvas version is the only one and the duplication is gone. If the live overlay stays, the alternative is to record the browser source with a third Source Record filter, which the owner tried and rejected (CLAUDE.md), so the duplication is the price of that decision.
4. **Companion OBS instances (`obsMore`)**, the **voice notes**, the **Route replay** (WebM/PNG sequence), **Shorts**, **Episodes**, **the overlay pack** (`overlaypack.js` + `zip.js`), **the Reach panel** (`roster.js` bipartite matching), **Lore tales** (`tales.js`, 959 lines) and the **first-person Journal** (`narrative.js`, 574 lines): none of them is in the recording → sequence → wiki path. Together they are about 2,500 lines of `web/lib` plus their pages. Lost: exactly those features. Which of them the owner actually uses is a question for him (Section 9).
5. **The animated route glow, number count-ups, nav shine, `.still` diffing in `route()`** (`web/app.js:4089-4153`): presentation. Lost: the animation.
6. **The settings blob shared by both computers.** Splitting it into per-computer keys (or a `machine` column) removes B2 without any feature loss.
7. **`deleteAll` + `resetAt` + `deletedSessions` + `deletedMarks` + `chronicler.packs` + `chronicler.track.*`**: five overlapping ways to "forget". A single "delete rows in Supabase, then the addon's `/comp clear confirm`" would do for one owner. Lost: the ability to keep old addon data around after a reset.

---

## 9. What I would change first, and questions only the owner can answer

### Ten changes, in order

1. **Key recordings by path, not name** (B1). Add `path` to the primary key or store `dir + name`; make `scanRec`'s `row()`, the replaced logic and `folderOfVideo` use it. Reason: the owner's rig can silently lose a gameplay recording or its camera. Risk: a schema change (new "Version 6" block, re-run in Supabase) and a one-time migration of existing rows; medium.
2. **Stop overwriting the other computer's settings** (B2). Either re-read the settings row before every save and merge only the keys this computer owns, or split settings into per-computer rows. Add settings to `refresh()`. Reason: silent reversions of package options, recording size and resets. Risk: low if done as read-merge-write; medium as a schema split.
3. **Make the batch finite** (B5, B6): skip a recording after its second failure, say so on the page, stop the batch at once when the folder is not writable, and remove the go-flag on every exit path. Reason: the overnight run is the feature. Risk: low.
4. **Widen and instrument the split/companion slack** (B3, B4): raise `CONTINUES` to something like 15 s in both places (a real gap between OBS parts is never minutes), raise `COMPANION_SLACK` or pair by overlap only, and list on the Recordings page any camera file that paired with nothing and any two game files less than a minute apart that did not fold. Reason: silent losses in the edit and on stream. Risk: a 15-second rule could fold two deliberately separate takes made back to back; low.
5. **Fix the shrinker's Trash and status** (B7, 5.3): use `/Volumes/<drive>/.Trashes/$UID/` (or just delete the original once the length check passed, since the .mp4 is verified), write `failed <name>` to the status file on both failure branches, clear stale `.shrinking.mp4` files at start. Risk: low.
6. **Rebuild the PC's live state from the whole session at start-up** (B8): on a fresh `LiveState`, read the chat log back to the session's `since` (the file carries local timestamps), not the last 512 KB. Risk: a one-off read of a few hundred MB on reload; low.
7. **Cache instead of rebuild in the batch loop** (4.1): only `invalidate()` when `scanRec` actually changed a row, and cache `recSummary`. Risk: low.
8. **Render the overlay at 1080p 30 fps by default** and encode unchanged stretches at a keyframe interval instead of every frame (4.2). Risk: Premiere scaling; low.
9. **Decide the wiki rule's three exceptions** (6.3) and make the code and CLAUDE.md say the same thing. Risk: none.
10. **Delete the dead code and the `undefined/` folder** (6.1, 6.4), and rewrite CLAUDE.md's Recordings paragraph to match (7). Risk: none; it makes the next audit shorter.

Not in the ten but worth a line: the quest-tracker cap (B9, one-line fix: evict the oldest by `at` among non-active quests), and a `machine.js` test built on the fake store the way `machine-sim.mjs` does it, since none exists.

### Questions only the owner can answer

1. What are the two Source Record filters' **Filename Formatting** strings, and does the camera filter write into `cam/` or into the same folder with a `cam ` prefix? Which container does the gameplay filter use (`.mov` or `.mp4`)? (Decides whether B1 is already happening.)
2. Do you stream live at all, or only record? (Decides whether the whole live chain, Section 8 item 1, is worth keeping.)
3. On a real split session, what is the gap between part 1's last frame and part 2's first frame? (`ffprobe -show_entries format=duration` on part 1 plus its name timestamp, against part 2's name.) Decides how far `CONTINUES` must move (B3b).
4. Have you ever seen "SESSION COMPLETE" on stream in the middle of a session, or the counters reset at a split?
5. How large is one `*.overlay.mp4` next to a recording, and how long did it take to render? (4.2)
6. After a batch, is there anything in `~/.Trash` on the Mac mini, and did the boot disk's free space drop? (B7)
7. Which of these do you use: Shorts, Episodes, Route replay, the overlay pack (.zip), voice notes, Lore tales, the Journal, the Reach panel? (Section 8 item 4.)
8. Is the Mac tab left open across sessions, or opened for the batch only? (Decides how much 4.1 and 4.3 matter.)
9. Do you want unfound chapters of a started storyline, and the "waiting on" prerequisites, to be named? (6.3)
10. Has "Delete everything" ever been used with both tabs open? (B2's second consequence would have left resurrected recording rows.)

---

## Appendix A: what to run on the real machines for the unverifiable items

- **B1 (name collision)**: on the Mac, `ls -la "/Volumes/Project/Game Capture" "/Volumes/Project/Game Capture/cam"` after a session and after the shrinker ran; if a top-level `X.mp4` and a `cam/X.mp4` share a name, B1 is live. Then check `select name, path, source, duration from recordings order by start_ms desc limit 20` in Supabase › SQL Editor: one row per file name is the symptom.
- **B3b (split gap)**: for one split pair, `ffprobe -v error -show_entries format=duration -of csv=p=0 part1.mov`, add it to part 1's name timestamp, compare with part 2's name timestamp. Anything over 3 s breaks the chain today.
- **B7 (Trash)**: `ls ~/.Trash` and `df -h /` on the Mac after one batch.
- **4.2 (overlay size)**: `ls -la *.overlay.mp4` and `ffprobe` its duration; bytes per second × 3,600 is the cost per hour.
- **5.4 (the overlay plays)**: open one `*.overlay.mp4` in QuickTime and in Premiere; scrub to the end.
- **B8**: while a session is on, press F5 on the PC's tab and watch the overlay's kill counter.
- **B11**: note the "clock ±" pill on the PC at the start and end of a long session; a jump of more than a second between them is a clock step.
- **Latency claim (7)**: `/comp live test` in game with a stopwatch until the overlay shows LIVE LINK OK, once while a session is on and once idle.

## Appendix B: the experiments

All scripts import the repository's own modules and run under Node 22 from the repository root (they use absolute paths into `web/lib` and `test/`).

**`misc.mjs`** (timeline, live state, names):

```
A. camera 6 s after the game     → companions: 0, camera not listed anywhere
B. camera 4 s after the game     → paired, offset 4
C. parts with a 3.5 s gap        → 2 game recordings (chain broken)
E. recordingRole('cam.mov')      → game;  'facecam …' → game
H. 41 quests accepted            → q1 (active) evicted, q41 kept
```

**`machine-sim.mjs`** (a real `Machine` over the test suite's `fakeClient`, a fake directory handle with `values()`/`getFile()`, fake `localStorage`):

```
1. X.mkv + cam/X.mkv                   → 1 row, role cam, no game recording
2. X.mkv + cam/X.mov → shrink → cam/X.mp4  → correct (different extensions)
3. X.mkv + "cam X.mov" → "cam X.mp4"   → correct (prefix naming)
4. Mac saves sessionPack, PC saves an addon error → sessionPack gone from the cloud row
5. part 1 finished before part 2 listed → SESSION COMPLETE fired, never resumed
6. part 2 listed first (usual order)   → fine;  4 s gap → new session, counters reset
```

**`sim2b.mjs`**: `X.mp4` + `cam/X.mov` → shrink → `cam/X.mp4` → one row, role `cam`, gameplay gone, both files "listed".

**`bench.mjs`**: `derived()` rebuild at 20/100/200 sessions (0.2 / 1.8 / 5.4 s); JSON size of one session 0.3–0.8 MB.

**`dbbench.mjs`**: `indexDB` 15 ms, `completionTree` 8–20 ms, `storylines` 26 ms (cached per ctx object).

The full scripts are below so they can be rerun.

<details>
<summary>misc.mjs</summary>

```js
import { resolveRecordings, recordingRole, startFromName, aligner } from '../web/lib/timeline.js';
import { LiveState, parseChatLine } from '../web/lib/live.js';
import { stem } from '../web/lib/exports.js';
const t0 = Date.UTC(2026, 8, 27, 14, 0, 0);
let all = resolveRecordings([
  { name: '2026-09-27 14-00-00.mov', machine: 'Mac', start_ms: t0, duration: 2700, source: 'file' },
  { name: 'cam 2026-09-27 14-00-06.mov', machine: 'Mac', start_ms: t0 + 6000, duration: 2694, source: 'file' },
]);
console.log('A', all.find((r) => r.role === 'game').companions.length, all.find((r) => r.role === 'cam').companionOf);
all = resolveRecordings([
  { name: 'g 2026-09-27 14-00-00.mp4', machine: 'Mac', start_ms: t0, duration: 2700, source: 'file' },
  { name: 'g_2026-09-27_14-45-03.mp4', machine: 'Mac', start_ms: t0 + 2703500, duration: 2700, source: 'file' },
]);
console.log('C', all.filter((r) => r.role === 'game').length);
for (const [n, p] of [['cam.mov', '/V/cam.mov'], ['facecam 2026-09-27 15-06-29.mov', null]]) console.log('E', n, recordingRole(n, p));
const s = new LiveState(0);
for (let i = 1; i <= 41; i++) s.apply({ at: i * 1000, kind: 'quest', action: 'accept', qid: i, title: `Q${i}` });
console.log('H', s.quests.has('q1'), s.quests.has('q41'));
```
</details>

<details>
<summary>machine-sim.mjs (abridged to the two decisive cases; the fake handles are the same in sim2b.mjs)</summary>

```js
globalThis.localStorage = { _m: new Map(), getItem(k) { return this._m.has(k) ? this._m.get(k) : null; }, setItem(k, v) { this._m.set(k, String(v)); }, removeItem(k) { this._m.delete(k); }, key(i) { return [...this._m.keys()][i]; }, get length() { return this._m.size; } };
Object.defineProperty(globalThis, 'navigator', { value: { platform: 'MacIntel' }, configurable: true });
const { fakeClient } = await import('../test/cloud.test.js');
const { CloudStore } = await import('../web/lib/cloud.js');
const { Machine } = await import('../web/lib/machine.js');
function fakeFile(size, lastModified) { return { size, lastModified, slice() { return { arrayBuffer: async () => new ArrayBuffer(16), text: async () => '' }; } }; }
function dir(name, entries) { return { kind: 'directory', name, entries, async *values() { for (const e of entries) yield e; }, queryPermission: async () => 'granted' }; }
function file(name, size, lastModified) { return { kind: 'file', name, _f: fakeFile(size, lastModified), async getFile() { return this._f; } }; }
async function makeMachine(client, cfg) {
  const store = new CloudStore(client, 'u1'); const all = await store.loadAll();
  const state = { sessions: all.sessions, rows: all.recordings, clock: all.clock, settings: all.settings, items: all.items, schema2: true, voice: [], cache: null };
  const m = new Machine({ store, state, changed: () => {}, notify: () => {} });
  m.config = { ...m.config, ...cfg, obs: { enabled: false }, obsMore: [] }; m.offset = 0; m.store.offset = 0;
  return { m, state, store };
}
// case 4: settings last-writer-wins
{
  const client = fakeClient();
  const pc = await makeMachine(client, { plays: true, records: false, name: 'Gaming PC' });
  const mac = await makeMachine(client, { plays: false, records: true, name: 'Recording Mac' });
  mac.state.settings = { ...mac.state.settings, sessionPack: { shrinkCam: true } };
  await mac.store.saveSettings(mac.state.settings);
  await pc.m.collectErrors([{ key: 'boom', msg: 'boom', n: 1, last: 1 }], '_classic_era_');
  console.log('cloud sessionPack after the PC saved:', client.tables.settings[0].data.sessionPack);
}
// case 5: part 1 finished before part 2 listed
{
  const client = fakeClient();
  client.from = ((orig) => (t) => { const q = orig(t); if (t === 'live') q.update = () => ({ eq: async () => ({ error: null }) }); return q; })(client.from);
  const pc = await makeMachine(client, { plays: true, records: false, live: true, name: 'Gaming PC' });
  pc.m.wow.state = 'ok'; pc.m.live.status = 'ok';
  const T = Date.now() - 50 * 60e3; const rows = pc.state.rows;
  rows.push({ name: 'g 1.mp4', start_ms: T, end_ms: null, duration: null, machine: 'Recording Mac', source: 'file' });
  await pc.m.followRecordings();
  rows[0] = { ...rows[0], end_ms: T + 45 * 60e3, duration: 2700 };
  await pc.m.followRecordings();
  rows.push({ name: 'g_2.mp4', start_ms: T + 45 * 60e3 + 1000, end_ms: null, duration: null, machine: 'Recording Mac', source: 'file' });
  await pc.m.followRecordings();
  console.log('follow after part 2 listed:', pc.m.live.follow, pc.m.live.state.events.map((e) => e.action));
}
```
</details>

<details>
<summary>sim2b.mjs (the collision after the shrinker)</summary>

```js
// same fake handles and makeMachine as above, with client.from(...).delete stubbed
const now = Date.now();
const name = stamp(new Date(now - 3600e3)); // "YYYY-MM-DD HH-MM-SS" in local time
const cam = dir('cam', [file(`${name}.mov`, 9e9, now - 600e3)]);
const root = dir('Game Capture', [file(`${name}.mp4`, 5e9, now - 600e3), cam]);
m.recRoot = root; m.rec.state = 'ok';
await m.scanRec();                       // game + cam companion: correct
cam.entries.splice(0, 1, file(`${name}.mp4`, 2e9, now - 600e3)); // the shrinker's output
await m.scanRec();
console.log(state.rows.map((r) => [r.name, r.path]));   // → [[ 'X.mp4', 'cam/X.mp4' ]]
```
</details>

<details>
<summary>bench.mjs</summary>

```js
import fs from 'node:fs';
import { readAddonLog } from '../web/lib/sessions.js';
import { clockModel, resolveRecordings, buildTimelines } from '../web/lib/timeline.js';
import { buildCodex } from '../web/lib/codex.js';
import { buildWorld } from '../web/lib/world.js';
import { buildCharacters, recordingCharacters } from '../web/lib/journey.js';
import { buildMaps } from '../web/lib/maps.js';
const base = readAddonLog(fs.readFileSync('test/fixtures/Compendium.lua', 'utf8')).sessions[0];
const make = (N, R) => Array.from({ length: N }, (_, i) => ({ ...base, id: `s${i}`, machine: 'Gaming PC',
  events: Array.from({ length: R }, (_, r) => base.events.map((e) => ({ ...e, t: e.t + i * 86400 + r * 600 }))).flat() }));
for (const [N, R] of [[20, 20], [100, 40], [200, 60]]) {
  const sessions = make(N, R);
  const rows = sessions.map((s, i) => ({ name: `rec${i}.mp4`, machine: 'Mac', start_ms: s.events[0].t * 1000 - 5000, duration: s.events.at(-1).t - s.events[0].t + 10, source: 'file' }));
  const a = performance.now();
  const clock = clockModel([{ machine: 'Gaming PC', offset_ms: 100, measured_at: 0 }]);
  const recordings = resolveRecordings(rows);
  const timelines = buildTimelines(sessions, recordings, clock);
  const where = new Map(); for (const [rec, ev] of timelines) for (const e of ev) where.set(`${e.session}|${e.t}`, { rec, offset: e.offset });
  const codex = buildCodex(sessions, (sid, t) => where.get(`${sid}|${t}`) ?? null);
  const moment = (s, e) => ({ session: s.id, t: e.t, footage: where.get(`${s.id}|${e.t}`) ?? null, m: e.m ?? null, x: e.x ?? null, y: e.y ?? null, z: e.z ?? null, sz: e.sz ?? null });
  const world = buildWorld(sessions, [], moment);
  buildCharacters(sessions, moment, timelines, recordings); recordingCharacters(sessions, timelines); buildMaps(sessions, world, codex, moment);
  console.log(N, 'sessions', sessions.reduce((n, s) => n + s.events.length, 0), 'events:', Math.round(performance.now() - a), 'ms');
}
```
</details>
