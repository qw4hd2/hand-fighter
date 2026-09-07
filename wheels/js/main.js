// Doodle Wheels — draw your own wheels and beat physics-based tracks.
import { CG } from './cg.js';
import { sfx } from './sfx.js';

const { Engine, World, Bodies, Body, Composite, Constraint, Common, Vertices } = Matter;
if (window.decomp) Common.setDecomp(window.decomp);

const W = 1280, H = 720;
const cv = document.getElementById('game');
const ctx = cv.getContext('2d');
const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------ helpers
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// preset wheel shapes (points relative to the hub)
const PRESETS = {
  circle: () => Array.from({ length: 22 }, (_, i) => ({ x: Math.cos(i / 22 * Math.PI * 2) * 26, y: Math.sin(i / 22 * Math.PI * 2) * 26 })),
  square: () => [{ x: -26, y: -26 }, { x: 26, y: -26 }, { x: 26, y: 26 }, { x: -26, y: 26 }],
  star: () => Array.from({ length: 12 }, (_, i) => { const r = i % 2 ? 17 : 36, a = i / 12 * Math.PI * 2; return { x: Math.cos(a) * r, y: Math.sin(a) * r }; }),
  paddle: () => { const p = []; const n = 4, w = 9, L = 38; for (let k = 0; k < n; k++) { const a = k / n * Math.PI * 2, c = Math.cos(a), s = Math.sin(a); p.push({ x: c * 10 - s * w, y: s * 10 + c * w }, { x: c * L - s * w, y: s * L + c * w }, { x: c * L + s * w, y: s * L - c * w }, { x: c * 10 + s * w, y: s * 10 - c * w }); } return p; },
};

// ------------------------------------------------------------ level generation
function buildLevel(n) {
  const r = rng(1000 + n * 7919);
  const pool = ['hills', 'stairs', 'bumps', 'mud', 'spikes', 'water'];
  const avail = pool.slice(0, Math.min(pool.length, 2 + n));
  const feats = [{ type: 'flat', len: 520 }];
  const count = 3 + Math.min(n, 5);
  for (let i = 0; i < count; i++) {
    feats.push({ type: avail[Math.floor(r() * avail.length)], len: 420 + r() * 260 });
    feats.push({ type: 'flat', len: 220 });
  }
  const pts = [], zones = [], spikes = [];
  let x = 0, y = 520;
  const add = (px, py) => pts.push({ x: px, y: py });
  add(-400, y); add(x, y);
  for (const f of feats) {
    switch (f.type) {
      case 'flat': x += f.len; add(x, y); break;
      case 'hills': { const segs = Math.round(f.len / 40), amp = 40 + r() * 45; for (let i = 1; i <= segs; i++) { x += 40; add(x, y - Math.sin(i / segs * Math.PI * 2) * amp); } add(x, y); break; }
      case 'bumps': { const segs = Math.round(f.len / 34); for (let i = 1; i <= segs; i++) { x += 34; add(x, y - (i % 2) * 24); } add(x, y); break; }
      case 'stairs': { const steps = 3 + Math.floor(r() * 3), sh = 36 + r() * 8, sw = 72;
        for (let i = 0; i < steps; i++) { x += sw; add(x, y); y -= sh; add(x, y); }
        x += 140; add(x, y);
        for (let i = 0; i < steps; i++) { x += 48; add(x, y); y += sh; add(x, y); }
        x += 40; add(x, y); break; }
      case 'spikes': { const x0 = x; x += f.len; for (let sx = x0 + 50; sx < x - 50; sx += 40) spikes.push({ x: sx, y }); add(x, y); break; }
      case 'mud': { zones.push({ type: 'mud', x0: x, x1: x + f.len, y }); x += f.len; add(x, y); break; }
      case 'water': { const x0 = x; add(x, y); x += 30; y += 95; add(x, y);
        zones.push({ type: 'water', x0, x1: x0 + f.len, surface: y - 95 + 8 });
        x += f.len - 60; add(x, y); x += 30; y -= 95; add(x, y); break; }
    }
  }
  x += 260; add(x, y);
  const finishX = x - 120;
  x += 600; add(x, y);
  return { pts, zones, spikes, finishX, length: finishX };
}

// ------------------------------------------------------------ game state
const G = {
  engine: null, level: null, levelNo: 1,
  car: null, wheels: [], axles: [], shape: PRESETS.circle(),
  camX: 0, camY: 0, time: 0, state: 'menu', checkpoint: 0,
  lastProgress: 0, stuckT: 0, flipT: 0, drawing: false, lean: 0,
  best: +(localStorage.getItem('dw-level') || 1),
};

function buildWorld(levelNo) {
  G.engine = Engine.create({ gravity: { x: 0, y: 1 } });
  G.level = buildLevel(levelNo);
  const world = G.engine.world;
  const { pts, spikes, zones } = G.level;

  // ground as a chain of thick segments
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
    const seg = Bodies.rectangle((a.x + b.x) / 2, (a.y + b.y) / 2 + 9, len + 2, 22, {
      isStatic: true, angle: Math.atan2(dy, dx), friction: 1, label: 'ground',
    });
    World.add(world, seg);
  }
  // solid floor far below (catch-all)
  World.add(world, Bodies.rectangle(pts[pts.length - 1].x / 2, 1400, pts[pts.length - 1].x + 2000, 200, { isStatic: true, label: 'abyss' }));
  // spikes
  for (const s of spikes) {
    World.add(world, Bodies.fromVertices(s.x, s.y - 16, [[{ x: -16, y: 18 }, { x: 0, y: -16 }, { x: 16, y: 18 }]], { isStatic: true, friction: 0.2, label: 'spike' }));
  }
  G.zones = zones;
  spawnCar(pts[1].x + 120, pts[1].y - 70);
  G.time = 0; G.checkpoint = pts[1].x + 120; G.lastProgress = 0; G.stuckT = 0; G.flipT = 0;
}

function makeWheel(x, y, shape) {
  let b = null;
  try { b = Bodies.fromVertices(x, y, [shape], { friction: 1.2, frictionStatic: 1.5, density: 0.004, restitution: 0.02, label: 'wheel' }, true); } catch (e) { b = null; }
  if (!b) b = Bodies.circle(x, y, 26, { friction: 1.2, density: 0.004, label: 'wheel' });
  b.shape = shape;
  b.radius = Math.max(...shape.map(p => Math.hypot(p.x, p.y)));
  b.grip = wheelGrip(shape);
  return b;
}

// how "spiky" a shape is: perimeter relative to its enclosing circle (1 = round)
function wheelGrip(shape) {
  let per = 0, rmax = 0;
  for (let i = 0; i < shape.length; i++) {
    const a = shape[i], b = shape[(i + 1) % shape.length];
    per += Math.hypot(b.x - a.x, b.y - a.y); rmax = Math.max(rmax, Math.hypot(a.x, a.y));
  }
  return per / (2 * Math.PI * rmax);
}

function spawnCar(x, y) {
  const world = G.engine.world;
  if (G.car) { Composite.remove(world, [G.car, ...G.wheels, ...G.axles]); }
  G.car = Bodies.rectangle(x, y, 112, 26, { density: 0.0032, friction: 0.6, chamfer: { radius: 8 }, label: 'car' });
  G.wheels = [makeWheel(x - 38, y + 22, G.shape), makeWheel(x + 38, y + 22, G.shape)];
  G.axles = G.wheels.map((w, i) => Constraint.create({ bodyA: G.car, pointA: { x: i ? 38 : -38, y: 18 }, bodyB: w, pointB: { x: 0, y: 0 }, stiffness: 1, length: 0 }));
  World.add(world, [G.car, ...G.wheels, ...G.axles]);
}

function setShape(shape) {
  G.shape = shape;
  if (!G.car) return;
  const world = G.engine.world;
  G.wheels.forEach((w, i) => {
    const nw = makeWheel(w.position.x, w.position.y, shape);
    Body.setVelocity(nw, w.velocity);
    Body.setAngularVelocity(nw, w.angularVelocity);
    Composite.remove(world, [w, G.axles[i]]);
    G.axles[i] = Constraint.create({ bodyA: G.car, pointA: { x: i ? 38 : -38, y: 18 }, bodyB: nw, pointB: { x: 0, y: 0 }, stiffness: 1, length: 0 });
    G.wheels[i] = nw;
    World.add(world, [nw, G.axles[i]]);
  });
  drawPadShape();
  sfx.play('whoosh');
}

// ------------------------------------------------------------ simulation
function inZone(body, type) {
  return G.zones.find(z => z.type === type && body.position.x > z.x0 && body.position.x < z.x1);
}

function step(dt) {
  if (G.state !== 'play') return;
  const ts = G.drawing ? 0.15 : 1;
  const car = G.car;

  for (const w of G.wheels) {
    const target = 0.34;
    Body.setAngularVelocity(w, w.angularVelocity + (target - w.angularVelocity) * 0.10 * ts);
    const mud = inZone(w, 'mud');
    if (mud && w.position.y > mud.y - w.radius - 6) {
      const slip = clamp(1 - (w.grip - 1.05) * 2.2, 0.05, 1);   // round ≈1, star/paddle ≈0
      Body.setVelocity(w, { x: w.velocity.x * (1 - 0.22 * slip), y: w.velocity.y });
      Body.setAngularVelocity(w, w.angularVelocity * (1 - 0.5 * slip));
      Body.setVelocity(car, { x: car.velocity.x * (1 - 0.12 * slip), y: car.velocity.y });
    }
    const water = inZone(w, 'water');
    if (water) {
      const depth = clamp((w.position.y - water.surface) / 50, 0, 1.6);
      if (depth > 0) {
        const paddle = Math.max(0, w.grip - 1.18);               // round = 0, paddle/star > 0
        Body.applyForce(w, w.position, { x: w.angularVelocity * w.radius * paddle * 0.00012 * w.mass, y: -w.mass * 0.0016 * depth });
        Body.setVelocity(w, { x: w.velocity.x * 0.90, y: w.velocity.y * 0.96 });
      }
    }
  }
  const waterC = inZone(car, 'water');
  if (waterC) {
    const depth = clamp((car.position.y - waterC.surface) / 40, 0, 1.6);
    if (depth > 0) {
      Body.applyForce(car, car.position, { x: 0, y: -car.mass * 0.0014 * depth });
      Body.setVelocity(car, { x: car.velocity.x * 0.90, y: car.velocity.y });
    }
  }
  if (G.lean) Body.setAngularVelocity(car, car.angularVelocity + G.lean * 0.0035);

  Engine.update(G.engine, dt * 1000 * ts);
  G.time += dt * ts;

  G.camX += ((car.position.x - 420) - G.camX) * 0.12;
  G.camY += ((car.position.y - 430) - G.camY) * 0.08;

  const prog = car.position.x;
  if (prog - G.checkpoint > 700) G.checkpoint = prog;
  if (prog > G.lastProgress + 6) { G.lastProgress = prog; G.stuckT = 0; } else G.stuckT += dt;
  $('hint').classList.toggle('hidden', G.stuckT < 4);
  const ang = Math.abs(((car.angle + Math.PI) % (2 * Math.PI)) - Math.PI);
  G.flipT = ang > 2.4 ? G.flipT + dt : 0;
  if (G.flipT > 2.2) return fail('FLIPPED!', 'Lean with the left / right side of the screen…');
  if (car.position.y > 1200) return fail('FELL!', 'Wider or bigger wheels bridge the gaps.');
  for (const s of G.level.spikes) {
    if (Math.abs(car.position.x - s.x) < 22 && car.position.y > s.y - 44) return fail('SPIKED!', 'Big wide wheels roll over spikes.');
    for (const w of G.wheels) {
      if (w.radius < 33 && Math.abs(w.position.x - s.x) < 22 && w.position.y > s.y - w.radius - 38) {
        return fail('SPIKED!', 'Small wheels get punctured — draw a BIG wheel.');
      }
    }
  }
  if (prog >= G.level.finishX) return win();

  $('hud-fill').style.width = clamp(prog / G.level.finishX * 100, 0, 100) + '%';
  $('hud-time').textContent = G.time.toFixed(1) + 's';
}

function fail(title, text) {
  G.state = 'fail';
  sfx.play('ko');
  CG.gameplayStop();
  $('fail-title').textContent = title;
  $('fail-text').textContent = text;
  $('btn-skip').classList.toggle('hidden', !CG.rewardedAvailable);
  $('fail').classList.remove('hidden');
}

function win() {
  G.state = 'win';
  sfx.play('win');
  CG.gameplayStop();
  const par = G.level.length / 260;
  const stars = G.time < par ? 3 : G.time < par * 1.5 ? 2 : 1;
  $('stars').textContent = '★'.repeat(stars) + '☆'.repeat(3 - stars);
  $('win-time').textContent = `${G.time.toFixed(1)}s — level ${G.levelNo} complete`;
  G.best = Math.max(G.best, G.levelNo + 1);
  localStorage.setItem('dw-level', G.best);
  $('win').classList.remove('hidden');
}

function startLevel(n) {
  G.levelNo = n;
  $('hud-level').textContent = 'LEVEL ' + n;
  ['menu', 'win', 'fail'].forEach(id => $(id).classList.add('hidden'));
  buildWorld(n);
  G.camX = G.car.position.x - 420; G.camY = G.car.position.y - 430;
  G.state = 'play';
  sfx.unlock(); sfx.play('bell');
  CG.gameplayStart();
}

function respawn() {
  const gy = groundY(G.checkpoint);
  spawnCar(G.checkpoint, gy - 70);
  G.lastProgress = G.checkpoint; G.stuckT = 0; G.flipT = 0;
  $('fail').classList.add('hidden');
  G.state = 'play';
  CG.gameplayStart();
}

function groundY(x) {
  const p = G.level.pts;
  for (let i = 0; i < p.length - 1; i++) if (x >= p[i].x && x <= p[i + 1].x) {
    const t = (x - p[i].x) / (p[i + 1].x - p[i].x || 1); return p[i].y + (p[i + 1].y - p[i].y) * t;
  }
  return 520;
}

// ------------------------------------------------------------ rendering
function draw() {
  const cx = G.camX, cy = G.camY;
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#6fc3ff'); sky.addColorStop(1, '#dff3ff');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(120,190,120,0.45)';
  for (let i = -1; i < 6; i++) { const hx = ((i * 420 - cx * 0.3) % 2520 + 2520) % 2520 - 420; ctx.beginPath(); ctx.ellipse(hx, 560 - cy * 0.3, 300, 140, 0, 0, 7); ctx.fill(); }
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  for (let i = 0; i < 5; i++) { const kx = ((i * 520 - cx * 0.15) % 2600 + 2600) % 2600 - 300, ky = 90 + (i % 3) * 60 - cy * 0.1; ctx.beginPath(); ctx.ellipse(kx, ky, 70, 26, 0, 0, 7); ctx.ellipse(kx + 50, ky - 14, 50, 26, 0, 0, 7); ctx.fill(); }

  ctx.save();
  ctx.translate(-cx, -cy);
  if (!G.level) { ctx.restore(); return; }
  const { pts, zones, spikes, finishX } = G.level;

  for (const z of zones) if (z.type === 'water') {
    ctx.fillStyle = 'rgba(60,150,255,0.55)';
    ctx.fillRect(z.x0, z.surface, z.x1 - z.x0, 140);
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 3;
    ctx.beginPath();
    for (let x = z.x0; x <= z.x1; x += 10) ctx.lineTo(x, z.surface + Math.sin(x / 22 + G.time * 4) * 3);
    ctx.stroke();
  }
  ctx.beginPath(); ctx.moveTo(pts[0].x, 1500);
  for (const p of pts) ctx.lineTo(p.x, p.y);
  ctx.lineTo(pts[pts.length - 1].x, 1500); ctx.closePath();
  ctx.fillStyle = '#8a5a34'; ctx.fill();
  ctx.lineWidth = 14; ctx.strokeStyle = '#5cb85c'; ctx.lineJoin = 'round';
  ctx.beginPath(); for (const p of pts) ctx.lineTo(p.x, p.y); ctx.stroke();
  for (const z of zones) if (z.type === 'mud') { ctx.fillStyle = '#6b3f1d'; ctx.fillRect(z.x0, z.y - 12, z.x1 - z.x0, 26); ctx.fillStyle = 'rgba(255,255,255,0.12)'; for (let x = z.x0 + 20; x < z.x1; x += 60) { ctx.beginPath(); ctx.ellipse(x, z.y - 4, 14, 5, 0, 0, 7); ctx.fill(); } }
  ctx.fillStyle = '#c94141';
  for (const s of spikes) { ctx.beginPath(); ctx.moveTo(s.x - 16, s.y + 4); ctx.lineTo(s.x, s.y - 32); ctx.lineTo(s.x + 16, s.y + 4); ctx.closePath(); ctx.fill(); }
  const fy = groundY(finishX);
  ctx.fillStyle = '#333'; ctx.fillRect(finishX - 3, fy - 110, 6, 110);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) { ctx.fillStyle = (i + j) % 2 ? '#111' : '#fff'; ctx.fillRect(finishX + 3 + i * 14, fy - 108 + j * 14, 14, 14); }

  if (G.car) {
    for (const w of G.wheels) drawWheel(w);
    const c = G.car;
    ctx.save(); ctx.translate(c.position.x, c.position.y); ctx.rotate(c.angle);
    ctx.fillStyle = '#ff5a3c'; roundRect(-56, -13, 112, 26, 9); ctx.fill();
    ctx.fillStyle = '#ffb347'; roundRect(-30, -34, 56, 24, 8); ctx.fill();
    ctx.fillStyle = '#bfe9ff'; roundRect(-4, -30, 26, 16, 4); ctx.fill();
    ctx.fillStyle = '#f2c9a0'; ctx.beginPath(); ctx.arc(-16, -38, 10, 0, 7); ctx.fill();
    ctx.fillStyle = '#2b2d42'; ctx.beginPath(); ctx.arc(-16, -42, 10, Math.PI, 0); ctx.fill();
    ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(-12, -38, 1.8, 0, 7); ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }

function drawWheel(w) {
  ctx.save(); ctx.translate(w.position.x, w.position.y); ctx.rotate(w.angle);
  ctx.beginPath(); w.shape.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath();
  ctx.fillStyle = '#2b2b33'; ctx.fill();
  ctx.lineWidth = 4; ctx.strokeStyle = '#111'; ctx.stroke();
  ctx.fillStyle = '#ffd166'; ctx.beginPath(); ctx.arc(0, 0, 6, 0, 7); ctx.fill();
  ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(w.radius * 0.7, 0); ctx.stroke();
  ctx.restore();
}

// ------------------------------------------------------------ drawing pad
const pad = $('padcv'), pctx = pad.getContext('2d');
let stroke = [];
function padPos(e) { const r = pad.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * 220, y: (e.clientY - r.top) / r.height * 220 }; }
function drawPadShape() {
  pctx.clearRect(0, 0, 220, 220);
  pctx.strokeStyle = '#ddd'; pctx.lineWidth = 1; pctx.beginPath(); pctx.arc(110, 110, 80, 0, 7); pctx.stroke();
  const sh = stroke.length > 1 ? stroke : G.shape.map(p => ({ x: 110 + p.x * 2, y: 110 + p.y * 2 }));
  pctx.strokeStyle = '#222'; pctx.lineWidth = 8; pctx.lineJoin = 'round'; pctx.lineCap = 'round';
  pctx.beginPath(); sh.forEach((p, i) => i ? pctx.lineTo(p.x, p.y) : pctx.moveTo(p.x, p.y));
  if (stroke.length < 2) pctx.closePath();
  pctx.stroke();
}
pad.addEventListener('pointerdown', (e) => { e.preventDefault(); G.drawing = true; stroke = [padPos(e)]; pad.setPointerCapture(e.pointerId); });
pad.addEventListener('pointermove', (e) => { if (!G.drawing) return; const p = padPos(e); const l = stroke[stroke.length - 1]; if (Math.hypot(p.x - l.x, p.y - l.y) > 5) { stroke.push(p); drawPadShape(); } });
const finishStroke = () => {
  if (!G.drawing) return;
  G.drawing = false;
  if (stroke.length >= 6) {
    const c = stroke.reduce((a, p) => ({ x: a.x + p.x / stroke.length, y: a.y + p.y / stroke.length }), { x: 0, y: 0 });
    let pts = stroke.map(p => ({ x: p.x - c.x, y: p.y - c.y }));
    const rmax = Math.max(...pts.map(p => Math.hypot(p.x, p.y)));
    const scale = clamp(40 / rmax, 40 / 90, 40 / 18);
    pts = pts.map(p => ({ x: p.x * scale * 0.9, y: p.y * scale * 0.9 }));
    const keep = Math.max(1, Math.floor(pts.length / 20));
    pts = pts.filter((_, i) => i % keep === 0).slice(0, 24);
    if (Math.abs(Vertices.area(pts, true)) > 250) setShape(pts);
  }
  stroke = []; drawPadShape();
};
pad.addEventListener('pointerup', finishStroke);
pad.addEventListener('pointercancel', finishStroke);
document.querySelectorAll('#presets button').forEach(b => b.addEventListener('click', () => { stroke = []; setShape(PRESETS[b.dataset.p]()); }));

cv.addEventListener('pointerdown', (e) => { G.lean = e.clientX < window.innerWidth / 2 ? -1 : 1; });
const stopLean = () => { G.lean = 0; };
cv.addEventListener('pointerup', stopLean); cv.addEventListener('pointercancel', stopLean); cv.addEventListener('pointerleave', stopLean);
window.addEventListener('keydown', (e) => { if (e.code === 'ArrowLeft' || e.code === 'KeyA') G.lean = -1; if (e.code === 'ArrowRight' || e.code === 'KeyD') G.lean = 1; if (e.code === 'Digit1') setShape(PRESETS.circle()); if (e.code === 'Digit2') setShape(PRESETS.square()); if (e.code === 'Digit3') setShape(PRESETS.star()); if (e.code === 'Digit4') setShape(PRESETS.paddle()); });
window.addEventListener('keyup', () => { G.lean = 0; });

// ------------------------------------------------------------ UI wiring
$('btn-play').addEventListener('click', () => startLevel(G.best));
$('btn-next').addEventListener('click', () => CG.midgameAd(sfx, () => startLevel(G.levelNo + 1)));
$('btn-retry').addEventListener('click', () => CG.midgameAd(sfx, respawn));
$('btn-skip').addEventListener('click', () => CG.rewardedAd(sfx, () => startLevel(G.levelNo + 1), () => {}));
const muted = () => localStorage.getItem('dw-mute') === '1';
const renderMute = () => { $('btn-mute').textContent = muted() ? '🔇' : '🔊'; sfx.setMuted(muted()); };
$('btn-mute').addEventListener('click', () => { localStorage.setItem('dw-mute', muted() ? '0' : '1'); renderMute(); });
renderMute();
drawPadShape();
CG.init();

// ------------------------------------------------------------ main loop
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.033, (now - last) / 1000); last = now;
  step(dt);
  draw();
}
requestAnimationFrame(frame);

window.__dw = { G, step, startLevel, setShape, PRESETS, respawn };
