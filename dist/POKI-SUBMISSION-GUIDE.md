# How to submit Hand Fighter to Poki — step by step

Log in at your Poki for Developers account (developers.poki.com).

## Upload
1. Click **"Create a game"** / **"Upload game"** (naming varies)
2. Game name: `Hand Fighter`
3. Upload **`hand-fighter-poki.zip`** (in this dist folder) — this build has the **Poki SDK** integrated (do NOT upload the CrazyGames zip here; each portal has its own build)
4. Poki gives you a **preview / Inspector link** — open it and play a full match to confirm everything works in their player

## Details (when their form asks)
| Field | What to enter |
|---|---|
| **Description** | reuse the description from CRAZYGAMES-SUBMISSION-GUIDE.md |
| **Category** | Action / Fighting |
| **Tags** | fighting, webcam, multiplayer, arcade, 2 player, motion controls |
| **Controls** | reuse the controls text from CRAZYGAMES-SUBMISSION-GUIDE.md |
| **Thumbnails / covers** | reuse `shots/cover-1920x1080.png`, `shots/cover-800x1200.png`, `shots/cover-800x800.png`, and the videos if asked |

## SDK integration notes (if their form or team asks)
- **Poki SDK v2** loaded from `game-cdn.poki.com/scripts/v2/poki-sdk.js`
- `PokiSDK.init()` on boot, followed by `gameLoadingFinished()`
- `gameplayStart()` / `gameplayStop()` on fight start/end and menu transitions
- **`commercialBreak()`** at natural pauses: after a finished match, on Rematch and on Exit-to-menu — audio muted during breaks, game never blocks if a break fails
- **`shareableURL({room})`** powers the online-multiplayer invite button; `getURLParam('room')` pre-fills the join screen for invited players
- Fully playable **without camera** (keyboard + touch fallback); camera video never leaves the device

## After submitting
- Poki reviews / playtests submissions — timelines vary (days to weeks). They often run your game with real players ("playtest") and share metrics before deciding.
- Whatever feedback they send, bring it back to Claude for same-day fixes.
- Never agree to exclusivity unless significant money is attached.
