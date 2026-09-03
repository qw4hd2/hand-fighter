# Submitting Hand Fighter to GameDistribution — step by step

You're logged in at developer.gamedistribution.com (Azerion Connect account).

## Step 1 — Add the game to get your Game ID
1. Left menu → **Games** → **Add game** (or "+ New game")
2. Fill the basics (see the cheat sheet below). Save.
3. GameDistribution assigns a **Game ID** — a 32-character code like `49258a0e497c42b5b5d87887f24d27a6`.
   Copy it and **send it to Claude**. The final build must contain this ID (it's how their ads pay you).

## Step 2 — Claude builds the final zip
Claude runs `GD_GAME_ID=<your id> ./build.sh` → `dist/hand-fighter-gamedistribution.zip`.
Upload that zip in the game's **Files / Upload** section (index.html is at the zip root).

## Cheat sheet for the form
| Field | Answer |
|---|---|
| Title | Hand Fighter |
| Category / genre | Action / Fighting |
| Tags | fighting, webcam, multiplayer, arcade, 2 player, motion controls |
| Description | reuse the description from CRAZYGAMES-SUBMISSION-GUIDE.md |
| Controls / instructions | reuse the controls text from CRAZYGAMES-SUBMISSION-GUIDE.md |
| Mobile ready | **Yes** (touch controls, responsive, landscape hint) |
| Orientation | Landscape (works in both) |
| Game engine | Other / HTML5 (JavaScript) |
| Age rating | suitable for all / PEGI 7-12 (cartoon fighting, no blood) |
| Multiplayer | Yes — local 2P + online rooms |
| External links | None |

## Promo images (their mandatory sizes) — all in dist/shots/
- **512×512** → `gd-512x512.png`  (mandatory)
- **512×384** → `gd-512x384.png`  (mandatory)
- **200×120** → `gd-200x120.png`  (mandatory)
- **1280×550** → `gd-1280x550.png` (optional landscape)
- **1280×720** → `gd-1280x720.png` (optional landscape)
- Screenshots → `shot-city.png`, `shot-dojo.png`, `shot-beach.png`

## What's integrated in the GD build (if their form asks)
- GD HTML5 SDK: `GD_OPTIONS` (gameId + onEvent) set before the SDK loader, CDN `html5.api.gamedistribution.com/main.min.js`
- Ads requested only after `SDK_READY`; interstitials via `gdsdk.showAd()` at natural breaks (match end / rematch / exit); audio muted during ads; graceful fallback if an ad can't be filled
- `SDK_GAME_PAUSE` / `SDK_GAME_START` honored
- No external links, no login, no payments; camera is optional and processed on-device

## After submitting
GameDistribution reviews for correct SDK integration and general quality — typically days to ~2 weeks. Accepted games are syndicated to their publisher network automatically; revenue appears under **Reports**.
