// App wiring: menu → (character select | online lobby) → fight.
import { CHARACTERS } from './characters.js';
import { Game } from './game.js';
import { Controls } from './input.js';
import { HandTracker } from './hands.js';
import { NetSession, genCode } from './net.js';
import { sfx } from './sfx.js';
import { CG } from './cg.js';

const $ = (id) => document.getElementById(id);

const state = {
  mode: 'cpu',            // 'cpu' | '2p' | 'online'
  chars: [0, 1],          // selected character index per player
  difficulty: localStorage.getItem('hf-diff') || 'normal',
  game: null,
  controls: null,
  tracker: null,
  net: null,
  netTimer: null,
  role: null,             // 'host' | 'guest' when online
  onlineCfg: null,        // cached fight config for online rematches
};

const handsEnabled = () => localStorage.getItem('hf-hands') !== '0';
const soundMuted = () => localStorage.getItem('hf-mute') === '1';

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

function renderDifficulty() {
  document.querySelectorAll('.diff-btn').forEach(b => {
    b.classList.toggle('selected', b.dataset.d === state.difficulty);
  });
}

function openSetup(mode) {
  state.mode = mode;
  $('difficulty-row').classList.toggle('hidden', mode !== 'cpu');
  renderDifficulty();
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

// ---------- shared fight helpers ----------
const IS_TOUCH = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

function enterFightUi() {
  showScreen('game-screen');
  $('end-buttons').classList.add('hidden');
  $('touch-controls').classList.toggle('hidden', !IS_TOUCH);
  sfx.setMuted(soundMuted());
  sfx.startMusic();
  CG.gameplayStart();
  if (IS_TOUCH) {
    // best-effort fullscreen landscape on phones; ignore if the browser refuses
    try {
      const p = document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
      if (p && p.then) p.then(() => {
        if (screen.orientation && screen.orientation.lock) {
          screen.orientation.lock('landscape').catch(() => {});
        }
      }).catch(() => {});
    } catch (e) { /* not supported */ }
  }
}

function startTracker(twoPlayerCam) {
  if (!handsEnabled()) {
    $('cam-status').textContent = 'hand tracking off — keys / touch';
    $('cam-panel').className = 'cam-hidden';
    return;
  }
  $('cam-panel').className = CAM_MODES[camMode] || '';
  state.tracker = new HandTracker({
    video: $('cam-video'),
    canvas: $('cam-canvas'),
    twoPlayer: twoPlayerCam,
    onStatus: (msg) => { $('cam-status').textContent = msg; },
    onUpdate: (players) => state.controls && state.controls.updateHands(players),
  });
  state.tracker.start().catch((err) => {
    console.warn('Hand tracking unavailable:', err);
    $('cam-status').textContent = '📷 camera unavailable — keyboard controls active';
  });
}

function stopFight() {
  CG.gameplayStop();
  sfx.stopMusic();
  if (state.game) { state.game.destroy(); state.game = null; }
  if (state.controls) { state.controls.destroy(); state.controls = null; }
  if (state.tracker) { state.tracker.stop(); state.tracker = null; }
}

function cleanupNet() {
  if (state.netTimer) { clearInterval(state.netTimer); state.netTimer = null; }
  if (state.net) { state.net.close(); state.net = null; }
  state.role = null;
  state.onlineCfg = null;
}

// ---------- local fight (1P / same-camera 2P) ----------
function startFight() {
  sfx.unlock();
  const ch1 = CHARACTERS[state.chars[0]];
  const ch2 = CHARACTERS[state.chars[1]];
  const cfg = {
    mode: state.mode,
    difficulty: state.difficulty,
    p1: { name: $('name-p1').value.trim() || 'Player 1', ch: ch1 },
    p2: { name: state.mode === 'cpu' ? `CPU ${ch2.name}` : ($('name-p2').value.trim() || 'Player 2'), ch: ch2 },
  };

  enterFightUi();

  state.controls = new Controls(state.mode);
  startTracker(state.mode === '2p');
  state.game = new Game($('game-canvas'), cfg, state.controls, {
    onMatchEnd: () => showEndButtons(),
  });
}

// ---------- online flow ----------
function selfInfo() {
  return { name: $('name-online').value.trim() || 'Player', charId: state.chars[0] };
}

function sanitizeName(n) {
  return (typeof n === 'string' && n.trim() ? n.trim() : 'Partner').slice(0, 14);
}

function charIdx(i) {
  const n = parseInt(i, 10);
  return Number.isInteger(n) && n >= 0 && n < CHARACTERS.length ? n : 0;
}

function openOnline() {
  sfx.unlock();
  cleanupNet();
  buildCards($('cards-online'), 0);
  $('online-status').textContent = '';
  $('room-code-box').classList.add('hidden');
  showScreen('online-screen');
}

function netHandlers(role) {
  return {
    onStatus: (s) => { $('online-status').textContent = s; },
    onRoomOpen: (code) => {
      $('room-code').textContent = code;
      $('room-code-box').classList.remove('hidden');
      $('online-status').textContent = 'room open — waiting for your partner…';
      const inv = CG.inviteUrl(code);
      state.inviteUrl = inv;
      $('btn-invite').classList.toggle('hidden', !inv);
    },
    onConnected: () => {
      if (role === 'guest') {
        state.net.send({ t: 'hello', ...selfInfo() });
        $('online-status').textContent = 'connected — waiting for host…';
      } else {
        $('online-status').textContent = 'partner connected — starting…';
      }
    },
    onData: (d) => handleNetData(role, d),
    onClose: () => onNetLost(),
    onError: (e) => {
      const t = e && e.type;
      const msg = t === 'peer-unavailable' ? 'room not found — double-check the code with your partner'
        : t === 'unavailable-id' ? 'code already in use — click CREATE ROOM again'
        : t === 'timeout' ? 'cannot reach the connection server — check your internet and try again'
        : t === 'ice-failed' ? 'a network is blocking the direct link — try again with one player on a phone hotspot'
        : 'connection error — try again';
      $('online-status').textContent = msg;
    },
  };
}

function handleNetData(role, d) {
  if (!d || typeof d !== 'object') return;
  if (role === 'host') {
    if (d.t === 'hello' && !state.game) {
      const guest = { name: sanitizeName(d.name), charId: charIdx(d.charId) };
      state.net.send({ t: 'start', p1: selfInfo(), p2: guest });
      startOnlineFight('host', selfInfo(), guest);
    } else if (d.t === 'input' && state.game) {
      state.game.setRemoteInput(d);
    }
  } else {
    if (d.t === 'start' && !state.game) {
      startOnlineFight('guest',
        { name: sanitizeName(d.p1 && d.p1.name), charId: charIdx(d.p1 && d.p1.charId) },
        { name: sanitizeName(d.p2 && d.p2.name), charId: charIdx(d.p2 && d.p2.charId) });
    } else if (d.t === 'state' && state.game) {
      state.game.applyState(d.s);
    } else if (d.t === 'rematch' && state.game) {
      recreateOnlineGame();
    }
  }
}

function startOnlineFight(role, p1Info, p2Info) {
  state.role = role;
  const mk = (info) => ({ name: info.name, ch: CHARACTERS[info.charId] });
  state.onlineCfg = role === 'host'
    ? { mode: 'net-host', p1: mk(p1Info), p2: mk(p2Info) }
    : { mode: 'ghost', ownSide: 1, p1: mk(p1Info), p2: mk(p2Info) };

  enterFightUi();
  state.controls = new Controls('online');
  startTracker(false);
  state.game = new Game($('game-canvas'), state.onlineCfg, state.controls, {
    onMatchEnd: () => showEndButtons(),
  });

  if (role === 'host') {
    state.netTimer = setInterval(() => {
      if (state.game && state.net) state.net.send({ t: 'state', s: state.game.getState() });
    }, 33);
  } else {
    state.netTimer = setInterval(() => {
      if (state.controls && state.net) state.net.send({ t: 'input', ...state.controls.consume(0) });
    }, 33);
  }
}

function recreateOnlineGame() {
  if (!state.onlineCfg) return;
  if (state.game) state.game.destroy();
  $('end-buttons').classList.add('hidden');
  CG.gameplayStart();
  sfx.startMusic();
  state.game = new Game($('game-canvas'), state.onlineCfg, state.controls, {
    onMatchEnd: () => showEndButtons(),
  });
}

function onNetLost() {
  const wasOnline = !!state.net;
  cleanupNet();
  if (!wasOnline) return;
  stopFight();
  openOnline();
  $('online-status').textContent = 'partner disconnected';
}

function showEndButtons() {
  CG.gameplayStop();
  CG.happytime();
  state.matchEnded = true;
  $('end-buttons').classList.remove('hidden');
  const online = !!state.role;
  // Guests can't restart the match — the host drives it.
  $('btn-rematch').style.display = state.role === 'guest' ? 'none' : '';
  $('btn-newfighters').style.display = online ? 'none' : '';
}

function quitToMenu() {
  const afterAd = () => {
    cleanupNet();
    stopFight();
    showScreen('menu-screen');
  };
  if (state.matchEnded) {
    state.matchEnded = false;
    CG.midgameAd(sfx, afterAd);   // natural break: ad after a finished match
  } else {
    afterAd();
  }
}

// ---------- buttons ----------
$('btn-1p').addEventListener('click', () => { sfx.unlock(); openSetup('cpu'); });
$('btn-2p').addEventListener('click', () => { sfx.unlock(); openSetup('2p'); });
$('btn-online').addEventListener('click', openOnline);
$('btn-back').addEventListener('click', () => showScreen('menu-screen'));
$('btn-fight').addEventListener('click', startFight);
$('btn-quit').addEventListener('click', quitToMenu);
$('btn-menu2').addEventListener('click', quitToMenu);
$('btn-newfighters').addEventListener('click', () => { stopFight(); openSetup(state.mode); });
$('btn-rematch').addEventListener('click', () => {
  state.matchEnded = false;
  CG.midgameAd(sfx, () => {      // natural break: ad between matches
    if (state.role === 'host') {
      if (state.net) state.net.send({ t: 'rematch' });
      recreateOnlineGame();
    } else {
      stopFight();
      startFight();
    }
  });
});
$('btn-online-back').addEventListener('click', () => { cleanupNet(); showScreen('menu-screen'); });
$('btn-create').addEventListener('click', () => {
  cleanupNet();
  $('join-code').value = '';
  $('room-code-box').classList.add('hidden');
  state.net = new NetSession(netHandlers('host'));
  state.net.host(genCode());
});
$('join-code').addEventListener('input', (e) => {
  e.target.value = e.target.value.replace(/\s+/g, '').toUpperCase();
});
// difficulty selector (1P vs CPU)
document.querySelectorAll('.diff-btn').forEach((b) => {
  b.addEventListener('click', () => {
    state.difficulty = b.dataset.d;
    localStorage.setItem('hf-diff', state.difficulty);
    renderDifficulty();
  });
});

// hand-tracking opt-out (persisted)
$('opt-hands').checked = handsEnabled();
$('opt-hands').addEventListener('change', (e) => {
  localStorage.setItem('hf-hands', e.target.checked ? '1' : '0');
});

// mute toggle (persisted)
function renderMute() { $('btn-mute').textContent = soundMuted() ? '🔇' : '🔊'; }
renderMute();
$('btn-mute').addEventListener('click', () => {
  localStorage.setItem('hf-mute', soundMuted() ? '0' : '1');
  sfx.setMuted(soundMuted());
  if (!soundMuted()) { sfx.unlock(); sfx.startMusic(); }
  renderMute();
});

// share button — copy the game link to challenge friends
$('btn-share').addEventListener('click', () => {
  const url = location.origin + location.pathname;
  const done = () => {
    $('btn-share').textContent = '✓ Link copied!';
    setTimeout(() => { $('btn-share').textContent = '🔗 Copy game link'; }, 1800);
  };
  if (navigator.clipboard) navigator.clipboard.writeText(url).then(done).catch(() => {});
  else done();
});

// CrazyGames invite link (only visible when playing on crazygames.com)
$('btn-invite').addEventListener('click', (e) => {
  e.stopPropagation();
  if (state.inviteUrl && navigator.clipboard) {
    navigator.clipboard.writeText(state.inviteUrl).then(() => {
      $('btn-invite').textContent = '✓ Invite link copied!';
      setTimeout(() => { $('btn-invite').textContent = '🔗 Copy invite link'; }, 1800);
    }).catch(() => {});
  }
});

// initialize the CrazyGames SDK (no-op elsewhere) and honor invite links
CG.init().then(() => {
  const room = CG.inviteParam();
  if (room) {
    openOnline();
    $('join-code').value = String(room).toUpperCase().slice(0, 4);
    $('online-status').textContent = 'invite received — click JOIN to enter the room';
  }
});

// on-screen touch buttons drive the local player
document.querySelectorAll('#touch-controls .tc-btn').forEach((btn) => {
  const k = btn.dataset.k;
  const down = (e) => { e.preventDefault(); if (state.controls) state.controls.touchSet(k, true); };
  const up = (e) => { e.preventDefault(); if (state.controls) state.controls.touchSet(k, false); };
  btn.addEventListener('pointerdown', down);
  btn.addEventListener('pointerup', up);
  btn.addEventListener('pointercancel', up);
  btn.addEventListener('pointerleave', up);
});

// tap the camera preview to shrink or hide it
const CAM_MODES = ['', 'cam-mini', 'cam-hidden'];
let camMode = 0;
$('cam-panel').addEventListener('click', () => {
  camMode = (camMode + 1) % CAM_MODES.length;
  $('cam-panel').className = CAM_MODES[camMode];
});

$('btn-join').addEventListener('click', () => {
  const code = $('join-code').value.replace(/\s+/g, '').toUpperCase();
  if (code.length !== 4) {
    $('online-status').textContent = 'enter the 4-character room code';
    return;
  }
  // Don't let the room creator destroy their own room by "testing" the code —
  // the JOIN side is for the partner on their own device.
  if (state.net && state.net.hosting && state.net.code === code && !state.net.connected) {
    $('online-status').textContent = "that's your own room — your partner types this code on THEIR device";
    return;
  }
  cleanupNet();
  $('room-code-box').classList.add('hidden');
  $('online-status').textContent = 'connecting…';
  state.net = new NetSession(netHandlers('guest'));
  state.net.join(code);
});
