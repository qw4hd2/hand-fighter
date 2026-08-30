// Thin wrapper around PeerJS (loaded globally from a script tag) for
// 2-player rooms. The host claims a peer id derived from a short room code;
// the guest connects to that id. Uses the free PeerJS cloud for signaling,
// then traffic flows peer-to-peer over WebRTC.
const PREFIX = 'hand-fighter-v1-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

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
  }

  host(code) {
    this.role = 'host';
    this.peer = new Peer(PREFIX + code);
    this.peer.on('open', () => this.h.onStatus?.('room open — waiting for your partner…'));
    this.peer.on('connection', (c) => {
      if (this.conn) { c.close(); return; }  // room is full
      this._bind(c);
    });
    this.peer.on('error', (e) => this.h.onError?.(e));
  }

  join(code) {
    this.role = 'guest';
    this.peer = new Peer();
    this.peer.on('open', () => {
      const c = this.peer.connect(PREFIX + code, { reliable: true });
      this._bind(c);
    });
    this.peer.on('error', (e) => this.h.onError?.(e));
  }

  _bind(c) {
    this.conn = c;
    c.on('open', () => this.h.onConnected?.());
    c.on('data', (d) => this.h.onData?.(d));
    c.on('close', () => { if (!this.closed) this.h.onClose?.(); });
    c.on('error', (e) => this.h.onError?.(e));
  }

  send(obj) {
    if (this.conn && this.conn.open) {
      try { this.conn.send(obj); } catch (e) { /* dropped packet */ }
    }
  }

  close() {
    this.closed = true;
    try { this.conn && this.conn.close(); } catch (e) { /* already closed */ }
    try { this.peer && this.peer.destroy(); } catch (e) { /* already gone */ }
    this.conn = null;
    this.peer = null;
  }
}
