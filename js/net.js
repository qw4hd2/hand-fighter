// Thin wrapper around PeerJS (loaded globally from a script tag) for
// 2-player rooms. The host claims a peer id derived from a short room code;
// the guest connects to that id. The free PeerJS cloud handles signaling,
// then traffic flows peer-to-peer over WebRTC (STUN hole punching).
const PREFIX = 'hand-fighter-v1-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' },
  ],
};

export function genCode() {
  let s = '';
  for (let i = 0; i < 4; i++) s += CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0];
  return s;
}

export class NetSession {
  constructor(handlers) {
    this.h = handlers || {};
    this.peer = null;
    this.conn = null;
    this.closed = false;
    this.timers = [];
    this.joinAttempts = 0;
    this.code = null;
    this.role = null;
  }

  _t(fn, ms) { const t = setTimeout(fn, ms); this.timers.push(t); return t; }
  _clearTimers() { this.timers.forEach(clearTimeout); this.timers = []; }
  get hosting() { return this.role === 'host'; }
  get connected() { return !!(this.conn && this.conn.open); }

  host(code) {
    this.role = 'host';
    this.code = code;
    this.h.onStatus?.('contacting connection server…');
    this._t(() => {
      if (!this.closed && !(this.peer && this.peer.open)) this.h.onError?.({ type: 'timeout' });
    }, 12000);
    this.peer = new Peer(PREFIX + code, { config: RTC_CONFIG });
    this.peer.on('open', () => { this._clearTimers(); this.h.onRoomOpen?.(code); });
    this.peer.on('connection', (c) => {
      if (this.conn) { c.close(); return; }  // room is full
      this._bind(c);
    });
    this.peer.on('disconnected', () => {
      if (!this.closed) { try { this.peer.reconnect(); } catch (e) { /* gone */ } }
    });
    this.peer.on('error', (e) => this._err(e));
  }

  join(code) {
    this.role = 'guest';
    this.code = code;
    this.h.onStatus?.('contacting connection server…');
    this._t(() => {
      if (!this.closed && !(this.peer && this.peer.open)) this.h.onError?.({ type: 'timeout' });
    }, 12000);
    this.peer = new Peer({ config: RTC_CONFIG });
    this.peer.on('open', () => this._connect());
    this.peer.on('disconnected', () => {
      if (!this.closed) { try { this.peer.reconnect(); } catch (e) { /* gone */ } }
    });
    this.peer.on('error', (e) => {
      // The host may still be registering the room — retry a couple of times.
      if (e && e.type === 'peer-unavailable' && this.joinAttempts < 3 && !this.closed) {
        this.h.onStatus?.('room not found yet — retrying…');
        this._t(() => this._connect(), 2500);
      } else {
        this._err(e);
      }
    });
  }

  _connect() {
    if (this.closed) return;
    this.joinAttempts++;
    this.h.onStatus?.(`locating room ${this.code}…`);
    const c = this.peer.connect(PREFIX + this.code, { reliable: true });
    this._bind(c);
  }

  _bind(c) {
    this.conn = c;
    c.on('open', () => { this._clearTimers(); this.h.onConnected?.(); });
    c.on('data', (d) => this.h.onData?.(d));
    c.on('close', () => { if (!this.closed) this.h.onClose?.(); });
    c.on('error', (e) => this._err(e));

    // If signaling worked but the direct link never comes up, the players'
    // networks are blocking WebRTC — surface that clearly instead of hanging.
    this._t(() => {
      if (!this.closed && !this.connected) this.h.onError?.({ type: 'ice-failed' });
    }, 18000);
    const watchIce = () => {
      const pc = c.peerConnection;
      if (!pc || this.closed) return;
      this.h.onStatus?.('room found — establishing direct link…');
      pc.addEventListener('iceconnectionstatechange', () => {
        if (!this.closed && pc.iceConnectionState === 'failed') {
          this.h.onError?.({ type: 'ice-failed' });
        }
      });
    };
    if (c.peerConnection) watchIce();
    else this._t(watchIce, 700);
  }

  _err(e) { if (!this.closed) this.h.onError?.(e); }

  send(obj) {
    if (this.conn && this.conn.open) {
      try { this.conn.send(obj); } catch (e) { /* dropped packet */ }
    }
  }

  close() {
    this.closed = true;
    this._clearTimers();
    try { this.conn && this.conn.close(); } catch (e) { /* already closed */ }
    try { this.peer && this.peer.destroy(); } catch (e) { /* already gone */ }
    this.conn = null;
    this.peer = null;
  }
}
