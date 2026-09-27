# Before Compendium goes public

Things that are fine for one account and not for many. Add to this list as they come up; nothing here blocks a private 1.0.

- **Tale voice.** The Lore tales speak of the unnamed adventurer as "him" (the Lore page's picker was removed in 1.0; `settings.taleVoice` is still read by `taleVoice()` in `web/app.js`). A public build needs a per-account choice, set once at setup rather than on the Lore page.
- **One Supabase project, one Netlify site.** `config.json` on Netlify carries the Supabase URL and anon key for this account only; other people need their own project and site, or a hosted multi-tenant backend with row-level security per account.
- **The overlay token** is a bearer secret in the OBS address; per-account tokens and a way to rotate them belong in the setup flow.
- **Questie data** (`web/data/classic/*.json`) is GPL-3.0; keep the `source` field and the licence notice when distributing.
