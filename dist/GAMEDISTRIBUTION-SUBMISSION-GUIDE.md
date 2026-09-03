# GameDistribution — complete submission guide (everything in one file)

Dashboard: developer.gamedistribution.com (log in with your Azerion Connect account)
Path: **Games → Add Game** → fill the form below → Save → copy the **Game ID** → send it to Claude
→ upload the final zip → upload images → Submit for review.

---------------------------------------------------------------------------------------
## 1. THE FORM — field by field (copy-paste)

**Title**
```
Hand Fighter
```

**Sub Type**  →  `Javascript` (correct — keep it)

**Width / Height** (the size the game is optimized for)
```
Width: 1280      Height: 720
```

**"The Game Doesn't Contain Text"** toggle  →  leave **OFF** (the game has English text)

**Category / Genre**  →  `Action` (choose `Fighting` if a sub-genre is offered)

**Tags** (add one by one if it's a tag field)
```
fighting, webcam, multiplayer, arcade, 2 player, motion controls, gesture, beat em up
```

**Language**  →  `English`

**Description**
```
Hand Fighter is a fighting game you control with your bare hands through the webcam. Show an open palm to move, make a fist to punch, two fingers to kick, three fingers to block, and raise your hand to jump. Chain hits into combos, break your rival's guard and knock them out across three stages: a neon night city, a lantern-lit dojo and a sunset beach. Six fighters with different speed, power and health.

Play three ways: climb the Arcade ladder against all six opponents with rising difficulty, fight the CPU on Easy/Normal/Hard, share one camera with a friend for local 2-player, or create an online room and send the code to a friend anywhere in the world.

No camera? The game is fully playable with keyboard or on-screen touch controls. Camera video is processed entirely on the player's device and is never uploaded.
```

**Instructions**
```
Hand gestures (webcam): open palm = move (lean left/right), raise hand high = jump, fist = punch, two fingers = kick, three fingers = block. Keyboard: A/D move, W jump, S block, F punch, G kick (Player 2: arrow keys + K punch, L kick, Down block). Mobile: on-screen touch buttons.
```

**Key game features**
```
- Control the fight with real hand gestures through your webcam — no controller needed
- Arcade ladder: beat all six fighters in a row with rising difficulty and a champion ending
- Six fighters (Blaze, Frost, Volt, Onyx, Kira, Sensei) with different speed, power and health
- Three stages: neon night city, lantern-lit dojo, sunset beach
- Combos, blocking, hit-freeze impact, damage-trail health bars, cinematic camera
- Local 2-player on one camera, plus online rooms with a 4-letter invite code
- One-click Quick Play, three CPU difficulty levels
- Works on desktop and mobile; keyboard and touch controls always available
- Camera is optional and processed on-device — nothing is ever uploaded
```

**No Blood**  →  ✅ **check it** (cartoon fighting, no blood)

**Child Friendly**  →  ⬜ **leave unchecked**. The game is fine for kids, but flagging a game as
"child-directed" restricts the ads that can be shown (lower revenue). It is a general-audience
game, not a children's game.

**Compatibility**  →  select **both Desktop and Mobile**

**Mobile ready**  →  **Yes**

**Orientation**  →  **Landscape** (the game works in both, landscape is best)

**Multiplayer**  →  Yes (local 2-player + online rooms)

**Age rating** (if asked)  →  General audience / 7+ (no blood, no gore, no language)

**External links / login / payments**  →  None

---------------------------------------------------------------------------------------
## 2. AFTER SAVING — the Game ID
The game now appears in **Games** with a **Game ID** (32 characters, like `49258a0e497c42b5b5d87887f24d27a6`).
**Send it to Claude.** Claude puts it inside the game (this is how their ads pay YOU) and sends
back the final `hand-fighter-gamedistribution.zip`.
Do NOT upload the earlier zip — it contains a placeholder instead of your ID.

---------------------------------------------------------------------------------------
## 3. UPLOAD THE GAME
Open your game in the dashboard → **Files / Upload** → upload the final
`hand-fighter-gamedistribution.zip` (index.html is at the zip root).

---------------------------------------------------------------------------------------
## 4. UPLOAD THE IMAGES (all in Documents/gameHand/dist/shots/)
| Slot | File |
|---|---|
| 512 × 512 (mandatory) | `gd-512x512.png` |
| 512 × 384 (mandatory) | `gd-512x384.png` |
| 200 × 120 (mandatory) | `gd-200x120.png` |
| 1280 × 550 (optional) | `gd-1280x550.png` |
| 1280 × 720 (optional) | `gd-1280x720.png` |
| Screenshots | `shot-city.png`, `shot-dojo.png`, `shot-beach.png` |
| Video (if asked) | `../video-landscape-1920x1080.mp4` |

---------------------------------------------------------------------------------------
## 5. SUBMIT
Click **Submit for review**. Review usually takes days to ~2 weeks. Accepted games are
syndicated to their publisher network automatically; earnings appear under **Reports**.

---------------------------------------------------------------------------------------
## What's inside the build (if their form or reviewers ask)
- GameDistribution HTML5 SDK: `GD_OPTIONS` (your gameId + onEvent) set before the SDK loader,
  loaded from `html5.api.gamedistribution.com/main.min.js`
- Ads requested only after `SDK_READY`; interstitials via `gdsdk.showAd()` at natural breaks
  (match end, rematch, exit to menu); audio muted during ads; the game never blocks if an ad
  can't be filled
- `SDK_GAME_PAUSE` / `SDK_GAME_START` honored
- No external links, no login, no payments; camera optional and processed on-device
