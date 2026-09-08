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
  square: () => [{ x: -30, y: -30 }, { x: 30, y: -30 }, { x: 30, y: 30 }, { x: -30, y: 30 }],
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
      case 'stairs': { const steps = 3 + Math.floor(r() * 3), sh = 31 + r() * 7, sw = 72;
        for (let i = 0; i < steps; i++) { x += sw; add(x, y); y -= sh; add(x, y); }
        x += 140; add(x, y);
        for (let i = 0; i < steps; i++) { x += 48; add(x, y); y += sh; add(x, y); }
        x += 40; add(x, y); break; }
      case 'spikes': { const x0 = x; x += f.len; for (let sx = x0 + 50; sx < x - 50; sx += 40) spikes.push({ x: sx, y }); add(x, y); break; }
      case 'mud': { zones.push({ type: 'mud', x0: x, x1: x + f.len, y }); x += f.len; add(x, y); break; }
      case 'water': { const x0 = x; add(x, y); x += 50; y += 95; add(x, y);
        zones.push({ type: 'water', x0, x1: x0 + f.len, surface: y - 95 + 8 });
        x += f.len - 190; add(x, y); x += 70; y -= 55; add(x, y); x += 70; y -= 40; add(x, y); break; }
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
  parts: [], bounce: 0, shake: 0, prevVy: 0,
  best: +(localStorage.getItem('dw-level') || 1),
};

function buildWorld(levelNo) {
  G.engine = Engine.create({ gravity: { x: 0, y: 1 }, positionIterations: 10, velocityIterations: 8, constraintIterations: 4 });
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
    World.add(world, Bodies.circle(b.x, b.y + 9, 11, { isStatic: true, friction: 1, label: 'ground' }));
  }
  // solid floor far below (catch-all)
  World.add(world, Bodies.rectangle(pts[pts.length - 1].x / 2, 1400, pts[pts.length - 1].x + 2000, 200, { isStatic: true, label: 'abyss' }));
  // spikes
  for (const s of spikes) {
    World.add(world, Bodies.fromVertices(s.x, s.y - 16, [[{ x: -16, y: 18 }, { x: 0, y: -16 }, { x: 16, y: 18 }]], { isStatic: true, friction: 0.2, label: 'spike' }));
  }
  G.zones = zones;
  spawnCar(pts[1].x + 120, pts[1].y - 34);
  G.time = 0; G.checkpoint = pts[1].x + 120; G.lastProgress = 0; G.stuckT = 0; G.flipT = 0;
}

function makeWheel(x, y, shape) {
  let b = null;
  try { b = Bodies.fromVertices(x, y, [shape], { friction: 1.2, frictionStatic: 1.5, density: 0.004, restitution: 0.02, label: 'wheel', collisionFilter: { group: G.carGroup } }, true); } catch (e) { b = null; }
  if (!b) b = Bodies.circle(x, y, 26, { friction: 1.2, density: 0.004, label: 'wheel', collisionFilter: { group: G.carGroup } });
  b.shape = shape;
  b.radius = Math.max(...shape.map(p => Math.hypot(p.x, p.y)));
  b.grip = wheelGrip(shape);
  return b;
}

function wheelRadius(shape) { return Math.max(...shape.map(p => Math.hypot(p.x, p.y))); }

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
  G.carGroup = G.carGroup || Body.nextGroup(true);   // car + wheels never collide with each other
  G.car = Bodies.rectangle(x, y, 112, 26, { density: 0.0032, friction: 0.6, chamfer: { radius: 8 }, label: 'car', collisionFilter: { group: G.carGroup } });
  G.spawnT = 0; G.parts = []; G.bounce = 0; G.shake = 0;
  G.wheels = [makeWheel(x - 50, y + 8, G.shape), makeWheel(x + 50, y + 8, G.shape)];
  G.axles = G.wheels.map((w, i) => Constraint.create({ bodyA: G.car, pointA: { x: i ? 50 : -50, y: 6 }, bodyB: w, pointB: { x: 0, y: 0 }, stiffness: 1, length: 0 }));
  World.add(world, [G.car, ...G.wheels, ...G.axles]);
}

function setShape(shape) {
  G.shape = shape;
  if (!G.car) return;
  const world = G.engine.world;
  // keep the wheel bottoms where they were: lift/lower the whole car by the radius change
  const lift = wheelRadius(shape) - G.wheels[0].radius;
  if (lift !== 0) Body.translate(G.car, { x: 0, y: -lift });
  G.wheels.forEach((w, i) => {
    const nw = makeWheel(w.position.x, w.position.y - lift, shape);
    Body.setVelocity(nw, w.velocity);
    Body.setAngularVelocity(nw, w.angularVelocity);
    Composite.remove(world, [w, G.axles[i]]);
    G.axles[i] = Constraint.create({ bodyA: G.car, pointA: { x: i ? 50 : -50, y: 6 }, bodyB: nw, pointB: { x: 0, y: 0 }, stiffness: 1, length: 0 });
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
  const ts = G.drawing ? 0.3 : 1;                            // slow-motion while drawing (not a freeze)
  const car = G.car;
  G.spawnT = (G.spawnT || 0) + dt * ts;
  const pitchNow = Math.atan2(Math.sin(car.angle), Math.cos(car.angle));
  let throttle = clamp(G.spawnT / 0.8, 0.2, 1);               // soft start after (re)spawn
  const afloat = G.wheels.some(w => inZone(w, 'water'));
  if (!afloat && pitchNow < -0.35) throttle *= clamp(1 + (pitchNow + 0.35) * 2.2, 0.15, 1);   // anti-wheelie (nose up = negative)

  for (const w of G.wheels) {
    const target = 0.30 * throttle * clamp(26 / w.radius, 0.7, 1);    // clockwise spin = rolls forward
    const dv = clamp(target - w.angularVelocity, -0.02, 0.02) * ts;   // torque-limited motor (no instant rim speed)
    Body.setAngularVelocity(w, w.angularVelocity + dv);
    const mud = inZone(w, 'mud');
    if (mud && w.position.y > mud.y - w.radius - 6) {
      const slip = clamp(1 - clamp((w.grip - 1.05) * 4, 0, 1) * 1.3, 0.05, 1);   // round/square ≈1 (stall), star/paddle/spiky drawings ≈0.1
      Body.setVelocity(w, { x: w.velocity.x * (1 - 0.22 * slip), y: w.velocity.y });
      Body.setAngularVelocity(w, w.angularVelocity * (1 - 0.5 * slip));
      Body.setVelocity(car, { x: car.velocity.x * (1 - 0.12 * slip), y: car.velocity.y });
    }
    const water = inZone(w, 'water');
    if (water) {
      const depth = clamp((w.position.y - water.surface) / 50, 0, 1.6);
      if (depth > 0) {
        const paddle = clamp((w.grip - 1.05) * 4, 0, 1);          // round/square = 0, paddle ≈ 0.7, star = 1
        Body.applyForce(w, w.position, { x: w.angularVelocity * w.radius * paddle * 0.00045 * w.mass, y: -w.mass * 0.0016 * depth });
        Body.applyForce(car, car.position, { x: w.angularVelocity * w.radius * paddle * 0.00035 * car.mass, y: 0 });   // paddles push the whole boat
        Body.setVelocity(w, { x: w.velocity.x * 0.94, y: w.velocity.y * 0.96 });
      }
    }
  }
  const waterC = inZone(car, 'water');
  if (waterC) {
    const depth = clamp((car.position.y - waterC.surface) / 40, 0, 1.6);
    if (depth > 0) {
      Body.applyForce(car, car.position, { x: 0, y: -car.mass * 0.0014 * depth });
      Body.setVelocity(car, { x: car.velocity.x * 0.95, y: car.velocity.y });
    }
  }
  const wrapped = Math.atan2(Math.sin(car.angle), Math.cos(car.angle));
  let torque = G.lean * 0.9 * car.mass;                                             // player lean
  if (!G.lean && Math.abs(wrapped) > 1.6 && Math.abs(wrapped) < 2.9) torque -= Math.sign(wrapped) * 0.3 * car.mass;  // rescue when upside-down
  car.torque += torque * ts;

  Engine.update(G.engine, dt * 1000 * ts);
  G.time += dt * ts;

  // arcade safety caps (Matter can inject energy through rigid pins on bumpy ground)
  const capV = (b, maxX, maxY) => {
    const v = b.velocity;
    const nx = clamp(v.x, -maxX, maxX), ny = clamp(v.y, -maxY, maxY);
    if (nx !== v.x || ny !== v.y) Body.setVelocity(b, { x: nx, y: ny });
  };
  capV(car, 9, 12); for (const w of G.wheels) capV(w, 10, 13);
  if (Math.abs(car.angularVelocity) > 0.12) Body.setAngularVelocity(car, Math.sign(car.angularVelocity) * 0.12);
  // gentle self-righting when airborne / tilting (keeps the arcade feel, no flips from bumps)
  const grounded = G.wheels.some(w => w.velocity.y > -0.5 && w.velocity.y < 0.5);
  if (!G.lean && !grounded && Math.abs(wrapped) < 1.6) Body.setAngularVelocity(car, car.angularVelocity - wrapped * 0.03);

  // ---- feel: particles (dust / mud / splash), visual suspension, landing shake, engine hum
  const spd = Math.abs(car.velocity.x);
  for (const w of G.wheels) {
    const gy = groundY(w.position.x);
    const touching = w.position.y + w.radius > gy - 6;
    const wz = inZone(w, 'water');
    if (wz && w.position.y + w.radius > wz.surface) {
      if (Math.random() < 0.35 + spd * 0.08) G.parts.push({ x: w.position.x + (Math.random() - 0.5) * w.radius * 1.6, y: wz.surface, vx: (Math.random() - 0.7) * 3 + car.velocity.x * 0.3, vy: -2 - Math.random() * 4, r: 2 + Math.random() * 3, c: '#cfeaff', a: 0.9, life: 0.5, life0: 0.5, g: 0.25 });
    } else if (touching && spd > 1.5 && Math.random() < spd / 9) {
      if (inZone(w, 'mud')) G.parts.push({ x: w.position.x - 8, y: gy - 4, vx: -1 - Math.random() * 3, vy: -2 - Math.random() * 3, r: 2 + Math.random() * 3, c: '#4a2a12', a: 0.95, life: 0.6, life0: 0.6, g: 0.2 });
      else G.parts.push({ x: w.position.x - w.radius * 0.6, y: gy - 3, vx: -0.5 - Math.random() * 1.5, vy: -0.6 - Math.random() * 1.2, r: 4 + Math.random() * 6, c: '#cdb08a', a: 0.45, life: 0.7, life0: 0.7, g: -0.01 });
    }
  }
  for (let i = G.parts.length - 1; i >= 0; i--) { const p = G.parts[i]; p.life -= dt * ts; p.x += p.vx * ts; p.y += p.vy * ts; p.vy += p.g * ts; if (p.life <= 0) G.parts.splice(i, 1); }
  if (G.parts.length > 220) G.parts.splice(0, G.parts.length - 220);
  const vyNow = car.velocity.y;
  G.bounce = G.bounce * 0.85 + clamp(vyNow * 0.9, -5, 5) * 0.15;          // body sways on its "suspension"
  if (G.prevVy > 4 && vyNow < 1) G.shake = 8;                               // hard landing
  G.prevVy = vyNow; G.shake = Math.max(0, G.shake - 30 * dt);
  sfx.engine(0.15 + clamp(Math.abs(G.wheels[0].angularVelocity) / 0.3, 0, 1) * (0.35 + 0.5 * clamp(spd / 6, 0, 1)));

  G.camX += ((car.position.x - 420) - G.camX) * 0.12;
  G.camY += ((car.position.y - 430) - G.camY) * 0.08;

  const prog = car.position.x;
  if (prog - G.checkpoint > 700) G.checkpoint = prog;
  if (prog > G.lastProgress + 6) { G.lastProgress = prog; G.stuckT = 0; } else G.stuckT += dt;
  $('hint').classList.toggle('hidden', G.stuckT < 4);
  const ang = Math.abs(Math.atan2(Math.sin(car.angle), Math.cos(car.angle)));
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
function hash(n) { const v = Math.sin(n * 127.1) * 43758.5453; return v - Math.floor(v); }

function draw() {
  const cx = G.camX + (G.shake ? (Math.random() - 0.5) * G.shake : 0), cy = G.camY + (G.shake ? (Math.random() - 0.5) * G.shake : 0);
  // sky + sun
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#3f8fd8'); sky.addColorStop(0.55, '#8ec5ef'); sky.addColorStop(1, '#e8f4fb');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
  const sx = 1040 - cx * 0.02, sy = 120 - cy * 0.05;
  const glow = ctx.createRadialGradient(sx, sy, 10, sx, sy, 260);
  glow.addColorStop(0, 'rgba(255,245,200,0.9)'); glow.addColorStop(0.15, 'rgba(255,235,170,0.45)'); glow.addColorStop(1, 'rgba(255,235,170,0)');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#fff6d2'; ctx.beginPath(); ctx.arc(sx, sy, 38, 0, 7); ctx.fill();
  // distant mountains, hills, tree line, clouds (parallax layers)
  drawMountains(cx * 0.12, 480 - cy * 0.12, 1800, 260, '#8aa8c4', '#f2f7fb', 7, 10);
  drawMountains(cx * 0.2, 530 - cy * 0.2, 1300, 180, '#5f8cab', '#e3eef5', 3, 9);
  ctx.fillStyle = '#7fb56a';
  for (let i = -1; i < 7; i++) { const hx = ((i * 460 - cx * 0.32) % 2760 + 2760) % 2760 - 460; ctx.beginPath(); ctx.ellipse(hx, 600 - cy * 0.32, 330, 150, 0, 0, 7); ctx.fill(); }
  ctx.fillStyle = '#5f9a4e';
  for (let i = -1; i < 7; i++) { const hx = ((i * 380 + 150 - cx * 0.45) % 2280 + 2280) % 2280 - 380; ctx.beginPath(); ctx.ellipse(hx, 640 - cy * 0.45, 260, 120, 0, 0, 7); ctx.fill(); }
  for (let i = -1; i < 16; i++) { const tx = ((i * 190 + 40 - cx * 0.55) % 3040 + 3040) % 3040 - 190; drawTree(tx, 600 - cy * 0.55, 80 + hash(i) * 70); }
  for (let i = 0; i < 6; i++) { const kx = ((i * 470 - cx * 0.1) % 2820 + 2820) % 2820 - 300, ky = 80 + (i % 3) * 55 - cy * 0.08; drawCloud(kx, ky, 1 + (i % 2) * 0.35); }

  ctx.save(); ctx.translate(-cx, -cy);
  if (!G.level) { ctx.restore(); return; }
  const { pts, zones, spikes, finishX } = G.level;
  const x0 = Math.floor((cx - 100) / 60) * 60, x1 = cx + W + 100;

  // ground: layered dirt with stones and strata
  ctx.beginPath(); ctx.moveTo(pts[0].x, 1600);
  for (const p of pts) ctx.lineTo(p.x, p.y);
  ctx.lineTo(pts[pts.length - 1].x, 1600); ctx.closePath();
  const gg = ctx.createLinearGradient(0, 380, 0, 1000);
  gg.addColorStop(0, '#9a6a3f'); gg.addColorStop(0.35, '#7d5230'); gg.addColorStop(1, '#4a2f1b');
  ctx.fillStyle = gg; ctx.fill();
  ctx.save(); ctx.clip();
  ctx.fillStyle = 'rgba(0,0,0,0.13)';
  for (let x = x0; x < x1; x += 60) { const gy = groundY(x); for (let k = 0; k < 4; k++) { const h1 = hash(x * 0.37 + k * 11.3), h2 = hash(x * 0.11 + k * 3.7); ctx.beginPath(); ctx.ellipse(x + h1 * 60, gy + 40 + h2 * 260, 5 + h1 * 9, 3 + h2 * 5, h1 * 3, 0, 7); ctx.fill(); } }
  ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 6;
  for (let k = 1; k < 5; k++) { ctx.beginPath(); for (let x = x0 - 200; x < x1 + 200; x += 80) ctx.lineTo(x, (groundY(x - 160) + groundY(x) + groundY(x + 160)) / 3 + 60 * k + Math.sin(x / 140 + k) * 12); ctx.stroke(); }
  ctx.restore();
  // grass: shadow edge, turf, highlight, tufts
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.lineWidth = 20; ctx.strokeStyle = '#3f7a34'; ctx.beginPath(); for (const p of pts) ctx.lineTo(p.x, p.y + 3); ctx.stroke();
  ctx.lineWidth = 13; ctx.strokeStyle = '#66b04f'; ctx.beginPath(); for (const p of pts) ctx.lineTo(p.x, p.y - 1); ctx.stroke();
  ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(210,255,170,0.55)'; ctx.beginPath(); for (const p of pts) ctx.lineTo(p.x, p.y - 6); ctx.stroke();
  ctx.lineWidth = 2.5; ctx.strokeStyle = '#4f9440'; ctx.beginPath();
  for (let x = x0; x < x1; x += 22) { const h = hash(x * 0.71), gy = groundY(x) - 6; ctx.moveTo(x, gy); ctx.lineTo(x - 3 + h * 6, gy - 8 - h * 9); ctx.moveTo(x + 5, gy); ctx.lineTo(x + 8 - h * 4, gy - 6 - h * 7); }
  ctx.stroke();

  for (const z of zones) if (z.type === 'mud') {
    const mg = ctx.createLinearGradient(0, z.y - 14, 0, z.y + 16); mg.addColorStop(0, '#5a3418'); mg.addColorStop(1, '#3a2010');
    ctx.fillStyle = mg; roundRect(z.x0 - 6, z.y - 14, z.x1 - z.x0 + 12, 30, 10); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    for (let x = z.x0 + 24; x < z.x1 - 10; x += 58) { ctx.beginPath(); ctx.ellipse(x, z.y - 6, 16, 4, 0, 0, 7); ctx.fill(); }
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    for (let x = z.x0 + 40; x < z.x1 - 10; x += 74) { ctx.beginPath(); ctx.ellipse(x, z.y + 2, 9, 3, 0, 0, 7); ctx.fill(); }
  }
  for (const s of spikes) {
    const sg = ctx.createLinearGradient(s.x - 16, 0, s.x + 16, 0); sg.addColorStop(0, '#6d7480'); sg.addColorStop(0.45, '#e9edf2'); sg.addColorStop(0.55, '#c3c9d1'); sg.addColorStop(1, '#4e545e');
    ctx.fillStyle = sg; ctx.beginPath(); ctx.moveTo(s.x - 16, s.y + 6); ctx.lineTo(s.x, s.y - 32); ctx.lineTo(s.x + 16, s.y + 6); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#2f333a'; ctx.fillRect(s.x - 20, s.y + 2, 40, 7);
  }
  for (const z of zones) if (z.type === 'water') {
    const wg = ctx.createLinearGradient(0, z.surface, 0, z.surface + 120);
    wg.addColorStop(0, 'rgba(90,180,255,0.55)'); wg.addColorStop(1, 'rgba(20,70,150,0.85)');
    ctx.fillStyle = wg; ctx.fillRect(z.x0, z.surface, z.x1 - z.x0, 140);
    ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 3; ctx.beginPath();
    for (let x = z.x0; x <= z.x1; x += 8) ctx.lineTo(x, z.surface + Math.sin(x / 26 + G.time * 3.5) * 3);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 2;
    for (let k = 1; k < 4; k++) { ctx.beginPath(); for (let x = z.x0 + 10; x <= z.x1 - 10; x += 12) ctx.lineTo(x, z.surface + 18 * k + Math.sin(x / 40 + G.time * 2 + k) * 4); ctx.stroke(); }
  }
  const fy = groundY(finishX);
  ctx.fillStyle = '#444'; ctx.fillRect(finishX - 3, fy - 112, 6, 112);
  ctx.fillStyle = '#ddd'; ctx.beginPath(); ctx.arc(finishX, fy - 114, 5, 0, 7); ctx.fill();
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) { ctx.fillStyle = (i + j) % 2 ? '#151515' : '#f4f4f4'; ctx.fillRect(finishX + 3 + i * 14, fy - 108 + j * 14 + Math.sin(G.time * 5 + i) * 2, 14, 14); }

  for (const p of G.parts) { ctx.globalAlpha = Math.max(0, p.life / p.life0) * p.a; ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (0.6 + 0.6 * (1 - p.life / p.life0)), 0, 7); ctx.fill(); }
  ctx.globalAlpha = 1;

  if (G.car) {
    for (const w of G.wheels) { const gy = groundY(w.position.x); const h = clamp((gy - w.position.y - w.radius) / 120, 0, 1); ctx.fillStyle = `rgba(0,0,0,${(0.28 * (1 - h)).toFixed(3)})`; ctx.beginPath(); ctx.ellipse(w.position.x, gy - 2, w.radius * (1 + h * 0.4), 6 + h * 3, 0, 0, 7); ctx.fill(); }
    for (const w of G.wheels) drawWheel(w);
    drawCar(G.car);
  }
  ctx.restore();
}

function drawMountains(off, baseY, period, h, col, snow, seed, n) {
  const stepX = period / n;
  const start = -(((off % period) + period) % period) - period;
  const peaks = [];
  ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(-60, H + 10);
  for (let x = start; x < W + period; x += stepX) {
    const i = Math.round((x + off) / stepX), r = hash(i * 1.7 + seed);
    const y = baseY - h * (0.15 + 0.85 * r);
    ctx.lineTo(x, y);
    if (r > 0.5 && r > hash((i - 1) * 1.7 + seed) && r > hash((i + 1) * 1.7 + seed)) peaks.push([x, y, r]);   // snow only on real summits
  }
  ctx.lineTo(W + 60, H + 10); ctx.closePath(); ctx.fill();
  ctx.fillStyle = snow;
  for (const [x, y, r] of peaks) { const cw = stepX * 0.22 * r, ch = h * 0.12 * r; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - cw, y + ch); ctx.lineTo(x - cw * 0.35, y + ch * 0.7); ctx.lineTo(x + cw * 0.3, y + ch * 1.05); ctx.lineTo(x + cw, y + ch); ctx.closePath(); ctx.fill(); }
}

function drawTree(x, by, h) {
  ctx.fillStyle = '#5b3a21'; ctx.fillRect(x - 4, by - h * 0.3, 8, h * 0.3);
  const w = h * 0.5;
  for (let k = 0; k < 3; k++) {
    const ty = by - h * 0.25 - k * h * 0.25, tw = w * (1 - k * 0.22), th = h * 0.38;
    ctx.fillStyle = k % 2 ? '#2f6b3a' : '#3b7f45'; ctx.beginPath(); ctx.moveTo(x - tw, ty); ctx.lineTo(x, ty - th); ctx.lineTo(x + tw, ty); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.beginPath(); ctx.moveTo(x, ty); ctx.lineTo(x, ty - th); ctx.lineTo(x + tw, ty); ctx.closePath(); ctx.fill();
  }
}

function drawCloud(x, y, s) {
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.beginPath(); ctx.arc(x, y, 26 * s, 0, 7); ctx.arc(x + 30 * s, y - 14 * s, 32 * s, 0, 7); ctx.arc(x + 66 * s, y - 4 * s, 26 * s, 0, 7); ctx.arc(x + 34 * s, y + 8 * s, 28 * s, 0, 7); ctx.fill();
  ctx.fillStyle = 'rgba(160,190,215,0.35)';
  ctx.beginPath(); ctx.ellipse(x + 34 * s, y + 20 * s, 60 * s, 10 * s, 0, 0, 7); ctx.fill();
}

function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }

function drawWheel(w) {
  ctx.save(); ctx.translate(w.position.x, w.position.y); ctx.rotate(w.angle);
  const sh = w.shape;
  const path = () => { ctx.beginPath(); sh.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); };
  // rubber tire with radial shading
  const tg = ctx.createRadialGradient(-w.radius * 0.3, -w.radius * 0.3, 2, 0, 0, w.radius * 1.1);
  tg.addColorStop(0, '#4a4a52'); tg.addColorStop(0.7, '#25252b'); tg.addColorStop(1, '#141417');
  path(); ctx.fillStyle = tg; ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = '#0d0d10'; ctx.lineJoin = 'round'; ctx.stroke();
  // tread notches along every edge
  ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.lineWidth = 2; ctx.beginPath();
  for (let i = 0; i < sh.length; i++) {
    const a = sh[i], b = sh[(i + 1) % sh.length], L = Math.hypot(b.x - a.x, b.y - a.y), n = Math.max(1, Math.round(L / 9));
    for (let k = 0; k < n; k++) { const t = (k + 0.5) / n, px = a.x + (b.x - a.x) * t, py = a.y + (b.y - a.y) * t, len = Math.hypot(px, py) || 1; ctx.moveTo(px * (1 - 5 / len), py * (1 - 5 / len)); ctx.lineTo(px * (1 - 1 / len), py * (1 - 1 / len)); }
  }
  ctx.stroke();
  // alloy rim with spokes, clipped to the tire so drawn shapes still look right
  path(); ctx.save(); ctx.clip();
  const rr = Math.max(7, Math.min(w.radius * 0.55, 16));
  const rg = ctx.createRadialGradient(-rr * 0.3, -rr * 0.3, 1, 0, 0, rr);
  rg.addColorStop(0, '#f6f7fa'); rg.addColorStop(0.6, '#b9bec9'); rg.addColorStop(1, '#6f7580');
  ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(0, 0, rr, 0, 7); ctx.fill();
  ctx.strokeStyle = '#4a4f59'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.strokeStyle = 'rgba(60,65,75,0.8)'; ctx.lineWidth = 2.2; ctx.beginPath();
  for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2; ctx.moveTo(Math.cos(a) * 3, Math.sin(a) * 3); ctx.lineTo(Math.cos(a) * (rr - 2), Math.sin(a) * (rr - 2)); }
  ctx.stroke();
  ctx.fillStyle = '#e3b341'; ctx.beginPath(); ctx.arc(0, 0, 3.2, 0, 7); ctx.fill();
  ctx.restore();
  ctx.restore();
}

function drawCar(c) {
  ctx.save(); ctx.translate(c.position.x, c.position.y + G.bounce); ctx.rotate(c.angle);
  ctx.fillStyle = '#2a2a30'; roundRect(-50, -4, 100, 14, 5); ctx.fill();                       // under-body
  const bg = ctx.createLinearGradient(0, -14, 0, 14); bg.addColorStop(0, '#ff7a5c'); bg.addColorStop(0.5, '#e6452c'); bg.addColorStop(1, '#a52a18');
  ctx.fillStyle = bg; roundRect(-56, -13, 112, 26, 9); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 2; roundRect(-56, -13, 112, 26, 9); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.28)'; roundRect(-50, -11, 100, 5, 3); ctx.fill();          // paint highlight
  ctx.fillStyle = '#c9ced6'; roundRect(50, -6, 10, 14, 3); ctx.fill(); roundRect(-60, -6, 10, 14, 3); ctx.fill();   // bumpers
  ctx.fillStyle = '#fff4b0'; ctx.beginPath(); ctx.arc(55, -8, 3.5, 0, 7); ctx.fill();          // headlight
  ctx.fillStyle = '#ff3b3b'; ctx.beginPath(); ctx.arc(-55, -8, 3, 0, 7); ctx.fill();           // tail light
  const cg = ctx.createLinearGradient(0, -36, 0, -10); cg.addColorStop(0, '#ffc86b'); cg.addColorStop(1, '#e09a2f');
  ctx.fillStyle = cg; roundRect(-32, -35, 60, 25, 8); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.3)'; roundRect(-32, -35, 60, 25, 8); ctx.stroke();
  const wg = ctx.createLinearGradient(-4, -31, 22, -15); wg.addColorStop(0, '#e8f7ff'); wg.addColorStop(0.5, '#9fd4f5'); wg.addColorStop(1, '#5ea9d6');
  ctx.fillStyle = wg; roundRect(-4, -31, 28, 17, 4); ctx.fill();                                // windshield
  ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(2, -29); ctx.lineTo(10, -16); ctx.stroke();
  ctx.strokeStyle = '#8b939e'; ctx.lineWidth = 3.5; ctx.beginPath(); ctx.moveTo(-26, -12); ctx.lineTo(-24, -46); ctx.lineTo(-8, -46); ctx.stroke();   // roll bar
  ctx.fillStyle = '#8b939e'; roundRect(-64, -2, 12, 6, 3); ctx.fill();                          // exhaust
  ctx.fillStyle = '#f2c9a0'; ctx.beginPath(); ctx.arc(-16, -40, 9, 0, 7); ctx.fill();          // driver
  ctx.fillStyle = '#2b2d42'; ctx.beginPath(); ctx.arc(-16, -41, 10, Math.PI, 0); ctx.fill();   // helmet
  ctx.fillStyle = 'rgba(120,200,255,0.75)'; roundRect(-14, -44, 10, 5, 2); ctx.fill();          // visor
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
  if (G.state !== 'play') sfx.engineStop();
  draw();
}
requestAnimationFrame(frame);

window.__dw = { G, step, startLevel, setShape, PRESETS, respawn, draw };
