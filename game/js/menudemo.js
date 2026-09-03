// Live sparring demo on the main menu: two fighters loop through a scripted
// exchange so the very first thing a visitor sees is the game in motion.
import { Fighter } from './game.js';
import { CHARACTERS } from './characters.js';

// The fight engine draws in arena space (floor at y=564); we show a window
// of that space on the small menu canvas.
const VIEW = { x: 205, y: 315, w: 880, h: 265 };

const SCRIPT = [
  // [stateA, stateB, seconds]
  ['walk', 'walk', 0.9],
  ['idle', 'idle', 0.5],
  ['punch', 'hit', 0.55],
  ['idle', 'idle', 0.45],
  ['idle', 'kick', 0.6],
  ['block', 'idle', 0.6],
  ['kick', 'hit', 0.6],
  ['idle', 'idle', 0.5],
  ['jump', 'punch', 0.75],
  ['idle', 'idle', 0.5],
];

export function startMenuDemo(canvas, isActive) {
  const ctx = canvas.getContext('2d');
  const a = new Fighter({ name: '', ch: CHARACTERS[0] }, 0);
  const b = new Fighter({ name: '', ch: CHARACTERS[4] }, 1);
  a.x = 560; b.x = 730;
  let seg = 0, segT = 0, last = performance.now();

  function setSeg(i) {
    seg = i % SCRIPT.length;
    segT = 0;
    a.setState(SCRIPT[seg][0]);
    b.setState(SCRIPT[seg][1]);
    if (seg === 0) { a.x = 500; b.x = 790; }   // walk back in from wide
  }
  setSeg(0);

  function tick(now) {
    requestAnimationFrame(tick);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!isActive()) return;

    segT += dt;
    const [sa, sb, dur] = SCRIPT[seg];
    a.anim += dt; b.anim += dt;
    a.t += dt; b.t += dt;
    if (sa === 'walk') a.x = Math.min(560, a.x + 80 * dt);
    if (sb === 'walk') b.x = Math.max(730, b.x - 80 * dt);
    a.y = sa === 'jump' ? Math.sin(Math.min(1, segT / dur) * Math.PI) * 85 : 0;
    b.y = 0;
    a.facing = 1; b.facing = -1;
    if (segT >= dur) setSeg(seg + 1);

    // backdrop
    const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
    g.addColorStop(0, '#171226');
    g.addColorStop(1, '#2b1a35');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // arena window
    const s = canvas.width / VIEW.w;
    ctx.setTransform(s, 0, 0, s, -VIEW.x * s, -VIEW.y * s);
    // floor
    ctx.fillStyle = 'rgba(90,60,110,0.35)';
    ctx.fillRect(VIEW.x, 576, VIEW.w, 40);
    ctx.strokeStyle = 'rgba(255,180,220,0.3)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(VIEW.x, 576); ctx.lineTo(VIEW.x + VIEW.w, 576); ctx.stroke();

    b.draw(ctx);
    a.draw(ctx);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  requestAnimationFrame(tick);
}
