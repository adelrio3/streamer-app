# Chronicler

WoW addon (`addon/Chronicler`, Lua 5.1) + zero-dependency Node 22 companion (`companion/`). See README.md and docs/ROADMAP.md.

## Working with the user

- End every message that delivers changes with the ZIP download link for the branch that was pushed:
  `https://github.com/adelrio3/streamer-app/archive/refs/heads/<branch>.zip`
  They install the addon by copying `addon/Chronicler` from that ZIP into `Interface\AddOns\`.
- They play Classic Era (interface 11509 as of 1.15.9) and record with OBS on a separate PC, editing in Premiere Pro.

## Checks

- `npm test` runs everything. The addon tests need `lua5.1` (apt-get install lua5.1); they run the real addon against `test/addon/harness.lua`.
- After changing the addon, regenerate the fixture: `lua5.1 test/addon/harness.lua addon/Chronicler test/fixtures/Chronicler.lua`.
- New client versions: `npm run add-interface -- <number>`.
