#!/usr/bin/env python3
"""Hand Fighter — a native PC fighting game controlled by hand gestures via webcam.

Gestures: open palm = move (lean left/right), raise hand high = jump,
fist = punch, two fingers = kick, three fingers = block.
Keyboard always works: P1 A/D/W/S + F punch / G kick, P2 arrows + K/L.

Run:        python hand_fighter.py
Self test:  python hand_fighter.py --selftest
Screenshots: python hand_fighter.py --screenshot <dir>
"""
import math
import os
import random
import sys
import threading
import time

os.environ.setdefault('PYGAME_HIDE_SUPPORT_PROMPT', '1')

SELFTEST = '--selftest' in sys.argv
SHOT_DIR = None
if '--screenshot' in sys.argv:
    SHOT_DIR = sys.argv[sys.argv.index('--screenshot') + 1]
if SELFTEST or SHOT_DIR:
    os.environ['SDL_VIDEODRIVER'] = 'dummy'
    os.environ['SDL_AUDIODRIVER'] = 'dummy'

import pygame  # noqa: E402  (import after env setup)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(BASE_DIR, 'assets', 'hand_landmarker.task')

# ---------------------------------------------------------------- constants
W, H = 1280, 720          # window
ARENA_H = 620             # fight area height; strip below holds camera/status
FLOOR = 564
GRAV, JUMP_V, WALK = 2600.0, 900.0, 250.0
ARENA_L, ARENA_R = 90, W - 90
ROUND_TIME, WINS_NEEDED = 60.0, 2

ATTACKS = {
    'punch': dict(startup=0.08, active=0.12, recovery=0.16, range=96, dmg=8, knock=220, stun=0.30),
    'kick':  dict(startup=0.16, active=0.13, recovery=0.30, range=124, dmg=14, knock=330, stun=0.44),
}

NEUTRAL = dict(move=0.0, jump=False, punch=False, kick=False, block=False)

CHARACTERS = [
    dict(id='blaze', name='Blaze', color='#ff5533', accent='#ffd166', skin='#f2c197',
         speed=1.12, power=1.0, hp=100, desc='Balanced striker'),
    dict(id='frost', name='Frost', color='#3fb8f5', accent='#e0f7ff', skin='#e8b58c',
         speed=0.95, power=0.9, hp=120, desc='Tanky defender'),
    dict(id='volt', name='Volt', color='#ffd91f', accent='#8c6bff', skin='#c98d5a',
         speed=1.35, power=0.82, hp=88, desc='Lightning fast'),
    dict(id='onyx', name='Onyx', color='#9b6bff', accent='#2b2d42', skin='#8d5524',
         speed=0.88, power=1.28, hp=96, desc='Heavy hitter'),
]


def hexc(s):
    s = s.lstrip('#')
    return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16))


def shade(rgb, f):
    return (int(rgb[0] * f), int(rgb[1] * f), int(rgb[2] * f))


def clamp(v, a, b):
    return a if v < a else b if v > b else v


# ---------------------------------------------------------------- sound
class SFX:
    def __init__(self):
        self.sounds = {}
        self.ok = False
        try:
            import numpy as np
            self.np = np
            if not pygame.mixer.get_init():
                pygame.mixer.init(frequency=22050, size=-16, channels=1)
            self.ok = pygame.mixer.get_init() is not None
            if self.ok:
                self._build()
        except Exception:
            self.ok = False

    def _tone(self, freq, dur, vol=0.3, shape='sine', slide=None, decay=4.0):
        np = self.np
        n = int(22050 * dur)
        t = np.linspace(0, dur, n, False)
        f = np.linspace(freq, slide if slide else freq, n)
        phase = np.cumsum(2 * np.pi * f / 22050)
        if shape == 'square':
            w = np.sign(np.sin(phase))
        elif shape == 'tri':
            w = 2 / np.pi * np.arcsin(np.sin(phase))
        else:
            w = np.sin(phase)
        return w * vol * np.exp(-t * (decay / dur))

    def _noise(self, dur, vol=0.2):
        np = self.np
        n = int(22050 * dur)
        return (np.random.uniform(-1, 1, n)) * vol * np.linspace(1, 0, n)

    def _mk(self, *parts):
        np = self.np
        n = max(p.size for p in parts)
        mix = np.zeros(n)
        for p in parts:
            mix[:p.size] += p
        mix = np.clip(mix, -1, 1)
        return pygame.sndarray.make_sound((mix * 32000).astype(np.int16))

    def _seq(self, specs):
        """Concatenate tones one after another (for the win jingle)."""
        np = self.np
        return self._mk(np.concatenate([self._tone(*s) for s in specs]))

    def _build(self):
        self.sounds = {
            'whoosh': self._mk(self._noise(0.12, 0.15)),
            'hit': self._mk(self._tone(160, 0.16, 0.4, 'square', 55), self._noise(0.1, 0.2)),
            'block': self._mk(self._tone(700, 0.1, 0.25, 'tri', 500)),
            'jump': self._mk(self._tone(240, 0.15, 0.15, 'sine', 480)),
            'bell': self._mk(self._tone(880, 0.5, 0.25), self._tone(1320, 0.4, 0.12)),
            'ko': self._mk(self._tone(130, 0.9, 0.5, 'sine', 40), self._noise(0.3, 0.25)),
            'win': self._seq([(523, 0.2, 0.25), (659, 0.2, 0.25), (784, 0.45, 0.3)]),
        }

    def play(self, name):
        if self.ok and name in self.sounds:
            try:
                self.sounds[name].play()
            except Exception:
                pass


# ---------------------------------------------------------------- hand tracking
def classify_gesture(lm):
    """lm: sequence of 21 landmarks with .x/.y attributes."""
    def d(a, b):
        return math.hypot(lm[a].x - lm[b].x, lm[a].y - lm[b].y)

    def ext(tip, pip):
        return d(tip, 0) > d(pip, 0) * 1.18

    idx, mid = ext(8, 6), ext(12, 10)
    ring, pinky = ext(16, 14), ext(20, 18)
    count = idx + mid + ring + pinky
    if count >= 4:
        return 'open'
    if count == 3:
        return 'three'
    if count == 2:
        return 'peace' if (idx and mid) else 'three'
    return 'fist'


class HandTracker(threading.Thread):
    """Camera + MediaPipe worker. Publishes .players and a small .preview frame."""

    def __init__(self, two_player):
        super().__init__(daemon=True)
        self.two_player = two_player
        self.players = [None, None]
        self.preview = None       # RGB bytes tuple: (bytes, w, h)
        self.status = 'starting camera...'
        self.running = True

    def stop(self):
        self.running = False

    def run(self):
        try:
            import cv2
            import mediapipe as mp
            from mediapipe.tasks import python as mp_python
            from mediapipe.tasks.python import vision
        except Exception as e:
            self.status = 'tracking libs failed - keyboard only'
            print('HandTracker import error:', e)
            return
        try:
            cap = cv2.VideoCapture(0)
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 360)
            if not cap.isOpened():
                self.status = 'no camera - keyboard only'
                return
            self.status = 'loading hand model...'
            opts = vision.HandLandmarkerOptions(
                base_options=mp_python.BaseOptions(model_asset_path=MODEL_PATH),
                running_mode=vision.RunningMode.VIDEO,
                num_hands=2,
            )
            landmarker = vision.HandLandmarker.create_from_options(opts)
            self.status = 'camera ready - show your hand'
            t0 = time.monotonic()
            colors = [(51, 85, 255), (245, 184, 63)]  # BGR per player
            while self.running:
                ok, frame = cap.read()
                if not ok:
                    time.sleep(0.02)
                    continue
                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                mp_img = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
                ts = int((time.monotonic() - t0) * 1000)
                try:
                    res = landmarker.detect_for_video(mp_img, ts)
                except Exception:
                    continue

                players = [None, None]
                for hand in (res.hand_landmarks or []):
                    cx = sum(hand[i].x for i in (0, 5, 9, 13, 17)) / 5
                    cy = sum(hand[i].y for i in (0, 5, 9, 13, 17)) / 5
                    mx = 1 - cx
                    state = dict(present=True, x=mx, y=cy,
                                 gesture=classify_gesture(hand), lm=hand)
                    slot = (0 if mx < 0.5 else 1) if self.two_player else 0
                    if players[slot] is None:
                        players[slot] = state
                self.players = players

                # small mirrored preview with landmark dots
                pv = cv2.flip(cv2.resize(frame, (240, 135)), 1)
                if self.two_player:
                    cv2.line(pv, (120, 0), (120, 135), (255, 255, 255), 1)
                for i, p in enumerate(players):
                    if p:
                        for l in p['lm']:
                            cv2.circle(pv, (int((1 - l.x) * 240), int(l.y * 135)),
                                       2, colors[i], -1)
                pv = cv2.cvtColor(pv, cv2.COLOR_BGR2RGB)
                self.preview = (pv.tobytes(), 240, 135)
            cap.release()
        except Exception as e:
            self.status = 'camera failed - keyboard only'
            print('HandTracker error:', e)


# ---------------------------------------------------------------- input
KEYMAPS = [
    dict(left=pygame.K_a, right=pygame.K_d, jump=pygame.K_w,
         block=pygame.K_s, punch=pygame.K_f, kick=pygame.K_g),
    dict(left=pygame.K_LEFT, right=pygame.K_RIGHT, jump=pygame.K_UP,
         block=pygame.K_DOWN, punch=pygame.K_k, kick=pygame.K_l),
]
GESTURE_LABELS = dict(open='MOVE', fist='PUNCH', peace='KICK', three='BLOCK')


class Controls:
    def __init__(self, mode):
        self.mode = mode  # 'cpu' | '2p'
        self.p = [self._new(), self._new()]

    @staticmethod
    def _new():
        return dict(h_move=0.0, h_block=False,
                    pending_punch=False, pending_kick=False, pending_jump=False,
                    raised=False, last_gesture='none',
                    hand_present=False, label='-')

    def handle_event(self, e):
        if e.type == pygame.KEYDOWN:
            for i, m in enumerate(KEYMAPS):
                p = self.p[i]
                if e.key == m['punch']:
                    p['pending_punch'] = True
                elif e.key == m['kick']:
                    p['pending_kick'] = True
                elif e.key == m['jump']:
                    p['pending_jump'] = True

    def update_hands(self, players):
        for i in range(2):
            h, p = players[i], self.p[i]
            if not h or not h.get('present'):
                p['hand_present'] = False
                p['h_move'] = 0.0
                p['h_block'] = False
                continue
            p['hand_present'] = True
            p['label'] = GESTURE_LABELS.get(h['gesture'], '-')

            zone = ((0, 0.5) if i == 0 else (0.5, 1)) if self.mode == '2p' else (0, 1)
            center = (zone[0] + zone[1]) / 2
            half = (zone[1] - zone[0]) / 2 * 0.72
            rel = clamp((h['x'] - center) / half, -1, 1)

            p['h_move'] = rel if (h['gesture'] == 'open' and abs(rel) > 0.28) else 0.0
            p['h_block'] = h['gesture'] == 'three'

            if h['gesture'] != p['last_gesture']:
                if h['gesture'] == 'fist':
                    p['pending_punch'] = True
                if h['gesture'] == 'peace':
                    p['pending_kick'] = True
                p['last_gesture'] = h['gesture']

            if h['y'] < 0.30 and not p['raised']:
                p['pending_jump'] = True
                p['raised'] = True
            elif h['y'] > 0.42:
                p['raised'] = False

    def consume(self, i):
        p, m = self.p[i], KEYMAPS[i]
        keys = pygame.key.get_pressed()
        kb_move = (-1 if keys[m['left']] else 0) + (1 if keys[m['right']] else 0)
        out = dict(
            move=kb_move if kb_move else p['h_move'],
            block=bool(keys[m['block']]) or p['h_block'],
            punch=p['pending_punch'], kick=p['pending_kick'], jump=p['pending_jump'],
        )
        p['pending_punch'] = p['pending_kick'] = p['pending_jump'] = False
        return out

    def clear_pending(self):
        for p in self.p:
            p['pending_punch'] = p['pending_kick'] = p['pending_jump'] = False

    def status(self, i):
        p = self.p[i]
        return ('hand: ' + p['label']) if p['hand_present'] else 'keyboard'


# ---------------------------------------------------------------- fighter
def limb(surf, a, b, bend, w, color):
    mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
    dx, dy = b[0] - a[0], b[1] - a[1]
    ln = math.hypot(dx, dy) or 1.0
    e = (mx - dy / ln * bend, my + dx / ln * bend)
    pygame.draw.line(surf, color, a, e, w)
    pygame.draw.line(surf, color, e, b, w)
    r = w // 2
    for pt in (a, e, b):
        pygame.draw.circle(surf, color, pt, r)


class Fighter:
    def __init__(self, cfg, side, sfx):
        self.name = cfg['name']
        self.ch = cfg['ch']
        self.side = side
        self.sfx = sfx
        self.max_hp = cfg['ch']['hp']
        self.disp_hp = float(self.max_hp)
        self.reset()

    def reset(self):
        self.hp = self.max_hp
        self.x = W * (0.32 if self.side == 0 else 0.68)
        self.y = 0.0
        self.vy = 0.0
        self.state = 'idle'
        self.t = 0.0
        self.anim = random.random() * 10
        self.facing = 1 if self.side == 0 else -1
        self.hit_done = False
        self.knock_v = 0.0
        self.stun = 0.0
        self.walk_dir = 1

    @property
    def grounded(self):
        return self.y <= 0.001

    @property
    def attacking(self):
        return self.state in ('punch', 'kick')

    @property
    def can_act(self):
        return self.state in ('idle', 'walk', 'block') and self.grounded

    def set_state(self, s):
        self.state = s
        self.t = 0.0
        if s in ('punch', 'kick'):
            self.hit_done = False

    def attack_phase(self):
        a = ATTACKS.get(self.state)
        if not a:
            return 0.0, False
        t = self.t
        if t < a['startup']:
            return t / a['startup'], False
        if t < a['startup'] + a['active']:
            return 1.0, True
        r = (t - a['startup'] - a['active']) / a['recovery']
        return 1.0 - min(r, 1.0), False

    def update(self, dt, inp, opp, game):
        self.anim += dt
        self.t += dt

        if self.state == 'ko':
            if self.y > 0:
                self.y = max(0.0, self.y + self.vy * dt)
                self.vy -= GRAV * dt
            return

        if not self.attacking and self.state != 'hit':
            self.facing = 1 if opp.x >= self.x else -1

        if not self.grounded:
            self.y += self.vy * dt
            self.vy -= GRAV * dt
            if self.y <= 0:
                self.y = 0.0
                self.vy = 0.0
                if self.state == 'jump':
                    self.set_state('idle')

        st = self.state
        if st == 'hit':
            self.x += self.knock_v * dt
            self.knock_v *= max(0.0, 1 - 8 * dt)
            if self.t >= self.stun:
                self.set_state('idle')
        elif st in ('punch', 'kick'):
            a = ATTACKS[st]
            _, active = self.attack_phase()
            if active and not self.hit_done:
                game.try_hit(self, opp, a)
            if self.t >= a['startup'] + a['active'] + a['recovery']:
                self.set_state('idle')
        elif st == 'block':
            if not inp['block']:
                self.set_state('idle')
        else:  # idle / walk / jump
            if inp['punch'] and self.can_act:
                self.set_state('punch')
                self.sfx.play('whoosh')
            elif inp['kick'] and self.can_act:
                self.set_state('kick')
                self.sfx.play('whoosh')
            elif inp['block'] and self.grounded:
                self.set_state('block')
            else:
                if inp['jump'] and self.grounded:
                    self.vy = JUMP_V
                    self.y = 0.01
                    self.set_state('jump')
                    self.sfx.play('jump')
                mv = clamp(inp['move'], -1, 1)
                if mv:
                    self.x += mv * WALK * self.ch['speed'] * (1.0 if self.grounded else 0.65) * dt
                    if self.grounded and self.state != 'walk':
                        self.set_state('walk')
                    self.walk_dir = 1 if mv > 0 else -1
                elif self.state == 'walk':
                    self.set_state('idle')

        self.x = clamp(self.x, ARENA_L, ARENA_R)

    def take_hit(self, dmg, direction, atk, blocked, game):
        if blocked:
            self.hp -= max(1, round(dmg * 0.15))
            self.knock_v = direction * atk['knock'] * 0.45
            self.stun = 0.16
            self.set_state('hit')
            self.sfx.play('block')
        else:
            self.hp -= dmg
            self.knock_v = direction * atk['knock']
            self.stun = atk['stun']
            self.set_state('hit')
            self.sfx.play('hit')
            game.shake = 8.0
        if self.hp <= 0:
            self.hp = 0
            self.set_state('ko')
            self.vy = 260.0
            self.y = max(self.y, 0.01)
            self.sfx.play('ko')

    # ------------------------------------------------ drawing
    def draw(self, surf):
        d = self.facing
        c = self.ch
        base = FLOOR - self.y
        flash = self.state == 'hit' and self.t < 0.1
        col = (255, 255, 255) if flash else hexc(c['color'])
        col_dark = (221, 221, 221) if flash else shade(hexc(c['color']), 0.55)
        skin = (255, 255, 255) if flash else hexc(c['skin'])
        accent = (255, 255, 255) if flash else hexc(c['accent'])

        # shadow
        sw = 46 * max(0.4, 1 - self.y / 300)
        sh = pygame.Surface((int(sw * 2), 18), pygame.SRCALPHA)
        pygame.draw.ellipse(sh, (0, 0, 0, 90), sh.get_rect())
        surf.blit(sh, (self.x - sw, FLOOR + 3))

        # KO fall: rotate every point around the feet
        ang = 0.0
        if self.state == 'ko':
            fall = min(1.0, self.t * 2.2)
            ang = -d * fall * math.pi / 2 * 0.96
        ca, sa = math.cos(ang), math.sin(ang)

        def tp(p):
            if not ang:
                return p
            dx, dy = p[0] - self.x, p[1] - base
            return (self.x + dx * ca - dy * sa, base + dx * sa + dy * ca)

        ext = self.attack_phase()[0] if self.attacking else 0.0
        lean, crouch = 0.0, 0.0
        if self.state == 'punch':
            lean = d * 8 * ext
        elif self.state == 'kick':
            lean = -d * 12 * ext
        elif self.state == 'block':
            crouch = 8.0
        elif self.state == 'hit':
            lean = -d * 16

        bob = math.sin(self.anim * 5) * 2.5 if self.state == 'idle' else 0.0
        hip = (self.x - d * 2 + lean * 0.4, base - 74 + crouch + bob)
        sho = (self.x + lean, base - 126 + crouch * 1.5 + bob)

        hand_f = (sho[0] + d * 26, sho[1] + 16)
        hand_b = (sho[0] + d * 12, sho[1] + 24)
        foot_f = (self.x + d * 14, base)
        foot_b = (self.x - d * 16, base)

        st = self.state
        if st == 'walk':
            p2 = self.anim * 10
            foot_f = (self.x + math.sin(p2) * 18, base - max(0, math.sin(p2)) * 7)
            foot_b = (self.x - math.sin(p2) * 18, base - max(0, -math.sin(p2)) * 7)
        elif st == 'jump':
            foot_f = (self.x + d * 10, base - 26)
            foot_b = (self.x - d * 8, base - 34)
            hand_f = (sho[0] + d * 30, sho[1] + 4)
            hand_b = (sho[0] - d * 14, sho[1] + 10)
        elif st == 'punch':
            hand_f = (sho[0] + d * (18 + 72 * ext), sho[1] + 14 - 6 * ext)
        elif st == 'kick':
            foot_f = (hip[0] + d * (12 + 96 * ext), hip[1] + 46 - 66 * ext)
            foot_b = (self.x - d * 10, base)
            hand_f = (sho[0] - d * 4, sho[1] + 20)
            hand_b = (sho[0] - d * 18, sho[1] + 10)
        elif st == 'block':
            hand_f = (sho[0] + d * 24, sho[1] + 6)
            hand_b = (sho[0] + d * 18, sho[1] + 26)
        elif st == 'hit':
            hand_f = (sho[0] - d * 6, sho[1] - 6)
            hand_b = (sho[0] - d * 20, sho[1] + 2)

        hip, sho = tp(hip), tp(sho)
        hand_f, hand_b = tp(hand_f), tp(hand_b)
        foot_f, foot_b = tp(foot_f), tp(foot_b)

        limb(surf, hip, foot_b, d * 12, 13, col_dark)
        limb(surf, (sho[0], sho[1] - 4), hand_b, d * 10, 11, col_dark)

        # torso
        pygame.draw.line(surf, col, hip, sho, 26)
        pygame.draw.circle(surf, col, hip, 13)
        pygame.draw.circle(surf, col, sho, 13)
        # belt
        pygame.draw.line(surf, accent,
                         (hip[0] - 14, hip[1] - 4), (hip[0] + 14, hip[1] - 4), 6)

        limb(surf, hip, foot_f, -d * 10, 13, col)

        # shoes
        pygame.draw.circle(surf, col_dark, (foot_f[0], foot_f[1] - 2), 7)
        pygame.draw.circle(surf, col_dark, (foot_b[0], foot_b[1] - 2), 7)

        # head + headband
        hx, hy = sho[0] + d * 3 + lean * 0.15, sho[1] - 30
        pygame.draw.circle(surf, skin, (hx, hy), 16)
        pygame.draw.line(surf, accent, (hx - 15, hy - 6), (hx + 15, hy - 6), 5)
        fl = math.sin(self.anim * 7) * 4
        pygame.draw.lines(surf, accent, False,
                          [(hx - d * 14, hy - 6), (hx - d * 26, hy - 2 + fl),
                           (hx - d * 34, hy + 6 - fl)], 4)
        pygame.draw.circle(surf, (27, 27, 40), (hx + d * 7, hy - 2), 3)

        limb(surf, (sho[0], sho[1] - 2), hand_f, -d * 12, 11, col)

        # fists
        pygame.draw.circle(surf, skin, hand_f, 7)
        pygame.draw.circle(surf, skin, hand_b, 6)

        # strike glow on active frames
        if self.attacking and self.attack_phase()[1]:
            pt = hand_f if self.state == 'punch' else foot_f
            glow = pygame.Surface((60, 60), pygame.SRCALPHA)
            pygame.draw.circle(glow, (255, 160, 60, 70), (30, 30), 28)
            pygame.draw.circle(glow, (255, 240, 180, 160), (30, 30), 14)
            surf.blit(glow, (pt[0] - 30, pt[1] - 30))


# ---------------------------------------------------------------- game
class Game:
    def __init__(self, cfg, controls, sfx, on_match_end=None):
        self.cfg = cfg
        self.controls = controls
        self.sfx = sfx
        self.on_match_end = on_match_end
        self.f = [Fighter(cfg['p1'], 0, sfx), Fighter(cfg['p2'], 1, sfx)]
        self.wins = [0, 0]
        self.round = 1
        self.particles = []
        self.shake = 0.0
        self.banner = None
        self.ai = dict(think=0.0, move=0.0, block_t=0.0)
        self.start_round()

    def start_round(self):
        for f in self.f:
            f.reset()
        self.time = ROUND_TIME
        self.phase = 'intro'
        self.phase_t = 0.0
        self.controls.clear_pending()

    def update(self, dt):
        self.phase_t += dt
        self.shake *= max(0.0, 1 - 10 * dt)

        for p in self.particles:
            p['x'] += p['vx'] * dt
            p['y'] += p['vy'] * dt
            p['vy'] += 900 * dt
            p['life'] -= dt
        self.particles = [p for p in self.particles if p['life'] > 0]

        if self.phase == 'intro':
            for f in self.f:
                f.anim += dt
            if self.phase_t >= 2.0:
                self.phase = 'fight'
                self.phase_t = 0.0
                self.sfx.play('bell')
            return

        if self.phase == 'fight':
            self.time -= dt
            i0 = self.controls.consume(0)
            i1 = self.ai_input(dt) if self.cfg['mode'] == 'cpu' else self.controls.consume(1)
            self.f[0].update(dt, i0, self.f[1], self)
            self.f[1].update(dt, i1, self.f[0], self)
            self.push_apart()
            if self.time <= 0 and self.phase == 'fight':
                a, b = self.f
                winner = -1 if a.hp == b.hp else (0 if a.hp > b.hp else 1)
                self.round_over(winner, 'TIME UP')
            return

        if self.phase == 'roundend':
            self.f[0].update(dt, NEUTRAL, self.f[1], self)
            self.f[1].update(dt, NEUTRAL, self.f[0], self)
            if self.phase_t >= 2.6:
                if max(self.wins) >= WINS_NEEDED:
                    self.phase = 'matchend'
                    w = 0 if self.wins[0] > self.wins[1] else 1
                    self.banner = dict(main=self.f[w].name.upper() + ' WINS!', sub='match over')
                    self.sfx.play('win')
                    if self.on_match_end:
                        self.on_match_end(w)
                else:
                    self.round += 1
                    self.start_round()

    def push_apart(self):
        a, b = self.f
        if a.state == 'ko' or b.state == 'ko':
            return
        dx = b.x - a.x
        overlap = 56 - abs(dx)
        if overlap > 0 and abs(a.y - b.y) < 100:
            direction = 1 if dx >= 0 else -1
            a.x = clamp(a.x - direction * overlap / 2, ARENA_L, ARENA_R)
            b.x = clamp(b.x + direction * overlap / 2, ARENA_L, ARENA_R)

    def try_hit(self, att, defender, a):
        dx = (defender.x - att.x) * att.facing
        if dx < 8 or dx > a['range'] + 38:
            return
        if abs(defender.y - att.y) > 95:
            return
        att.hit_done = True
        blocked = defender.state == 'block'
        dmg = max(1, round(a['dmg'] * att.ch['power']))
        defender.take_hit(dmg, att.facing, a, blocked, self)
        self.spawn_sparks(att.x + att.facing * a['range'] * 0.7,
                          FLOOR - defender.y - 100, blocked)
        if defender.hp <= 0:
            self.round_over(0 if att is self.f[0] else 1, 'K.O.!')

    def round_over(self, winner_idx, label):
        if self.phase != 'fight':
            return
        self.phase = 'roundend'
        self.phase_t = 0.0
        if winner_idx >= 0:
            self.wins[winner_idx] += 1
            self.banner = dict(main=label,
                               sub=f'{self.f[winner_idx].name} takes round {self.round}')
        else:
            self.banner = dict(main=label, sub='draw round')

    def spawn_sparks(self, x, y, blocked):
        colors = ([(127, 212, 255), (255, 255, 255)] if blocked
                  else [(255, 179, 71), (255, 85, 51), (255, 225, 77), (255, 255, 255)])
        for _ in range(14):
            ang = random.random() * math.pi * 2
            sp = 120 + random.random() * 320
            self.particles.append(dict(
                x=x, y=y,
                vx=math.cos(ang) * sp, vy=math.sin(ang) * sp - 120,
                life=0.25 + random.random() * 0.3,
                size=2 + random.random() * 3.5,
                color=random.choice(colors),
            ))

    # ------------------------------------------------ CPU
    def ai_input(self, dt):
        me, op = self.f[1], self.f[0]
        ai = self.ai
        ai['think'] -= dt
        if ai['block_t'] > 0:
            ai['block_t'] -= dt

        inp = dict(move=ai['move'], jump=False, punch=False, kick=False,
                   block=ai['block_t'] > 0)
        if ai['think'] <= 0:
            ai['think'] = 0.1 + random.random() * 0.14
            dx = op.x - me.x
            adx = abs(dx)
            direction = 1 if dx >= 0 else -1
            ai['move'] = 0.0

            if op.attacking and adx < 170 and random.random() < 0.4:
                ai['block_t'] = 0.35
            elif adx > 160:
                ai['move'] = direction
                if random.random() < 0.05:
                    inp['jump'] = True
            elif adx > 105:
                if random.random() < 0.45:
                    ai['move'] = direction
                elif random.random() < 0.5:
                    inp['kick'] = True
            else:
                r = random.random()
                if r < 0.34:
                    inp['punch'] = True
                elif r < 0.55:
                    inp['kick'] = True
                elif r < 0.7:
                    ai['block_t'] = 0.4
                elif r < 0.85:
                    ai['move'] = -direction
            inp['move'] = ai['move']
            inp['block'] = ai['block_t'] > 0
        return inp


# ---------------------------------------------------------------- app / UI
FONT_SPEC = 'impact,arialblack,helveticaneue,arial'


class App:
    def __init__(self):
        pygame.init()
        pygame.display.set_caption('Hand Fighter')
        self.screen = pygame.display.set_mode((W, H))
        self.clock = pygame.time.Clock()
        self.sfx = SFX()
        self.fonts = {
            'title': pygame.font.SysFont(FONT_SPEC, 92),
            'banner': pygame.font.SysFont(FONT_SPEC, 72),
            'h2': pygame.font.SysFont(FONT_SPEC, 40),
            'btn': pygame.font.SysFont(FONT_SPEC, 30),
            'sub': pygame.font.SysFont('verdana,arial', 20, bold=True),
            'ui': pygame.font.SysFont('verdana,arial', 16, bold=True),
            'small': pygame.font.SysFont('verdana,arial', 13),
        }
        self.bg = self.make_bg()
        self.arena = pygame.Surface((W, ARENA_H))
        self.state = 'menu'
        self.mode = 'cpu'
        self.chars = [0, 1]
        self.names = ['Player 1', 'Player 2']
        self.active_input = None
        self.game = None
        self.controls = None
        self.tracker = None
        self.buttons = {}

    # ---------- shared drawing helpers
    def text(self, surf, key, s, pos, color, align='center', outline=None):
        img = self.fonts[key].render(s, True, color)
        r = img.get_rect(**{align: pos} if align != 'topleft' else {'topleft': pos})
        if outline:
            o = self.fonts[key].render(s, True, outline)
            for off in ((-3, 0), (3, 0), (0, -3), (0, 3), (-2, -2), (2, 2), (-2, 2), (2, -2)):
                surf.blit(o, (r.x + off[0], r.y + off[1]))
        surf.blit(img, r)
        return r

    def button(self, surf, name, rect, label, primary=True, font='btn'):
        rect = pygame.Rect(rect)
        hover = rect.collidepoint(pygame.mouse.get_pos())
        if primary:
            pygame.draw.rect(surf, (122, 31, 14), rect.move(0, 5), border_radius=14)
            col = (255, 138, 76) if hover else (232, 92, 48)
            pygame.draw.rect(surf, col, rect, border_radius=14)
            pygame.draw.rect(surf, (255, 209, 102), rect, 3, border_radius=14)
        else:
            col = (70, 66, 92) if hover else (48, 45, 66)
            pygame.draw.rect(surf, col, rect, border_radius=10)
            pygame.draw.rect(surf, (140, 136, 160), rect, 2, border_radius=10)
        self.text(surf, font, label, rect.center, (255, 255, 255))
        self.buttons[name] = rect
        return rect

    def make_bg(self):
        s = pygame.Surface((W, ARENA_H))
        stops = [(0.0, hexc('#0d0d1c')), (0.6, hexc('#241539')), (1.0, hexc('#4a2440'))]
        for y in range(FLOOR):
            t = y / FLOOR
            for i in range(len(stops) - 1):
                t0, c0 = stops[i]
                t1, c1 = stops[i + 1]
                if t0 <= t <= t1:
                    k = (t - t0) / (t1 - t0)
                    col = tuple(int(c0[j] + (c1[j] - c0[j]) * k) for j in range(3))
                    break
            pygame.draw.line(s, col, (0, y), (W, y))

        # moon + glow
        glow = pygame.Surface((260, 260), pygame.SRCALPHA)
        for r, a in ((130, 18), (95, 26), (60, 40)):
            pygame.draw.circle(glow, (255, 210, 150, a), (130, 130), r)
        s.blit(glow, (W * 0.79 - 130, 110 - 130))
        pygame.draw.circle(s, (255, 220, 170), (int(W * 0.79), 110), 42)

        # skyline
        for i in range(9):
            bw = 90 + (i * 53) % 70
            bh = 70 + (i * 97) % 130
            pygame.draw.rect(s, hexc('#141024'), (i * 150 - 20, FLOOR - bh, bw, bh))
        # pagoda
        pygame.draw.polygon(s, hexc('#1c1430'),
                            [(W * 0.42, FLOOR - 190), (W * 0.56, FLOOR - 190),
                             (W * 0.60, FLOOR - 160), (W * 0.38, FLOOR - 160)])
        pygame.draw.rect(s, hexc('#1c1430'), (W * 0.45, FLOOR - 160, W * 0.08, 160))

        # floor
        fl0, fl1 = hexc('#3a2a4a'), hexc('#120c1c')
        for y in range(FLOOR, ARENA_H):
            t = (y - FLOOR) / (ARENA_H - FLOOR)
            col = tuple(int(fl0[j] + (fl1[j] - fl0[j]) * t) for j in range(3))
            pygame.draw.line(s, col, (0, y), (W, y))
        pygame.draw.line(s, (150, 110, 150), (0, FLOOR), (W, FLOOR), 2)
        return s

    # ---------- screens
    def draw_menu(self):
        self.buttons = {}
        scr = self.screen
        scr.fill(hexc('#100d1e'))
        t1 = self.fonts['title'].render('HAND', True, (255, 226, 122))
        t2 = self.fonts['title'].render('FIGHTER', True, (255, 85, 51))
        total = t1.get_width() + t2.get_width()
        scr.blit(t1, (W / 2 - total / 2, 60))
        scr.blit(t2, (W / 2 - total / 2 + t1.get_width(), 60))
        self.text(scr, 'sub', 'Fight with your hands - no controller, just your camera',
                  (W / 2, 185), (200, 195, 220))

        self.button(scr, '1p', (W / 2 - 290, 240, 260, 74), '1 PLAYER  (vs CPU)')
        self.button(scr, '2p', (W / 2 + 30, 240, 260, 74), '2 PLAYERS')

        box = pygame.Rect(W / 2 - 380, 360, 760, 300)
        pygame.draw.rect(scr, (20, 17, 36), box, border_radius=16)
        pygame.draw.rect(scr, (70, 66, 100), box, 2, border_radius=16)
        lines = [
            ('HAND CONTROLS', (255, 209, 102)),
            ('OPEN PALM  - lean left / right to move', None),
            ('RAISE HAND HIGH - jump', None),
            ('FIST - punch      TWO FINGERS (peace) - kick', None),
            ('THREE FINGERS - block', None),
            ('', None),
            ('KEYBOARD', (255, 209, 102)),
            ('P1:  A / D move,  W jump,  S block,  F punch,  G kick', None),
            ('P2:  arrows move / jump / block,  K punch,  L kick', None),
        ]
        yy = box.y + 28
        for txt, col in lines:
            if txt:
                self.text(scr, 'ui', txt, (W / 2, yy), col or (225, 222, 240))
            yy += 30

    def draw_setup(self):
        self.buttons = {}
        scr = self.screen
        scr.fill(hexc('#100d1e'))
        self.text(scr, 'h2', 'CHOOSE YOUR FIGHTER', (W / 2, 46), (255, 226, 122))

        panel_w, panel_h = 580, 470
        for pi in range(2):
            px = 40 + pi * (panel_w + 40)
            panel = pygame.Rect(px, 90, panel_w, panel_h)
            pygame.draw.rect(scr, (20, 17, 36), panel, border_radius=16)
            pygame.draw.rect(scr, (70, 66, 100), panel, 2, border_radius=16)
            title = 'PLAYER 1' if pi == 0 else ('CPU OPPONENT' if self.mode == 'cpu' else 'PLAYER 2')
            self.text(scr, 'ui', title, (px + 20, panel.y + 26), (255, 209, 102), align='midleft')

            # name box
            nb = pygame.Rect(px + 20, panel.y + 46, panel_w - 40, 40)
            editable = not (pi == 1 and self.mode == 'cpu')
            active = self.active_input == pi and editable
            pygame.draw.rect(scr, (35, 32, 54), nb, border_radius=8)
            pygame.draw.rect(scr, (255, 209, 102) if active else (90, 86, 120), nb, 2, border_radius=8)
            nm = self.names[pi] if editable else 'CPU'
            cursor = '|' if active and (time.time() % 1 < 0.5) else ''
            self.text(scr, 'ui', nm + cursor, (nb.x + 12, nb.centery), (255, 255, 255), align='midleft')
            self.buttons[f'name{pi}'] = nb

            # character cards 2x2
            cw, chh = (panel_w - 60) // 2, 160
            for ci, c in enumerate(CHARACTERS):
                cx = px + 20 + (ci % 2) * (cw + 20)
                cy = panel.y + 104 + (ci // 2) * (chh + 16)
                card = pygame.Rect(cx, cy, cw, chh)
                sel = self.chars[pi] == ci
                pygame.draw.rect(scr, (48, 40, 30) if sel else (30, 27, 46), card, border_radius=12)
                pygame.draw.rect(scr, (255, 209, 102) if sel else (80, 76, 108),
                                 card, 3 if sel else 2, border_radius=12)
                col = hexc(c['color'])
                pygame.draw.circle(scr, col, (card.centerx, card.y + 42), 26)
                self.text(scr, 'btn', c['name'][0], (card.centerx, card.y + 42), (22, 18, 31))
                self.text(scr, 'ui', c['name'], (card.centerx, card.y + 86), (255, 255, 255))
                self.text(scr, 'small', c['desc'], (card.centerx, card.y + 108), (190, 186, 210))
                stats = (f"SPD {'|' * round(c['speed'] * 3)}  "
                         f"PWR {'|' * round(c['power'] * 3)}  "
                         f"HP {'|' * round(c['hp'] / 40)}")
                self.text(scr, 'small', stats, (card.centerx, card.y + 130), (255, 209, 102))
                self.buttons[f'char{pi}_{ci}'] = card

        self.button(scr, 'back', (W / 2 - 330, 590, 140, 56), 'BACK', primary=False, font='ui')
        self.button(scr, 'fight', (W / 2 - 160, 578, 320, 80), 'FIGHT!')

    def draw_fight(self):
        self.buttons = {}
        g = self.game
        scr = self.screen
        arena = self.arena
        arena.blit(self.bg, (0, 0))

        g.f[1].draw(arena)
        g.f[0].draw(arena)

        for p in g.particles:
            a = clamp(p['life'] * 4, 0, 1)
            ps = pygame.Surface((int(p['size'] * 2) + 2,) * 2, pygame.SRCALPHA)
            pygame.draw.circle(ps, (*p['color'], int(a * 255)),
                               (ps.get_width() // 2,) * 2, p['size'])
            arena.blit(ps, (p['x'] - p['size'], p['y'] - p['size']))

        self.draw_hud(arena)
        self.draw_banner(arena)

        # shake
        ox = oy = 0
        if g.shake > 0.3:
            ox = (random.random() - 0.5) * g.shake * 2
            oy = (random.random() - 0.5) * g.shake * 2
        scr.fill((6, 5, 12))
        scr.blit(arena, (ox, oy))

        # bottom strip: hints + camera preview + status
        strip = pygame.Rect(0, ARENA_H, W, H - ARENA_H)
        pygame.draw.rect(scr, (16, 13, 28), strip)
        pygame.draw.line(scr, (70, 66, 100), (0, ARENA_H), (W, ARENA_H), 2)

        self.text(scr, 'small', 'OPEN PALM move / raise = jump', (30, ARENA_H + 30),
                  (170, 166, 195), align='midleft')
        self.text(scr, 'small', 'FIST punch  -  PEACE kick  -  3 FINGERS block',
                  (30, ARENA_H + 55), (170, 166, 195), align='midleft')
        self.text(scr, 'small', 'ESC - quit to menu', (W - 30, ARENA_H + 30),
                  (170, 166, 195), align='midright')

        cam_status = 'keyboard only'
        if self.tracker:
            cam_status = self.tracker.status
            if self.tracker.preview:
                buf, pw, ph = self.tracker.preview
                img = pygame.image.frombuffer(buf, (pw, ph), 'RGB')
                img = pygame.transform.smoothscale(img, (160, 90))
                r = img.get_rect(center=(W / 2, ARENA_H + 50))
                scr.blit(img, r)
                pygame.draw.rect(scr, (140, 136, 170), r, 2, border_radius=4)
        self.text(scr, 'small', cam_status, (W / 2, ARENA_H + 50 if not (self.tracker and self.tracker.preview) else H - 5),
                  (255, 209, 102), align='center' if not (self.tracker and self.tracker.preview) else 'midbottom')

        if g.phase == 'matchend':
            self.button(scr, 'rematch', (W / 2 - 340, 400, 220, 66), 'REMATCH')
            self.button(scr, 'change', (W / 2 - 90, 406, 220, 54), 'CHANGE FIGHTERS', primary=False, font='ui')
            self.button(scr, 'menu', (W / 2 + 160, 406, 160, 54), 'MAIN MENU', primary=False, font='ui')

    def draw_hud(self, surf):
        g = self.game
        bar_w, bar_h, y = 430, 26, 26
        for i in range(2):
            f = g.f[i]
            f.disp_hp += (f.hp - f.disp_hp) * 0.15
            pct = max(0.0, f.disp_hp / f.max_hp)
            x = 40 if i == 0 else W - 40 - bar_w

            pygame.draw.rect(surf, (10, 8, 18), (x - 3, y - 3, bar_w + 6, bar_h + 6), border_radius=8)
            hp_col = (76, 175, 80) if pct > 0.5 else (255, 179, 0) if pct > 0.25 else (229, 57, 53)
            fill = int(bar_w * pct)
            if fill > 4:
                fx = x + bar_w - fill if i == 0 else x
                pygame.draw.rect(surf, hp_col, (fx, y, fill, bar_h), border_radius=5)
            self.text(surf, 'ui', f.name,
                      (x + 10 if i == 0 else x + bar_w - 10, y + bar_h / 2),
                      (255, 255, 255), align='midleft' if i == 0 else 'midright')

            for wi in range(WINS_NEEDED):
                px = x + 12 + wi * 22 if i == 0 else x + bar_w - 12 - wi * 22
                col = hexc(f.ch['color']) if wi < g.wins[i] else (60, 56, 80)
                pygame.draw.circle(surf, col, (px, y + bar_h + 16), 7)

            status = 'CPU' if (g.cfg['mode'] == 'cpu' and i == 1) else self.controls.status(i)
            self.text(surf, 'small', status,
                      (x + 66 if i == 0 else x + bar_w - 66, y + bar_h + 16),
                      (200, 196, 220), align='midleft' if i == 0 else 'midright')

        # timer
        pygame.draw.circle(surf, (10, 8, 18), (W // 2, y + 16), 30)
        pygame.draw.circle(surf, (140, 136, 170), (W // 2, y + 16), 30, 2)
        t_col = (255, 107, 107) if g.time < 10 else (255, 255, 255)
        self.text(surf, 'btn', str(max(0, math.ceil(g.time))), (W // 2, y + 16), t_col)

    def draw_banner(self, surf):
        g = self.game
        main = sub = None
        if g.phase == 'intro':
            if g.phase_t < 1.2:
                main = f'ROUND {g.round}'
                sub = f'{g.f[0].name}  vs  {g.f[1].name}'
            else:
                main = 'FIGHT!'
        elif g.phase == 'fight' and g.phase_t < 0.5:
            main = 'FIGHT!'
        elif g.phase in ('roundend', 'matchend') and g.banner:
            main = g.banner['main']
            sub = g.banner['sub']
        if not main:
            return
        self.text(surf, 'banner', main, (W / 2, ARENA_H / 2 - 40),
                  (255, 207, 94), outline=(27, 16, 38))
        if sub:
            self.text(surf, 'sub', sub, (W / 2, ARENA_H / 2 + 30),
                      (255, 255, 255), outline=(27, 16, 38))

    # ---------- state transitions
    def start_fight(self, with_tracker=True):
        cfg = dict(
            mode=self.mode,
            p1=dict(name=self.names[0].strip() or 'Player 1', ch=CHARACTERS[self.chars[0]]),
            p2=dict(name=('CPU ' + CHARACTERS[self.chars[1]]['name']) if self.mode == 'cpu'
                    else (self.names[1].strip() or 'Player 2'),
                    ch=CHARACTERS[self.chars[1]]),
        )
        self.controls = Controls(self.mode)
        self.game = Game(cfg, self.controls, self.sfx)
        if with_tracker:
            self.tracker = HandTracker(two_player=self.mode == '2p')
            self.tracker.start()
        self.state = 'fight'

    def stop_fight(self):
        if self.tracker:
            self.tracker.stop()
            self.tracker = None
        self.game = None
        self.controls = None

    # ---------- main loop
    def run(self):
        running = True
        while running:
            dt = min(0.033, self.clock.tick(60) / 1000)
            clicks = []
            for e in pygame.event.get():
                if e.type == pygame.QUIT:
                    running = False
                elif e.type == pygame.MOUSEBUTTONDOWN and e.button == 1:
                    clicks.append(e.pos)
                elif self.state == 'fight' and self.controls:
                    self.controls.handle_event(e)
                if e.type == pygame.KEYDOWN:
                    if e.key == pygame.K_ESCAPE:
                        if self.state == 'fight':
                            self.stop_fight()
                            self.state = 'menu'
                        elif self.state == 'setup':
                            self.state = 'menu'
                    elif self.state == 'setup' and self.active_input is not None:
                        if e.key == pygame.K_BACKSPACE:
                            i = self.active_input
                            self.names[i] = self.names[i][:-1]
                        elif e.key in (pygame.K_RETURN, pygame.K_TAB):
                            self.active_input = None
                if e.type == pygame.TEXTINPUT and self.state == 'setup' and self.active_input is not None:
                    i = self.active_input
                    if len(self.names[i]) < 14:
                        self.names[i] += e.text

            if self.state == 'menu':
                self.draw_menu()
                for pos in clicks:
                    if self.buttons.get('1p', pygame.Rect(0, 0, 0, 0)).collidepoint(pos):
                        self.mode = 'cpu'
                        self.state = 'setup'
                    elif self.buttons.get('2p', pygame.Rect(0, 0, 0, 0)).collidepoint(pos):
                        self.mode = '2p'
                        self.state = 'setup'

            elif self.state == 'setup':
                self.draw_setup()
                for pos in clicks:
                    self.active_input = None
                    for name, rect in self.buttons.items():
                        if not rect.collidepoint(pos):
                            continue
                        if name == 'back':
                            self.state = 'menu'
                        elif name == 'fight':
                            self.start_fight()
                        elif name.startswith('name'):
                            pi = int(name[4])
                            if not (pi == 1 and self.mode == 'cpu'):
                                self.active_input = pi
                        elif name.startswith('char'):
                            pi, ci = name[4:].split('_')
                            self.chars[int(pi)] = int(ci)

            elif self.state == 'fight':
                if self.tracker:
                    self.controls.update_hands(self.tracker.players)
                self.game.update(dt)
                self.draw_fight()
                for pos in clicks:
                    for name, rect in self.buttons.items():
                        if not rect.collidepoint(pos):
                            continue
                        if name == 'rematch':
                            self.stop_fight()
                            self.start_fight()
                        elif name == 'change':
                            self.stop_fight()
                            self.state = 'setup'
                        elif name == 'menu':
                            self.stop_fight()
                            self.state = 'menu'

            pygame.display.flip()

        self.stop_fight()
        pygame.quit()


# ---------------------------------------------------------------- test modes
def selftest():
    app = App()
    app.mode = 'cpu'
    app.start_fight(with_tracker=False)
    g = app.game
    events = []
    last = (g.phase, g.round)
    for step in range(90 * 60):
        if step % 30 == 0:
            app.controls.p[0]['pending_punch'] = True
            if g.phase == 'fight':
                g.f[0].x = g.f[1].x - 70
        g.update(1 / 60)
        if (g.phase, g.round) != last:
            events.append(f't={step / 60:.1f}s phase={g.phase} round={g.round} '
                          f'wins={g.wins} banner={g.banner}')
            last = (g.phase, g.round)
        if g.phase == 'matchend':
            break
    for ev in events:
        print(ev)
    assert g.phase == 'matchend', 'match never ended'
    print('SELFTEST OK')


def screenshots(outdir):
    os.makedirs(outdir, exist_ok=True)
    app = App()

    app.draw_menu()
    pygame.image.save(app.screen, os.path.join(outdir, 'menu.png'))

    app.mode = 'cpu'
    app.state = 'setup'
    app.draw_setup()
    pygame.image.save(app.screen, os.path.join(outdir, 'setup.png'))

    app.start_fight(with_tracker=False)
    g = app.game
    g.phase = 'fight'
    g.phase_t = 1.0
    for step in range(150):
        if step % 25 == 0:
            app.controls.p[0]['pending_punch'] = True
            g.f[0].x = g.f[1].x - 80
        g.update(1 / 60)
    app.draw_fight()
    pygame.image.save(app.screen, os.path.join(outdir, 'fight.png'))
    print('screenshots saved to', outdir)


if __name__ == '__main__':
    if SELFTEST:
        selftest()
    elif SHOT_DIR:
        screenshots(SHOT_DIR)
    else:
        App().run()
