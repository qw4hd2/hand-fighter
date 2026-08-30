// Fight engine: fighters, combat, rounds, CPU opponent, and canvas rendering.
import { sfx } from './sfx.js';

export const W = 1280, H = 620;
const FLOOR = H - 56;
const GRAV = 2600, JUMP_V = 900, WALK = 250;
const ARENA = { left: 90, right: W - 90 };
const ROUND_TIME = 60, WINS_NEEDED = 2;

const ATTACKS = {
  punch: { startup: 0.08, active: 0.12, recovery: 0.16, range: 96, dmg: 8, knock: 220, stun: 0.30 },
  kick:  { startup: 0.16, active: 0.13, recovery: 0.30, range: 124, dmg: 14, knock: 330, stun: 0.44 },
};

const NEUTRAL = { move: 0, jump: false, punch: false, kick: false, block: false };

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * f);
  const g = Math.round(((n >> 8) & 255) * f);
  const b = Math.round((n & 255) * f);
  return `rgb(${r},${g},${b})`;
}

// Two-segment limb drawn as a curve with a fake elbow/knee bend.
function limb(ctx, x1, y1, x2, y2, bend, w, color) {
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
  const ex = mx + (-dy / len) * bend, ey = my + (dx / len) * bend;
  ctx.strokeStyle = color; ctx.lineWidth = w;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.quadraticCurveTo(ex, ey, x2, y2); ctx.stroke();
}

class Fighter {
  constructor(cfg, side) {
    this.name = cfg.name;
    this.ch = cfg.ch;
    this.side = side;
    this.maxHp = cfg.ch.hp;
    this.dispHp = cfg.ch.hp;
    this.reset();
  }

  reset() {
    this.hp = this.maxHp;
    this.x = this.side === 0 ? W * 0.32 : W * 0.68;
    this.y = 0; this.vy = 0;
    this.state = 'idle'; this.t = 0; this.anim = Math.random() * 10;
    this.facing = this.side === 0 ? 1 : -1;
    this.hitDone = false; this.knockV = 0; this.stun = 0;
    this.walkDir = 1;
  }

  get grounded() { return this.y <= 0.001; }
  get attacking() { return this.state === 'punch' || this.state === 'kick'; }
  get canAct() { return ['idle', 'walk', 'block'].includes(this.state) && this.grounded; }

  setState(s) { this.state = s; this.t = 0; if (s === 'punch' || s === 'kick') this.hitDone = false; }

  attackPhase() {
    const a = ATTACKS[this.state];
    if (!a) return { ext: 0, active: false };
    const t = this.t;
    if (t < a.startup) return { ext: t / a.startup, active: false };
    if (t < a.startup + a.active) return { ext: 1, active: true };
    const r = (t - a.startup - a.active) / a.recovery;
    return { ext: 1 - Math.min(r, 1), active: false };
  }

  update(dt, inp, opp, game) {
    this.anim += dt; this.t += dt;

    if (this.state === 'ko') {
      if (this.y > 0) { this.y = Math.max(0, this.y + this.vy * dt); this.vy -= GRAV * dt; }
      return;
    }

    if (!this.attacking && this.state !== 'hit') this.facing = opp.x >= this.x ? 1 : -1;

    if (!this.grounded) {
      this.y += this.vy * dt; this.vy -= GRAV * dt;
      if (this.y <= 0) { this.y = 0; this.vy = 0; if (this.state === 'jump') this.setState('idle'); }
    }

    switch (this.state) {
      case 'hit':
        this.x += this.knockV * dt;
        this.knockV *= Math.max(0, 1 - 8 * dt);
        if (this.t >= this.stun) this.setState('idle');
        break;

      case 'punch': case 'kick': {
        const a = ATTACKS[this.state];
        const ph = this.attackPhase();
        if (ph.active && !this.hitDone) game.tryHit(this, opp, a, this.state);
        if (this.t >= a.startup + a.active + a.recovery) this.setState('idle');
        break;
      }

      case 'block':
        if (!inp.block) this.setState('idle');
        break;

      default: { // idle / walk / jump
        if (inp.punch && this.canAct) { this.setState('punch'); sfx.play('whoosh'); break; }
        if (inp.kick && this.canAct) { this.setState('kick'); sfx.play('whoosh'); break; }
        if (inp.block && this.grounded) { this.setState('block'); break; }
        if (inp.jump && this.grounded) { this.vy = JUMP_V; this.y = 0.01; this.setState('jump'); sfx.play('jump'); }
        const mv = clamp(inp.move, -1, 1);
        if (mv !== 0) {
          this.x += mv * WALK * this.ch.speed * (this.grounded ? 1 : 0.65) * dt;
          if (this.grounded && this.state !== 'walk') this.setState('walk');
          this.walkDir = Math.sign(mv);
        } else if (this.state === 'walk') this.setState('idle');
      }
    }
    this.x = clamp(this.x, ARENA.left, ARENA.right);
  }

  takeHit(dmg, dir, atk, blocked, game) {
    if (blocked) {
      this.hp -= Math.max(1, Math.round(dmg * 0.15));
      this.knockV = dir * atk.knock * 0.45;
      this.stun = 0.16;
      this.setState('hit');
      sfx.play('block');
    } else {
      this.hp -= dmg;
      this.knockV = dir * atk.knock;
      this.stun = atk.stun;
      this.setState('hit');
      sfx.play('hit');
      game.shake = 8;
    }
    if (this.hp <= 0) {
      this.hp = 0;
      this.setState('ko');
      this.vy = 260; this.y = Math.max(this.y, 0.01);
      sfx.play('ko');
    }
  }

  // ---------- rendering ----------
  draw(ctx) {
    const d = this.facing, c = this.ch;
    const base = FLOOR - this.y;
    const flash = this.state === 'hit' && this.t < 0.1;
    const col = flash ? '#ffffff' : c.color;
    const colDark = flash ? '#dddddd' : shade(c.color, 0.55);
    const skin = flash ? '#ffffff' : c.skin;

    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    const sw = 46 * Math.max(0.4, 1 - this.y / 300);
    ctx.beginPath(); ctx.ellipse(this.x, FLOOR + 12, sw, 9, 0, 0, Math.PI * 2); ctx.fill();

    ctx.save();
    if (this.state === 'ko') {
      const fall = Math.min(1, this.t * 2.2);
      ctx.translate(this.x, base);
      ctx.rotate(-d * fall * Math.PI / 2 * 0.96);
      ctx.translate(-this.x, -base);
    }

    // pose parameters
    let lean = 0, crouch = 0, ext = 0;
    if (this.attacking) ext = this.attackPhase().ext;
    if (this.state === 'punch') lean = d * 8 * ext;
    if (this.state === 'kick') lean = -d * 12 * ext;
    if (this.state === 'block') crouch = 8;
    if (this.state === 'hit') lean = -d * 16;

    const bob = (this.state === 'idle') ? Math.sin(this.anim * 5) * 2.5 : 0;
    const hip = { x: this.x - d * 2 + lean * 0.4, y: base - 74 + crouch + bob };
    const sho = { x: this.x + lean, y: base - 126 + crouch * 1.5 + bob };

    // default guard pose
    let handF = { x: sho.x + d * 26, y: sho.y + 16 };
    let handB = { x: sho.x + d * 12, y: sho.y + 24 };
    let footF = { x: this.x + d * 14, y: base };
    let footB = { x: this.x - d * 16, y: base };

    switch (this.state) {
      case 'walk': {
        const p2 = this.anim * 10;
        footF = { x: this.x + Math.sin(p2) * 18, y: base - Math.max(0, Math.sin(p2)) * 7 };
        footB = { x: this.x - Math.sin(p2) * 18, y: base - Math.max(0, -Math.sin(p2)) * 7 };
        break;
      }
      case 'jump':
        footF = { x: this.x + d * 10, y: base - 26 };
        footB = { x: this.x - d * 8, y: base - 34 };
        handF = { x: sho.x + d * 30, y: sho.y + 4 };
        handB = { x: sho.x - d * 14, y: sho.y + 10 };
        break;
      case 'punch':
        handF = { x: sho.x + d * (18 + 72 * ext), y: sho.y + 14 - 6 * ext };
        break;
      case 'kick':
        footF = { x: hip.x + d * (12 + 96 * ext), y: hip.y + 46 - 66 * ext };
        footB = { x: this.x - d * 10, y: base };
        handF = { x: sho.x - d * 4, y: sho.y + 20 };
        handB = { x: sho.x - d * 18, y: sho.y + 10 };
        break;
      case 'block':
        handF = { x: sho.x + d * 24, y: sho.y + 6 };
        handB = { x: sho.x + d * 18, y: sho.y + 26 };
        break;
      case 'hit':
        handF = { x: sho.x - d * 6, y: sho.y - 6 };
        handB = { x: sho.x - d * 20, y: sho.y + 2 };
        break;
    }

    // back limbs first, front limbs last for depth
    limb(ctx, hip.x, hip.y, footB.x, footB.y, d * 12, 13, colDark);
    limb(ctx, sho.x, sho.y - 4, handB.x, handB.y, d * 10, 11, colDark);

    // torso
    ctx.strokeStyle = col; ctx.lineWidth = 26; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(hip.x, hip.y); ctx.lineTo(sho.x, sho.y); ctx.stroke();
    // belt
    ctx.strokeStyle = flash ? '#fff' : c.accent; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(hip.x - 14, hip.y - 4); ctx.lineTo(hip.x + 14, hip.y - 4); ctx.stroke();

    limb(ctx, hip.x, hip.y, footF.x, footF.y, -d * 10, 13, col);

    // shoes
    ctx.fillStyle = colDark;
    ctx.beginPath(); ctx.arc(footF.x, footF.y - 2, 7, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(footB.x, footB.y - 2, 7, 0, 7); ctx.fill();

    // head
    const hx = sho.x + d * 3 + lean * 0.15, hy = sho.y - 30;
    ctx.fillStyle = skin;
    ctx.beginPath(); ctx.arc(hx, hy, 16, 0, 7); ctx.fill();
    // headband + fluttering tail
    ctx.strokeStyle = flash ? '#fff' : c.accent; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(hx - 15, hy - 6); ctx.lineTo(hx + 15, hy - 6); ctx.stroke();
    const fl = Math.sin(this.anim * 7) * 4;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(hx - d * 14, hy - 6);
    ctx.quadraticCurveTo(hx - d * 26, hy - 2 + fl, hx - d * 34, hy + 6 - fl);
    ctx.stroke();
    // eye
    ctx.fillStyle = '#1b1b28';
    ctx.beginPath(); ctx.arc(hx + d * 7, hy - 2, 2.4, 0, 7); ctx.fill();

    limb(ctx, sho.x, sho.y - 2, handF.x, handF.y, -d * 12, 11, col);

    // fists
    ctx.fillStyle = skin;
    ctx.beginPath(); ctx.arc(handF.x, handF.y, 7, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(handB.x, handB.y, 6, 0, 7); ctx.fill();

    // strike glow on active frames
    if (this.attacking && this.attackPhase().active) {
      const pt = this.state === 'punch' ? handF : footF;
      const g = ctx.createRadialGradient(pt.x, pt.y, 2, pt.x, pt.y, 26);
      g.addColorStop(0, 'rgba(255,240,180,0.9)');
      g.addColorStop(1, 'rgba(255,160,60,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, 26, 0, 7); ctx.fill();
    }

    ctx.restore();
  }
}

export class Game {
  constructor(canvas, cfg, controls, callbacks) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cfg = cfg;
    this.controls = controls;
    this.cb = callbacks || {};

    this.f = [new Fighter(cfg.p1, 0), new Fighter(cfg.p2, 1)];
    this.wins = [0, 0];
    this.round = 1;
    this.particles = [];
    this.shake = 0;
    this.banner = null;

    this.ai = { think: 0, move: 0, punch: false, kick: false, blockT: 0, jump: false };
    // Latest input received from the remote player (net-host mode).
    this.remote = { move: 0, block: false, punch: false, kick: false, jump: false };

    this.running = true;
    this.lastT = performance.now();
    this.startRound();
    window.__game = this; // debug handle
    requestAnimationFrame((t) => this._tick(t));
  }

  destroy() { this.running = false; }

  startRound() {
    this.f.forEach(f => f.reset());
    this.time = ROUND_TIME;
    this.phase = 'intro';
    this.phaseT = 0;
    if (this.controls.clearPending) this.controls.clearPending();
  }

  _tick(now) {
    if (!this.running) return;
    requestAnimationFrame((t) => this._tick(t));
    const dt = Math.min(0.033, (now - this.lastT) / 1000);
    this.lastT = now;
    this.update(dt);
    this.draw();
  }

  update(dt) {
    this.phaseT += dt;
    this.shake *= Math.max(0, 1 - 10 * dt);

    this.particles.forEach(p => {
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vy += 900 * dt; p.life -= dt;
    });
    this.particles = this.particles.filter(p => p.life > 0);

    // Ghost mode (online guest): state comes from the host via applyState();
    // locally we only advance animation time.
    if (this.cfg.mode === 'ghost') {
      this.f.forEach(f => { f.anim += dt; });
      return;
    }

    if (this.phase === 'intro') {
      this.f.forEach(f => { f.anim += dt; });
      if (this.phaseT >= 2.0) { this.phase = 'fight'; this.phaseT = 0; sfx.play('bell'); }
      return;
    }

    if (this.phase === 'fight') {
      this.time -= dt;
      const i0 = this.controls.consume(0);
      let i1;
      if (this.cfg.mode === 'cpu') i1 = this.aiInput(dt);
      else if (this.cfg.mode === 'net-host') i1 = this.consumeRemote();
      else i1 = this.controls.consume(1);
      this.f[0].update(dt, i0, this.f[1], this);
      this.f[1].update(dt, i1, this.f[0], this);
      this.pushApart();
      if (this.time <= 0 && this.phase === 'fight') {
        const [a, b] = this.f;
        const winner = a.hp === b.hp ? -1 : (a.hp > b.hp ? 0 : 1);
        this.roundOver(winner, 'TIME UP');
      }
      return;
    }

    if (this.phase === 'roundend') {
      this.f[0].update(dt, NEUTRAL, this.f[1], this);
      this.f[1].update(dt, NEUTRAL, this.f[0], this);
      if (this.phaseT >= 2.6) {
        const best = Math.max(...this.wins);
        if (best >= WINS_NEEDED) {
          this.phase = 'matchend';
          const w = this.wins[0] > this.wins[1] ? 0 : 1;
          this.banner = { main: `${this.f[w].name.toUpperCase()} WINS!`, sub: 'match over' };
          sfx.play('win');
          if (this.cb.onMatchEnd) this.cb.onMatchEnd(w);
        } else {
          this.round++;
          this.startRound();
        }
      }
    }
  }

  pushApart() {
    const [a, b] = this.f;
    if (a.state === 'ko' || b.state === 'ko') return;
    const dx = b.x - a.x;
    const overlap = 56 - Math.abs(dx);
    if (overlap > 0 && Math.abs(a.y - b.y) < 100) {
      const dir = dx >= 0 ? 1 : -1;
      a.x = clamp(a.x - dir * overlap / 2, ARENA.left, ARENA.right);
      b.x = clamp(b.x + dir * overlap / 2, ARENA.left, ARENA.right);
    }
  }

  tryHit(att, def, a, kind) {
    const dx = (def.x - att.x) * att.facing;
    if (dx < 8 || dx > a.range + 38) return;
    if (Math.abs(def.y - att.y) > 95) return;
    att.hitDone = true;

    const blocked = def.state === 'block';
    const dmg = Math.max(1, Math.round(a.dmg * att.ch.power));
    def.takeHit(dmg, att.facing, a, blocked, this);

    this.spawnSparks(
      att.x + att.facing * a.range * 0.7,
      FLOOR - def.y - 100,
      blocked
    );
    if (def.hp <= 0) {
      const wIdx = att === this.f[0] ? 0 : 1;
      this.roundOver(wIdx, 'K.O.!');
    }
  }

  roundOver(winnerIdx, label) {
    if (this.phase !== 'fight') return;
    this.phase = 'roundend'; this.phaseT = 0;
    if (winnerIdx >= 0) {
      this.wins[winnerIdx]++;
      this.banner = { main: label, sub: `${this.f[winnerIdx].name} takes round ${this.round}` };
    } else {
      this.banner = { main: label, sub: 'draw round' };
    }
  }

  spawnSparks(x, y, blocked) {
    const colors = blocked ? ['#7fd4ff', '#ffffff'] : ['#ffb347', '#ff5533', '#ffe14d', '#ffffff'];
    for (let i = 0; i < 14; i++) {
      const ang = Math.random() * Math.PI * 2, sp = 120 + Math.random() * 320;
      this.particles.push({
        x, y,
        vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 120,
        life: 0.25 + Math.random() * 0.3,
        size: 2 + Math.random() * 3.5,
        color: colors[(Math.random() * colors.length) | 0],
      });
    }
  }

  // ---------- online play ----------
  setRemoteInput(p) {
    this.remote.move = +p.move || 0;
    this.remote.block = !!p.block;
    // Edge-triggered actions accumulate until the next simulated frame.
    if (p.punch) this.remote.punch = true;
    if (p.kick) this.remote.kick = true;
    if (p.jump) this.remote.jump = true;
  }

  consumeRemote() {
    const r = { ...this.remote };
    this.remote.punch = this.remote.kick = this.remote.jump = false;
    return r;
  }

  getState() {
    return {
      f: this.f.map(f => ({
        x: Math.round(f.x * 10) / 10, y: Math.round(f.y * 10) / 10,
        st: f.state, t: Math.round(f.t * 1000) / 1000, fc: f.facing, hp: f.hp,
      })),
      time: this.time, phase: this.phase, pt: this.phaseT,
      wins: this.wins, round: this.round, banner: this.banner,
    };
  }

  applyState(s) {
    if (!s || !s.f) return;
    s.f.forEach((sf, i) => {
      const f = this.f[i];
      if (sf.st !== f.state) {
        if (sf.st === 'punch' || sf.st === 'kick') sfx.play('whoosh');
        else if (sf.st === 'jump') sfx.play('jump');
        else if (sf.st === 'hit') {
          sfx.play('hit');
          this.spawnSparks(sf.x + (this.f[1 - i].x - sf.x) * 0.25, FLOOR - sf.y - 100, false);
          this.shake = 6;
        } else if (sf.st === 'ko') sfx.play('ko');
      }
      f.x = sf.x; f.y = sf.y; f.state = sf.st; f.t = sf.t;
      f.facing = sf.fc; f.hp = sf.hp;
    });
    if (this.phase === 'intro' && s.phase === 'fight') sfx.play('bell');
    if (s.phase === 'matchend' && this.phase !== 'matchend') {
      sfx.play('win');
      if (this.cb.onMatchEnd) this.cb.onMatchEnd();
    }
    this.time = s.time; this.phase = s.phase; this.phaseT = s.pt;
    this.wins = s.wins; this.round = s.round; this.banner = s.banner;
  }

  statusFor(i) {
    const m = this.cfg.mode;
    if (m === 'cpu' && i === 1) return '🤖 CPU';
    if (m === 'net-host') return i === 0 ? this.controls.status(0) : '🌐 online';
    if (m === 'ghost') return i === (this.cfg.ownSide ?? 1) ? this.controls.status(0) : '🌐 online';
    return this.controls.status(i);
  }

  // ---------- CPU opponent ----------
  aiInput(dt) {
    const me = this.f[1], op = this.f[0];
    const ai = this.ai;
    ai.think -= dt;
    if (ai.blockT > 0) ai.blockT -= dt;

    const inp = { move: ai.move, jump: false, punch: false, kick: false, block: ai.blockT > 0 };

    if (ai.think <= 0) {
      ai.think = 0.1 + Math.random() * 0.14;
      const dx = op.x - me.x;
      const adx = Math.abs(dx);
      const dir = Math.sign(dx) || 1;
      ai.move = 0;

      if (op.attacking && adx < 170 && Math.random() < 0.4) {
        ai.blockT = 0.35;
      } else if (adx > 160) {
        ai.move = dir;
        if (Math.random() < 0.05) inp.jump = true;
      } else if (adx > 105) {
        if (Math.random() < 0.45) ai.move = dir;
        else if (Math.random() < 0.5) inp.kick = true;
      } else {
        const r = Math.random();
        if (r < 0.34) inp.punch = true;
        else if (r < 0.55) inp.kick = true;
        else if (r < 0.7) ai.blockT = 0.4;
        else if (r < 0.85) ai.move = -dir;
      }
      inp.move = ai.move;
      inp.block = ai.blockT > 0;
    }
    return inp;
  }

  // ---------- rendering ----------
  draw() {
    const ctx = this.ctx;
    ctx.save();
    if (this.shake > 0.3) {
      ctx.translate((Math.random() - 0.5) * this.shake * 2, (Math.random() - 0.5) * this.shake * 2);
    }

    this.drawBg(ctx);
    this.f[1].draw(ctx);
    this.f[0].draw(ctx);

    for (const p of this.particles) {
      ctx.globalAlpha = Math.min(1, p.life * 4);
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;

    this.drawHud(ctx);
    this.drawBanner(ctx);
    ctx.restore();
  }

  drawBg(ctx) {
    const sky = ctx.createLinearGradient(0, 0, 0, FLOOR);
    sky.addColorStop(0, '#0d0d1c');
    sky.addColorStop(0.6, '#241539');
    sky.addColorStop(1, '#4a2440');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, FLOOR);

    // moon
    ctx.fillStyle = 'rgba(255,220,170,0.9)';
    ctx.beginPath(); ctx.arc(W * 0.79, 110, 42, 0, 7); ctx.fill();
    const glow = ctx.createRadialGradient(W * 0.79, 110, 42, W * 0.79, 110, 130);
    glow.addColorStop(0, 'rgba(255,210,150,0.25)');
    glow.addColorStop(1, 'rgba(255,210,150,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(W * 0.79, 110, 130, 0, 7); ctx.fill();

    // distant skyline silhouettes
    ctx.fillStyle = '#141024';
    for (let i = 0; i < 9; i++) {
      const bw = 90 + ((i * 53) % 70);
      const bh = 70 + ((i * 97) % 130);
      ctx.fillRect(i * 150 - 20, FLOOR - bh, bw, bh);
    }
    // pagoda roof accent
    ctx.fillStyle = '#1c1430';
    ctx.beginPath();
    ctx.moveTo(W * 0.42, FLOOR - 190);
    ctx.lineTo(W * 0.56, FLOOR - 190);
    ctx.lineTo(W * 0.60, FLOOR - 160);
    ctx.lineTo(W * 0.38, FLOOR - 160);
    ctx.closePath(); ctx.fill();
    ctx.fillRect(W * 0.45, FLOOR - 160, W * 0.08, 160);

    // floor
    const fl = ctx.createLinearGradient(0, FLOOR, 0, H);
    fl.addColorStop(0, '#3a2a4a');
    fl.addColorStop(1, '#120c1c');
    ctx.fillStyle = fl;
    ctx.fillRect(0, FLOOR, W, H - FLOOR);
    ctx.strokeStyle = 'rgba(255,180,220,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, FLOOR); ctx.lineTo(W, FLOOR); ctx.stroke();
  }

  drawHud(ctx) {
    const barW = 430, barH = 26, y = 26;

    for (let i = 0; i < 2; i++) {
      const f = this.f[i];
      f.dispHp += (f.hp - f.dispHp) * 0.15;
      const pct = Math.max(0, f.dispHp / f.maxHp);
      const x = i === 0 ? 40 : W - 40 - barW;

      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.beginPath(); ctx.roundRect(x - 3, y - 3, barW + 6, barH + 6, 8); ctx.fill();

      const hpCol = pct > 0.5 ? '#4caf50' : pct > 0.25 ? '#ffb300' : '#e53935';
      ctx.fillStyle = hpCol;
      const fillW = barW * pct;
      ctx.beginPath();
      if (i === 0) ctx.roundRect(x + (barW - fillW), y, fillW, barH, 5);
      else ctx.roundRect(x, y, fillW, barH, 5);
      ctx.fill();

      ctx.fillStyle = '#fff';
      ctx.font = 'bold 15px Verdana, sans-serif';
      ctx.textAlign = i === 0 ? 'left' : 'right';
      ctx.fillText(f.name, i === 0 ? x + 10 : x + barW - 10, y + 18);

      // round win pips
      for (let wI = 0; wI < WINS_NEEDED; wI++) {
        const px = i === 0 ? x + 12 + wI * 22 : x + barW - 12 - wI * 22;
        ctx.beginPath(); ctx.arc(px, y + barH + 16, 7, 0, 7);
        ctx.fillStyle = wI < this.wins[i] ? f.ch.color : 'rgba(255,255,255,0.18)';
        ctx.fill();
      }

      // input status
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.font = '13px Verdana, sans-serif';
      ctx.fillText(this.statusFor(i), i === 0 ? x + 66 : x + barW - 66, y + barH + 21);
    }

    // timer
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.beginPath(); ctx.arc(W / 2, y + 16, 30, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = this.time < 10 ? '#ff6b6b' : '#fff';
    ctx.font = 'bold 24px Verdana, sans-serif';
    ctx.fillText(String(Math.max(0, Math.ceil(this.time))), W / 2, y + 25);

    // gesture cheat-sheet
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '13px Verdana, sans-serif';
    ctx.fillText('✋ move · raise = jump · ✊ punch · ✌️ kick · 🤟 block', W / 2, H - 14);
    ctx.textAlign = 'left';
  }

  drawBanner(ctx) {
    let main = null, sub = null, alpha = 1;

    if (this.phase === 'intro') {
      if (this.phaseT < 1.2) { main = `ROUND ${this.round}`; sub = `${this.f[0].name}  vs  ${this.f[1].name}`; }
      else main = 'FIGHT!';
    } else if (this.phase === 'fight' && this.phaseT < 0.5) {
      main = 'FIGHT!'; alpha = 1 - this.phaseT * 2;
    } else if ((this.phase === 'roundend' || this.phase === 'matchend') && this.banner) {
      main = this.banner.main; sub = this.banner.sub;
    }
    if (!main) return;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textAlign = 'center';
    ctx.font = 'bold 80px Impact, "Arial Black", sans-serif';
    ctx.lineWidth = 8; ctx.strokeStyle = '#1b1026';
    ctx.strokeText(main, W / 2, H / 2 - 10);
    const grad = ctx.createLinearGradient(0, H / 2 - 70, 0, H / 2 + 10);
    grad.addColorStop(0, '#ffe27a');
    grad.addColorStop(1, '#ff7a3c');
    ctx.fillStyle = grad;
    ctx.fillText(main, W / 2, H / 2 - 10);
    if (sub) {
      ctx.font = 'bold 26px Verdana, sans-serif';
      ctx.lineWidth = 5;
      ctx.strokeText(sub, W / 2, H / 2 + 40);
      ctx.fillStyle = '#fff';
      ctx.fillText(sub, W / 2, H / 2 + 40);
    }
    ctx.restore();
  }
}
