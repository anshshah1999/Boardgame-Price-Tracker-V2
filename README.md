# Board Game Price Tracker — Web App

A mobile-friendly page that shows, for each game, whether it's cheaper to **buy in India** or
**import**, plus a **Travel view** for what's worth buying in a country you're visiting. It runs
as a static site (no server) and reads prices from `data.json`.

## Files
- `index.html` — the app (open it and it works).
- `data.json` — the prices + game list. Updated by the agent each run.
- `state.json` — *created automatically* when you turn on sync; holds your personal edits.

## Host it (GitHub Pages)
1. Create a repo (e.g. `boardgame-tracker`) and add `index.html` + `data.json`.
2. Repo **Settings → Pages → Build from branch → main / root → Save**.
3. Open the URL it gives you (e.g. `https://<you>.github.io/boardgame-tracker/`). Works on phone and desktop.

You can also just open `index.html` locally in a browser to try it — but then `data.json` must sit
next to it, and sync/hosting features are for the deployed version.

## How prices get updated ("agent updates the repo")
In a new chat say **"Run the board game price process."** The agent scrapes Board Game Oracle
(5 countries) + Board Games India, refreshes FX, and writes a new `data.json` into this repo
(or hands it to you to commit). The page shows the new numbers on every device — no spreadsheet,
no manual paste.

## Your edits + cross-device sync
Everything you change in the app — per-game discount, forex/overhead/delivery, status, notes,
added games, quick-add, thresholds — is saved instantly on your device.

To sync those across devices, open **Settings → Cross-device sync**:
- Enter your repo **owner**, **repo** name, **branch**, and a **GitHub token**.
- Token = a *fine-grained personal access token* scoped to **only this repo** with
  **Contents: Read and write**. Create it at GitHub → Settings → Developer settings →
  Fine-grained tokens.
- Hit **Save & push**. On another device, enter the same details and **Pull from repo**.

**Security note (read this):** the token is stored only in that device's browser (localStorage)
and is never written into the repo or the exported file. It is still a credential — use a
fine-grained token limited to this one repo, and revoke it on GitHub if a device is lost.
If you'd rather not use a token, skip sync entirely: the app works fully per-device, and
**Export/Import settings** (Settings tab) moves your edits between devices as a file.

## The numbers
- **India (net)** = listed India price × (1 − discount). Discount is per-game; if blank and the
  price is from Board Games India, it defaults to **10%** (change in Settings). MRP is ignored.
- **Import landed** = cheapest international price × (1 + forex%) × (1 + overhead%) + delivery.
- **Benefit %** = (India net − import landed) ÷ India net.
- **Verdict**: Buy ≥ 25%, Maybe ≥ 10%, else Don't Buy (thresholds editable in Settings).
- **Reset** (Settings) clears all your edits but keeps the scraped prices.

## Known limits
- Board Game Oracle's non-US coverage is patchy — many games show US-only international prices;
  the others stay blank (real, not a bug).
- India stock status is approximate.
