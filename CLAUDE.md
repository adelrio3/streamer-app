# Chronicler

WoW addon (`addon/Chronicler`, Lua 5.1) + a no-build web app (`web/`) hosted on Netlify with data in Supabase (`supabase/schema.sql`). The gaming PC (Windows) and recording computer (Mac, OBS) each run the web app in Chrome; the server clock bridges them. See README.md and docs/ROADMAP.md.

## Working with the user

- Don't include the ZIP download link in messages. The addon installs and updates from the web app (This computer › Update addon), and the site deploys itself from this branch on Netlify.
- Whenever you mention a file, say where it is or how to open it: a GitHub link for files in this repo
  (`https://github.com/adelrio3/streamer-app/blob/<branch>/<path>`), the full Windows path for files on their PC
  (e.g. `C:\Program Files (x86)\World of Warcraft\_classic_era_\WTF\Account\<ACCOUNT>\SavedVariables\Chronicler.lua`),
  or the web address / menu path for external services (Supabase, Netlify). Don't say "the schema file" or "the README" bare.
- They play Classic Era (interface 11509 as of 1.15.9) on a Windows PC (Chrome can't open Program Files, so WoW gets moved to `C:\Games\World of Warcraft`) and record with OBS on a separate Mac (no file sharing between them), editing in Premiere Pro.
- Give exact values to enter and direct links (Supabase dashboard links can use `https://supabase.com/dashboard/project/_/...`), so they don't have to hunt or guess.

## Web app layout

- `web/index.html` is a sidebar shell (Chronicle / World / Footage / System groups); pages live in `web/app.js` as `pages.<name>` and use `pageHead`, `tabsHtml`, `crumb`, `facts`, `table`. Bestiary = `world.creatures` (attackable), People = `world.people`, objects (herbs/ore/chests) under Items. Maps: `web/lib/maps.js` + `wireMap` in app.js.
- The headless two-computer smoke test lives in the session scratchpad (`cloud-smoke.cjs`), not the repo; it fakes Supabase, folders and OBS.

## Checks

- `npm test` runs everything. The addon tests need `lua5.1` (apt-get install lua5.1); they run the real addon against `test/addon/harness.lua`.
- `npm run serve` runs the web app locally; `node tools/build-web.js` copies the addon into `web/addon` (Netlify runs it on deploy).
- After changing the addon, regenerate the fixture: `lua5.1 test/addon/harness.lua addon/Chronicler test/fixtures/Chronicler.lua`.
- New client versions: `npm run add-interface -- <number>`.
