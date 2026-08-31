# Resubmitting Hand Fighter to CrazyGames

Their FAQ: *"Yes, you're welcome to resubmit your game. Before doing so, please make
sure you've made meaningful improvements."* — We made them. Here's how to resubmit.

## Steps (in your existing dashboard entry — do NOT "Remove game")
1. Open the Hand Fighter entry on developer.crazygames.com
2. **Game Versions** tab → upload the new **`hand-fighter-crazygames.zip`**
3. **Art** tab → replace all images with the new ones (new cel-shaded art):
   - Landscape 16:9 → `shots/cover-1920x1080.png`
   - Portrait 2:3 → `shots/cover-800x1200.png`
   - Square 1:1 → `shots/cover-800x800.png`
   - Videos → `video-landscape-1920x1080.mp4`, `video-portrait-1080x1920.mp4`
   - Screenshots (if asked) → `shots/shot-city.png`, `shots/shot-dojo.png`, `shots/shot-beach.png`
4. Submit for review. If there's a notes/message field, paste the changelog below.

## Changelog to paste (what changed since the rejection)
```
Major update since our previous submission:

VISUALS — complete character art overhaul: cel-shaded fighters with unified
outlines, cylindrical light/shadow shading, layered depth rendering, expressive
faces, detailed hands/feet. New covers, screenshots and preview videos reflect it.

DEPTH — new ARCADE ladder mode: fight all six fighters in sequence with rising
difficulty (easy → hard) and a champion ending. Plus the existing 1P (3 difficulty
levels), local 2-player, and online multiplayer with invite links.

ONBOARDING — new one-click QUICK PLAY from the menu straight into gameplay
(per your guideline of max 1 click to gameplay); the menu now shows a live
animated sparring demo and an animated controls guide.

COMPLIANCE — custom fullscreen handling is disabled on CrazyGames (platform
fullscreen only); SDK v3 integration unchanged: midgame ads at natural breaks,
gameplayStart/Stop, happytime, invite links + instant multiplayer, lobby 2/2.

The game is fully playable without camera permission (keyboard + touch);
hand tracking is an opt-in bonus. Camera video never leaves the device.
```

## Reminder before you click submit
- Play a few matches yourself on the live build first (arcade + one online match).
- Re-upload `hand-fighter-web.zip` on itch.io too, so the public page shows the new art.
