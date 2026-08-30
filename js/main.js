// App wiring: menu → character select → fight, plus camera lifecycle.
import { CHARACTERS } from './characters.js';
import { Game } from './game.js';
import { Controls } from './input.js';
import { HandTracker } from './hands.js';
import { sfx } from './sfx.js';

const $ = (id) => document.getElementById(id);

const state = {
  mode: 'cpu',            // 'cpu' | '2p'
  chars: [0, 1],          // selected character index per player
  game: null,
  controls: null,
  tracker: null,
};

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(id).classList.add('active');
}

// ---------- character select ----------
function buildCards(container, player) {
  container.innerHTML = '';
  CHARACTERS.forEach((c, idx) => {
    const card = document.createElement('button');
    card.className = 'char-card' + (state.chars[player] === idx ? ' selected' : '');
    card.innerHTML = `
      <span class="avatar" style="background:${c.color}; box-shadow:0 0 18px ${c.color}66">${c.name[0]}</span>
      <span class="char-name">${c.name}</span>
      <span class="char-desc">${c.desc}</span>
      <span class="stats">
        <i title="speed">⚡${'▮'.repeat(Math.round(c.speed * 3))}</i>
        <i title="power">👊${'▮'.repeat(Math.round(c.power * 3))}</i>
        <i title="health">❤${'▮'.repeat(Math.round(c.hp / 40))}</i>
      </span>`;
    card.addEventListener('click', () => {
      state.chars[player] = idx;
      buildCards(container, player);
    });
    container.appendChild(card);
  });
}

function openSetup(mode) {
  state.mode = mode;
  const p2Panel = $('panel-p2');
  if (mode === 'cpu') {
    $('panel-p2-title').textContent = 'CPU Opponent';
    $('name-p2').value = 'CPU';
    $('name-p2').disabled = true;
  } else {
    $('panel-p2-title').textContent = 'Player 2';
    $('name-p2').disabled = false;
    if ($('name-p2').value === 'CPU') $('name-p2').value = 'Player 2';
  }
  buildCards($('cards-p1'), 0);
  buildCards($('cards-p2'), 1);
  showScreen('setup-screen');
}

// ---------- game lifecycle ----------
function startFight() {
  sfx.unlock();
  const ch1 = CHARACTERS[state.chars[0]];
  const ch2 = CHARACTERS[state.chars[1]];
  const cfg = {
    mode: state.mode,
    p1: { name: $('name-p1').value.trim() || 'Player 1', ch: ch1 },
    p2: { name: state.mode === 'cpu' ? `CPU ${ch2.name}` : ($('name-p2').value.trim() || 'Player 2'), ch: ch2 },
  };

  showScreen('game-screen');
  $('end-buttons').classList.add('hidden');

  state.controls = new Controls(state.mode);

  state.tracker = new HandTracker({
    video: $('cam-video'),
    canvas: $('cam-canvas'),
    twoPlayer: state.mode === '2p',
    onStatus: (msg) => { $('cam-status').textContent = msg; },
    onUpdate: (players) => state.controls.updateHands(players),
  });
  state.tracker.start().catch((err) => {
    console.warn('Hand tracking unavailable:', err);
    $('cam-status').textContent = '📷 camera unavailable — keyboard controls active';
  });

  state.game = new Game($('game-canvas'), cfg, state.controls, {
    onMatchEnd: () => $('end-buttons').classList.remove('hidden'),
  });
}

function stopFight() {
  if (state.game) { state.game.destroy(); state.game = null; }
  if (state.controls) { state.controls.destroy(); state.controls = null; }
  if (state.tracker) { state.tracker.stop(); state.tracker = null; }
}

// ---------- buttons ----------
$('btn-1p').addEventListener('click', () => { sfx.unlock(); openSetup('cpu'); });
$('btn-2p').addEventListener('click', () => { sfx.unlock(); openSetup('2p'); });
$('btn-back').addEventListener('click', () => showScreen('menu-screen'));
$('btn-fight').addEventListener('click', startFight);
$('btn-quit').addEventListener('click', () => { stopFight(); showScreen('menu-screen'); });
$('btn-menu2').addEventListener('click', () => { stopFight(); showScreen('menu-screen'); });
$('btn-newfighters').addEventListener('click', () => { stopFight(); openSetup(state.mode); });
$('btn-rematch').addEventListener('click', () => { stopFight(); startFight(); });
