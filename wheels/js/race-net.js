// Multi-player room on top of PeerJS (loaded globally from a script tag).
// One host claims a peer id derived from a short room code; every other
// player connects to the host, which relays state to everyone (star topology).
// Signaling goes through the free PeerJS cloud; game traffic is WebRTC,
// with the same STUN/TURN setup Hand Fighter uses so phones on mobile data connect.
const PREFIX = 'doodle-wheels-v1-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const TURN_CREDS_URL = 'https://handfighter.metered.live/api/v1/turn/credentials?apiKey=f5840f4a4d13a87d6b15a5e07988e9777a68';
const STUN_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];
const FALLBACK_TURN = [{
  urls: [
    'turn:global.relay.metered.ca:80',
    'turn:global.relay.metered.ca:80?transport=tcp',
    'turn:global.relay.metered.ca:443',
    'turns:global.relay.metered.ca:443?transport=tcp',
  ],
  username: '821879a18cf2b842afad1924',
  credential: '/hQppehPTZPoPnt3',
}];

async function fetchIceServers() {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 6000);
    const r = await fetch(TURN_CREDS_URL, { signal: ctl.signal });
    clearTimeout(t);
    if (r.ok) {
      const servers = await r.json();
      if (Array.isArray(servers) && servers.length) return [...STUN_SERVERS, ...servers];
    }
  } catch (e) { console.warn('TURN credential fetch failed, using fallback:', e); }
  return [...STUN_SERVERS, ...FALLBACK_TURN];
}

export function genCode() {
  let s = '';
  for (let i = 0; i < 4; i++) s += CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0];
  return s;
}

export class RaceRoom {
  constructor(handlers) {
    this.h = handlers || {};
    this.peer = null;
    this.conns = new Map();     // host: peerId -> DataConnection
    this.hostConn = null;       // guest: connection to the host
    this.role = null;
    this.code = null;
    this.maxPlayers = 6;
    this.closed = false;
    this.timers = [];
    this.joinAttempts = 0;
  }

  _t(fn, ms) { const t = setTimeout(fn, ms); this.timers.push(t); return t; }
  _clearTimers() { this.timers.forEach(clearTimeout); this.timers = []; }
  get hosting() { return this.role === 'host'; }
  get connected() { return this.hosting ? !!(this.peer && this.peer.open) : !!(this.hostConn && this.hostConn.open); }
  get playerCount() { return this.hosting ? this.conns.size + 1 : 0; }

  async host(code, maxPlayers) {
    this.role = 'host';
    this.code = code;
    this.maxPlayers = maxPlayers || 6;
    this.h.onStatus?.('preparing relay…');
    this._t(() => { if (!this.closed && !(this.peer && this.peer.open)) this.h.onError?.({ type: 'timeout' }); }, 15000);
    const iceServers = await fetchIceServers();
    if (this.closed) return;
    this.h.onStatus?.('contacting connection server…');
    this.peer = new Peer(PREFIX + code, { config: { iceServers } });
    this.peer.on('open', () => { this._clearTimers(); this.h.onRoomOpen?.(code); });
    this.peer.on('connection', (c) => {
      if (this.conns.size >= this.maxPlayers - 1) {
        c.on('open', () => { try { c.send({ t: 'full' }); } catch (e) { /* ignore */ } setTimeout(() => { try { c.close(); } catch (e) { /* ignore */ } }, 400); });
        return;
      }
      c.on('open', () => { this.conns.set(c.peer, c); this.h.onPeerJoin?.(c.peer); });
      c.on('data', (d) => this.h.onData?.(c.peer, d));
      c.on('close', () => { if (this.conns.delete(c.peer)) this.h.onPeerLeave?.(c.peer); });
      c.on('error', () => { if (this.conns.delete(c.peer)) this.h.onPeerLeave?.(c.peer); });
    });
    this.peer.on('disconnected', () => { if (!this.closed) { try { this.peer.reconnect(); } catch (e) { /* gone */ } } });
    this.peer.on('error', (e) => this._err(e));
  }

  async join(code) {
    this.role = 'guest';
    this.code = code;
    this.h.onStatus?.('preparing relay…');
    this._t(() => { if (!this.closed && !(this.peer && this.peer.open)) this.h.onError?.({ type: 'timeout' }); }, 15000);
    const iceServers = await fetchIceServers();
    if (this.closed) return;
    this.h.onStatus?.('contacting connection server…');
    this.peer = new Peer({ config: { iceServers } });
    this.peer.on('open', () => this._connect());
    this.peer.on('disconnected', () => { if (!this.closed) { try { this.peer.reconnect(); } catch (e) { /* gone */ } } });
    this.peer.on('error', (e) => {
      if (e && e.type === 'peer-unavailable' && this.joinAttempts < 3 && !this.closed) {
        this.h.onStatus?.('room not found yet — retrying…');
        this._t(() => this._connect(), 2500);
      } else this._err(e);
    });
  }

  _connect() {
    if (this.closed) return;
    this.joinAttempts++;
    this.h.onStatus?.(`locating room ${this.code}…`);
    const c = this.peer.connect(PREFIX + this.code, { reliable: true });
    this.hostConn = c;
    c.on('open', () => { this._clearTimers(); this.h.onConnected?.(); });
    c.on('data', (d) => {
      if (d && d.t === 'full') { this.h.onError?.({ type: 'full' }); return; }
      this.h.onData?.('host', d);
    });
    c.on('close', () => { if (!this.closed) this.h.onClose?.(); });
    c.on('error', (e) => this._err(e));
    this._t(() => { if (!this.closed && !this.connected) this.h.onError?.({ type: 'ice-failed' }); }, 18000);
    const watchIce = () => {
      const pc = c.peerConnection;
      if (!pc || this.closed) return;
      this.h.onStatus?.('room found — establishing direct link…');
      pc.addEventListener('iceconnectionstatechange', () => {
        if (!this.closed && pc.iceConnectionState === 'failed') this.h.onError?.({ type: 'ice-failed' });
      });
    };
    if (c.peerConnection) watchIce(); else this._t(watchIce, 700);
  }

  _err(e) { if (!this.closed) this.h.onError?.(e); }

  // guest → host
  send(obj) {
    if (this.hostConn && this.hostConn.open) { try { this.hostConn.send(obj); } catch (e) { /* dropped */ } }
  }
  // host → one guest
  sendTo(id, obj) {
    const c = this.conns.get(id);
    if (c && c.open) { try { c.send(obj); } catch (e) { /* dropped */ } }
  }
  // host → every guest (optionally skipping one)
  broadcast(obj, exceptId) {
    for (const [id, c] of this.conns) {
      if (id === exceptId || !c.open) continue;
      try { c.send(obj); } catch (e) { /* dropped */ }
    }
  }

  close() {
    this.closed = true;
    this._clearTimers();
    for (const c of this.conns.values()) { try { c.close(); } catch (e) { /* ignore */ } }
    this.conns.clear();
    try { this.hostConn && this.hostConn.close(); } catch (e) { /* ignore */ }
    try { this.peer && this.peer.destroy(); } catch (e) { /* ignore */ }
    this.hostConn = null;
    this.peer = null;
  }
}
