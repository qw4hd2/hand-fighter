// Merges hand-gesture input and keyboard into one per-player control state.
// Gestures: open palm = move (lean left/right), raise high = jump,
// fist = punch, peace = kick, three fingers = block.

const KEYMAPS = [
  { left: 'KeyA', right: 'KeyD', jump: 'KeyW', block: 'KeyS', punch: 'KeyF', kick: 'KeyG' },
  { left: 'ArrowLeft', right: 'ArrowRight', jump: 'ArrowUp', block: 'ArrowDown', punch: 'KeyK', kick: 'KeyL' },
];

const GESTURE_LABELS = {
  open: '✋ move', fist: '✊ punch', peace: '✌️ kick', three: '🤟 block',
};

function newPlayerState() {
  return {
    hMove: 0, hBlock: false,
    pendingPunch: false, pendingKick: false, pendingJump: false,
    raised: false, lastGesture: 'none',
    handPresent: false, label: '—',
  };
}

export class Controls {
  constructor(mode) {
    this.mode = mode; // 'cpu' | '2p' | 'online'
    this.keys = {};
    this.tMove = 0;        // on-screen touch buttons (always player 0)
    this.tBlock = false;
    this.p = [newPlayerState(), newPlayerState()];

    this._down = (e) => {
      this.keys[e.code] = true;
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      KEYMAPS.forEach((m, i) => {
        if (e.code === m.punch) this.p[i].pendingPunch = true;
        if (e.code === m.kick) this.p[i].pendingKick = true;
        if (e.code === m.jump) this.p[i].pendingJump = true;
      });
    };
    this._up = (e) => { this.keys[e.code] = false; };
    window.addEventListener('keydown', this._down);
    window.addEventListener('keyup', this._up);
  }

  destroy() {
    window.removeEventListener('keydown', this._down);
    window.removeEventListener('keyup', this._up);
  }

  // Called every camera frame with per-player hand states from HandTracker.
  updateHands(players) {
    for (let i = 0; i < 2; i++) {
      const h = players[i], p = this.p[i];
      if (!h || !h.present) {
        p.handPresent = false;
        p.hMove = 0; p.hBlock = false;
        continue;
      }
      p.handPresent = true;
      p.label = GESTURE_LABELS[h.gesture] || '—';

      // Map the player's camera zone to a -1..1 lean value.
      const zone = this.mode === '2p' ? (i === 0 ? [0, 0.5] : [0.5, 1]) : [0, 1];
      const center = (zone[0] + zone[1]) / 2;
      const half = ((zone[1] - zone[0]) / 2) * 0.72;
      const rel = Math.max(-1, Math.min(1, (h.x - center) / half));

      p.hMove = (h.gesture === 'open' && Math.abs(rel) > 0.28) ? rel : 0;
      p.hBlock = h.gesture === 'three';

      if (h.gesture !== p.lastGesture) {
        if (h.gesture === 'fist') p.pendingPunch = true;
        if (h.gesture === 'peace') p.pendingKick = true;
        p.lastGesture = h.gesture;
      }

      // Raise hand high to jump (with hysteresis so it fires once per raise).
      if (h.y < 0.30 && !p.raised) { p.pendingJump = true; p.raised = true; }
      else if (h.y > 0.42) p.raised = false;
    }
  }

  // On-screen touch buttons — they always drive the local player (index 0).
  touchSet(name, down) {
    const p = this.p[0];
    if (name === 'left') this.tMove = down ? -1 : (this.tMove === -1 ? 0 : this.tMove);
    else if (name === 'right') this.tMove = down ? 1 : (this.tMove === 1 ? 0 : this.tMove);
    else if (name === 'block') this.tBlock = down;
    else if (down) {
      if (name === 'punch') p.pendingPunch = true;
      if (name === 'kick') p.pendingKick = true;
      if (name === 'jump') p.pendingJump = true;
    }
  }

  // Called once per game frame; edge-triggered actions are consumed.
  consume(i) {
    const p = this.p[i], m = KEYMAPS[i];
    const kbMove = (this.keys[m.left] ? -1 : 0) + (this.keys[m.right] ? 1 : 0);
    const tMove = i === 0 ? this.tMove : 0;
    const tBlock = i === 0 && this.tBlock;
    const input = {
      move: kbMove !== 0 ? kbMove : (tMove !== 0 ? tMove : p.hMove),
      block: !!this.keys[m.block] || tBlock || p.hBlock,
      punch: p.pendingPunch,
      kick: p.pendingKick,
      jump: p.pendingJump,
    };
    p.pendingPunch = p.pendingKick = p.pendingJump = false;
    return input;
  }

  clearPending() {
    for (const p of this.p) p.pendingPunch = p.pendingKick = p.pendingJump = false;
  }

  status(i) {
    const p = this.p[i];
    return p.handPresent ? p.label : '⌨ keyboard';
  }
}
