# How to submit Hand Fighter to CrazyGames — step by step

Log in at **developer.crazygames.com** → click **"Submit game"** (or "Add new game").

## Game details
| Field | What to enter |
|---|---|
| **Game name** | `Hand Fighter` |
| **Category** | Action (pick "Fighting" if a subcategory exists) |
| **Tags** | fighting, webcam, multiplayer, arcade, 2 player, motion controls |
| **Description** | paste the text below |
| **Controls** | paste the controls text below |

## Files
- **Game build:** upload **`hand-fighter-crazygames.zip`** (in this dist folder) — it has their SDK v3 already integrated
- **Cover / thumbnail (16:9):** upload **`shots/cover-16x9.png`** (1280×720)
- **Screenshots:** `shots/shot-city.png`, `shots/shot-dojo.png`, `shots/shot-beach.png`

## Description (copy-paste)
```
Hand Fighter is a fighting game you control with your bare hands through the webcam. Show an open palm to move, make a fist to punch, two fingers to kick, three fingers to block, and raise your hand to jump. Chain hits into combos and knock out your rival across three stages: a neon night city, a lantern-lit dojo, and a sunset beach. Six fighters with different speed, power and health.

Play three ways: fight the CPU (Easy/Normal/Hard), share one camera with a friend for local 2-player, or create an online room and send the code to a friend anywhere in the world.

No camera? The game is fully playable with keyboard or on-screen touch controls. Camera video is processed entirely on the player's device and never uploaded.
```

## Controls (copy-paste)
```
Hand gestures (webcam): open palm = move (lean left/right), raise hand = jump, fist = punch, two fingers = kick, three fingers = block.
Keyboard: A/D = move, W = jump, S = block, F = punch, G = kick (P2: arrows + K/L).
Mobile: on-screen touch buttons.
```

## SDK integration notes (if their form or QA team asks)
- **SDK v3** loaded from `sdk.crazygames.com/crazygames-sdk-v3.js`
- `gameplayStart()` / `gameplayStop()` fire on fight start/end and menu transitions
- **Midgame ads** requested at natural breaks: after a finished match, on Rematch and on Exit-to-menu (audio muted during ads, game never blocks if an ad errors)
- `happytime()` fires on match victories
- **Invite links**: online rooms use `inviteLink({room})` and `getInviteParam` — a friend opening the invite lands directly on the join screen with the code pre-filled
- The game is fully playable **without camera permission** (keyboard + touch fallback)

## After submitting
- Their review typically takes 1–3 weeks. They often reply with QA feedback (bugs to fix, requirements) — bring any feedback back to Claude and it will be fixed.
- If accepted, you'll see your game on crazygames.com and revenue reporting appears in the developer dashboard. Payouts typically require reaching their minimum threshold.
