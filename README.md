# Hand Fighter 🥊

A Tekken-style 2D fighting game controlled with your **hands through the webcam** — no controller needed. Comes in two flavors:

- **PC game (recommended)** — native desktop app: Python + Pygame + MediaPipe. Works offline.
- **Web version** — plain HTML/JS canvas, runs in a browser.

## 🎮 PC game

**Play:** double-click `HandFighter.command` in Finder, or run:

```bash
./venv/bin/python hand_fighter.py
```

The first time you start a fight, macOS will ask for camera permission — click **Allow**, then start the fight again if the camera didn't kick in.

If you ever need to reinstall the environment:

```bash
/opt/homebrew/bin/python3.12 -m venv venv
./venv/bin/pip install -r requirements.txt
```

(MediaPipe needs Python ≤ 3.12. The hand-tracking model is already in `assets/hand_landmarker.task`.)

Developer checks: `python hand_fighter.py --selftest` (headless engine test), `python hand_fighter.py --screenshot shots` (render screens to PNGs).

## 🌐 Web version

The repo root is the marketing website (`index.html`, `about.html`, `privacy.html`, `contact.html`); the game itself lives in **`game/`**.

```bash
python3 -m http.server 8123
```

Then open <http://localhost:8123> (site) or <http://localhost:8123/game/> (game directly) and allow camera access. Needs internet on first load (MediaPipe comes from a CDN).

Portal builds: `./build.sh` produces `dist/hand-fighter-web.zip` (itch.io / CrazyGames) and `dist/hand-fighter-poki.zip`.

## How to play

Each player enters a name and picks a fighter (Blaze, Frost, Volt, or Onyx — different speed/power/health).

| Gesture | Action |
|---|---|
| ✋ Open palm, lean left/right | Move |
| ✋ Raise hand high | Jump |
| ✊ Fist | Punch |
| ✌️ Two fingers | Kick |
| 🤟 Three fingers | Block |

**Modes**
- **1 Player vs CPU** — your hand anywhere in the camera view controls your fighter.
- **2 Players** — stand side by side; the left half of the camera controls P1, the right half controls P2.
- **Online Match** (web version) — play against a friend anywhere in the world. One player clicks CREATE ROOM and shares the 4-letter code; the other clicks JOIN and types it in. Peer-to-peer over WebRTC (PeerJS) — no game server needed. The room creator's browser runs the match; the joiner uses P1 keys (A/D/W/S/F/G) or hand gestures.

**Keyboard backup** (always active): P1 `A/D` move, `W` jump, `S` block, `F` punch, `G` kick · P2 arrows + `K` punch, `L` kick, `↓` block. `ESC` quits to the menu.

Best of 3 rounds, 60 seconds each. KO or highest health when time runs out wins the round.
