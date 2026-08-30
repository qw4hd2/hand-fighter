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

// Two-bone inverse kinematics: given a limb from a to b with segment lengths
// l1/l2, return the elbow/knee position. side (+1/-1) picks the bend side.
function ik(a, b, l1, l2, side) {
  const dx = b.x - a.x, dy = b.y - a.y;
  let dist = Math.hypot(dx, dy) || 0.001;
  const max = l1 + l2 - 0.5;
  if (dist > max) dist = max;
  const cos = clamp((dist * dist + l1 * l1 - l2 * l2) / (2 * dist * l1), -1, 1);
  const ang = Math.atan2(dy, dx) + Math.acos(cos) * side;
  return { x: a.x + Math.cos(ang) * l1, y: a.y + Math.sin(ang) * l1 };
}

function seg(ctx, a, b, w, color) {
  ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
}

function disc(ctx, p, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7); ctx.fill();
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
    this.dispHp = this.hp; this.ghostHp = this.hp;
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
        // (kind is passed so kicks freeze the frame slightly longer)
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
    const s = c.build || 1;
    const base = FLOOR - this.y;
    const flash = this.state === 'hit' && this.t < 0.1;
    const F = (col) => flash ? '#ffffff' : col;
    const skin = F(c.skin), skinD = F(shade(c.skin, 0.72));
    const pants = F(c.pants), pantsD = F(shade(c.pants, 0.62));
    const glove = F(c.glove), gloveD = F(shade(c.glove, 0.7));
    const hair = F(c.hair);
    const accent = F(c.accent);
    const torsoCol = c.top ? F(c.top) : skin;
    const torsoColD = c.top ? F(shade(c.top, 0.72)) : skinD;

    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    const sw = 48 * s * Math.max(0.4, 1 - this.y / 300);
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
    if (this.state === 'punch') lean = d * 10 * ext;
    if (this.state === 'kick') lean = -d * 14 * ext;
    if (this.state === 'block') crouch = 10;
    if (this.state === 'hit') lean = -d * 18;

    const idleBob = (this.state === 'idle') ? Math.sin(this.anim * 4) * 2.2 : 0;
    const hip = { x: this.x - d * 2 + lean * 0.35, y: base - 84 * s + crouch + idleBob };
    const chest = { x: this.x + lean + (this.state === 'punch' ? d * 7 * ext : 0), y: base - 130 * s + crouch * 1.4 + idleBob };
    const sho = { x: chest.x, y: chest.y + 2 };

    // default fighting stance
    let handF = { x: sho.x + d * 27 * s, y: sho.y + 15 + idleBob * 0.5 };
    let handB = { x: sho.x + d * 11 * s, y: sho.y + 23 };
    let footF = { x: this.x + d * 17 * s, y: base };
    let footB = { x: this.x - d * 19 * s, y: base };

    switch (this.state) {
      case 'walk': {
        const p2 = this.anim * 11;
        footF = { x: this.x + Math.sin(p2) * 17, y: base - Math.max(0, Math.sin(p2)) * 9 };
        footB = { x: this.x - Math.sin(p2) * 17, y: base - Math.max(0, -Math.sin(p2)) * 9 };
        break;
      }
      case 'jump':
        footF = { x: this.x + d * 8, y: base - 30 * s };
        footB = { x: this.x - d * 10, y: base - 38 * s };
        handF = { x: sho.x + d * 32 * s, y: sho.y + 2 };
        handB = { x: sho.x - d * 16 * s, y: sho.y + 8 };
        break;
      case 'punch':
        handF = { x: sho.x + d * (16 + 74 * ext), y: sho.y + 12 - 6 * ext };
        handB = { x: sho.x + d * 6 * s, y: sho.y + 20 };
        break;
      case 'kick':
        footF = { x: hip.x + d * (14 + 98 * ext), y: hip.y + 46 - 74 * ext };
        footB = { x: this.x - d * 7, y: base };
        handF = { x: sho.x - d * 2, y: sho.y + 18 };
        handB = { x: sho.x - d * 20 * s, y: sho.y + 4 };
        break;
      case 'block':
        handF = { x: sho.x + d * 22 * s, y: sho.y + 2 };
        handB = { x: sho.x + d * 16 * s, y: sho.y + 20 };
        break;
      case 'hit':
        handF = { x: sho.x - d * 4, y: sho.y - 8 };
        handB = { x: sho.x - d * 22, y: sho.y };
        break;
    }

    // joints via IK: knees bend toward facing, elbows drop down-back
    const thigh = 46 * s, shin = 44 * s, uarm = 30 * s, farm = 30 * s;
    const kneeF = ik(hip, footF, thigh, shin, -d);
    const kneeB = ik(hip, footB, thigh, shin, -d);
    const shoF = { x: sho.x + d * 6 * s, y: sho.y };
    const shoB = { x: sho.x - d * 6 * s, y: sho.y + 2 };
    const elbF = ik(shoF, handF, uarm, farm, d);
    const elbB = ik(shoB, handB, uarm, farm, d);

    // ===== back arm (skin, darker)
    seg(ctx, shoB, elbB, 11 * s, skinD);
    seg(ctx, elbB, handB, 9 * s, skinD);
    disc(ctx, handB, 7 * s, gloveD);

    // ===== back leg
    seg(ctx, hip, kneeB, 15 * s, pantsD);
    seg(ctx, kneeB, footB, 12 * s, pantsD);
    seg(ctx, { x: footB.x - d * 3, y: footB.y - 3 }, { x: footB.x + d * 8, y: footB.y - 2 }, 10 * s, F('#26202e'));

    // ===== torso (tapered: narrow waist, broad chest)
    const midT = { x: (hip.x + chest.x) / 2, y: (hip.y + chest.y) / 2 };
    seg(ctx, hip, midT, 22 * s, torsoColD);
    seg(ctx, midT, chest, 29 * s, torsoCol);
    if (!c.top && !flash) {
      // pec + ab hints on bare torsos
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = skinD; ctx.lineWidth = 2; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(chest.x + d * 7, chest.y + 10, 5 * s, 0.3, Math.PI - 0.5); ctx.stroke();
      ctx.beginPath(); ctx.arc(chest.x - d * 3, chest.y + 11, 4.5 * s, 0.3, Math.PI - 0.5); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(hip.x - 5 * s, midT.y + 4); ctx.lineTo(hip.x + 5 * s, midT.y + 4); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // belt
    seg(ctx, { x: hip.x - 14 * s, y: hip.y - 3 }, { x: hip.x + 14 * s, y: hip.y - 3 }, 7, accent);

    // ===== front leg (outlined against the back leg)
    seg(ctx, hip, kneeF, 15 * s + 3, F(shade(c.pants, 0.4)));
    seg(ctx, kneeF, footF, 12 * s + 3, F(shade(c.pants, 0.4)));
    seg(ctx, hip, kneeF, 15 * s, pants);
    seg(ctx, kneeF, footF, 12 * s, pants);
    disc(ctx, kneeF, 7 * s, pants);
    seg(ctx, { x: footF.x - d * 3, y: footF.y - 3 }, { x: footF.x + d * 9, y: footF.y - 2 }, 10 * s, F('#332a3d'));

    // ===== head
    const hx = chest.x + d * 4 + lean * 0.2, hy = chest.y - 26 * s;
    seg(ctx, chest, { x: hx, y: hy + 10 }, 9 * s, skin);            // neck
    disc(ctx, { x: hx, y: hy }, 15 * s, skin);
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = skinD; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(hx, hy + 3, 12 * s, 0.5, Math.PI - 0.5); ctx.stroke(); // jaw hint
    ctx.globalAlpha = 1;

    // hair
    ctx.fillStyle = hair;
    if (c.hairStyle === 'spiky') {
      ctx.beginPath();
      ctx.moveTo(hx - 14 * s, hy - 5);
      for (let i = 0; i < 5; i++) {
        const px = hx - 14 * s + (i + 0.5) * (28 * s / 5);
        ctx.lineTo(px, hy - (23 + (i % 2) * 8) * s);
        ctx.lineTo(hx - 14 * s + (i + 1) * (28 * s / 5), hy - 8 * s);
      }
      ctx.closePath(); ctx.fill();
    } else if (c.hairStyle === 'mohawk') {
      ctx.beginPath();
      ctx.moveTo(hx - 4 * s, hy - 10 * s);
      ctx.quadraticCurveTo(hx, hy - 30 * s, hx + 6 * s, hy - 10 * s);
      ctx.closePath(); ctx.fill();
    } else if (c.hairStyle === 'buzz') {
      ctx.beginPath(); ctx.arc(hx, hy - 2, 14.5 * s, Math.PI, Math.PI * 2); ctx.fill();
    } else if (!flash) {
      ctx.fillStyle = 'rgba(255,255,255,0.35)';                    // bald shine
      ctx.beginPath(); ctx.arc(hx - d * 4, hy - 8, 3.5, 0, 7); ctx.fill();
    }

    // headband + fluttering tail (ribbon trails behind and below the head)
    seg(ctx, { x: hx - 13 * s, y: hy - 4 }, { x: hx + 13 * s, y: hy - 4 }, 5, accent);
    const fl = Math.sin(this.anim * 7) * 4;
    ctx.strokeStyle = accent; ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(hx - d * 12 * s, hy - 2);
    ctx.quadraticCurveTo(hx - d * 24 * s, hy + 5 + fl, hx - d * 31 * s, hy + 15 - fl);
    ctx.stroke();

    // face: angry brow, eye, mouth
    ctx.strokeStyle = F('#221a24'); ctx.lineWidth = 2.6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(hx + d * 2.5, hy - 8); ctx.lineTo(hx + d * 11, hy - 5); ctx.stroke();
    disc(ctx, { x: hx + d * 7.5, y: hy - 1.5 }, 2.9, F('#f4f0ff'));
    disc(ctx, { x: hx + d * 8.4, y: hy - 1.5 }, 1.6, F('#221a24'));
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(hx + d * 4, hy + 7.5); ctx.lineTo(hx + d * 10, hy + 6.8); ctx.stroke();

    // ===== front arm + glove (outlined so it reads against the torso)
    const outl = F(shade(c.skin, 0.45));
    seg(ctx, shoF, elbF, 11 * s + 3, outl);
    seg(ctx, elbF, handF, 9 * s + 3, outl);
    seg(ctx, shoF, elbF, 11 * s, skin);
    seg(ctx, elbF, handF, 9 * s, skin);
    disc(ctx, shoF, 8 * s, torsoCol);                              // deltoid
    const punching = this.state === 'punch' && ext > 0.5;
    disc(ctx, handF, (punching ? 9.5 : 8) * s, glove);
    ctx.strokeStyle = gloveD; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(handF.x, handF.y, (punching ? 9.5 : 8) * s, 0, 7); ctx.stroke();

    // strike glow on active frames
    if (this.attacking && this.attackPhase().active) {
      const pt = this.state === 'punch' ? handF : footF;
      const g = ctx.createRadialGradient(pt.x, pt.y, 2, pt.x, pt.y, 30);
      g.addColorStop(0, 'rgba(255,240,180,0.9)');
      g.addColorStop(1, 'rgba(255,160,60,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, 30, 0, 7); ctx.fill();
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
    this.hitstop = 0;   // brief freeze-frame on landed hits
    this.combo = null;  // { side, count, t }

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

    if (this.hitstop > 0) { this.hitstop -= dt; return; }
    if (this.combo) this.combo.t += dt;

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
    const wIdx = att === this.f[0] ? 0 : 1;
    if (blocked) {
      this.combo = null;
    } else {
      this.hitstop = kind === 'kick' ? 0.08 : 0.055;
      this.combo = (this.combo && this.combo.side === wIdx && this.combo.t < 1.4)
        ? { side: wIdx, count: this.combo.count + 1, t: 0 }
        : { side: wIdx, count: 1, t: 0 };
    }
    if (def.hp <= 0) {
      this.hitstop = 0.2;
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
      cb: this.combo ? { s: this.combo.side, c: this.combo.count, t: this.combo.t } : null,
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
    this.combo = s.cb ? { side: s.cb.s, count: s.cb.c, t: s.cb.t } : null;
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

    // combo counter
    if (this.combo && this.combo.count >= 2 && this.combo.t < 1.2) {
      const cx = this.combo.side === 0 ? 200 : W - 200;
      const pop = 1 + Math.max(0, 0.3 - this.combo.t) * 1.4;
      ctx.save();
      ctx.translate(cx, 175);
      ctx.scale(pop, pop);
      ctx.rotate(this.combo.side === 0 ? -0.05 : 0.05);
      ctx.textAlign = 'center';
      ctx.font = 'bold 42px Impact, "Arial Black", sans-serif';
      ctx.lineWidth = 7; ctx.strokeStyle = '#1b1026';
      const txt = `${this.combo.count} HIT COMBO`;
      ctx.strokeText(txt, 0, 0);
      ctx.fillStyle = this.f[this.combo.side].ch.color;
      ctx.fillText(txt, 0, 0);
      ctx.restore();
      ctx.textAlign = 'left';
    }

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

      // Tekken-style trailing damage bar: pale segment that drains slowly
      if (f.ghostHp === undefined) f.ghostHp = f.maxHp;
      f.ghostHp += (f.hp - f.ghostHp) * 0.045;
      if (f.ghostHp < f.hp) f.ghostHp = f.hp;
      const gW = barW * Math.max(0, f.ghostHp / f.maxHp);
      if (gW > 4) {
        ctx.fillStyle = 'rgba(255,132,88,0.9)';
        ctx.beginPath();
        if (i === 0) ctx.roundRect(x + (barW - gW), y, gW, barH, 5);
        else ctx.roundRect(x, y, gW, barH, 5);
        ctx.fill();
      }

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
