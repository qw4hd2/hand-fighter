// Webcam hand tracking + gesture recognition using MediaPipe HandLandmarker.
// Emits per-player state: { present, x, y, gesture } where x/y are mirrored
// (selfie-view) coordinates in [0..1].
import { FilesetResolver, HandLandmarker } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

// A finger counts as extended when its tip is clearly farther from the wrist
// than its middle joint.
function fingerExtended(lm, tip, pip) {
  return dist(lm[tip], lm[0]) > dist(lm[pip], lm[0]) * 1.18;
}

export function classifyGesture(lm) {
  const idx = fingerExtended(lm, 8, 6);
  const mid = fingerExtended(lm, 12, 10);
  const ring = fingerExtended(lm, 16, 14);
  const pinky = fingerExtended(lm, 20, 18);
  const count = idx + mid + ring + pinky;
  if (count >= 4) return 'open';
  if (count === 3) return 'three';
  if (count === 2) return idx && mid ? 'peace' : 'three';
  return 'fist'; // 0 or 1 fingers — forgiving fist detection
}

export class HandTracker {
  constructor({ video, canvas, twoPlayer, onStatus, onUpdate }) {
    this.video = video;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.twoPlayer = twoPlayer;
    this.onStatus = onStatus || (() => {});
    this.onUpdate = onUpdate || (() => {});
    this.running = false;
    this.landmarker = null;
    this.stream = null;
    this.players = [null, null];
  }

  async start() {
    this.onStatus('requesting camera…');
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 360, facingMode: 'user' },
      audio: false,
    });
    this.video.srcObject = this.stream;
    await this.video.play();

    this.onStatus('loading hand model…');
    const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
    this.landmarker = await HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numHands: 2,
    });

    this.running = true;
    this.onStatus('camera ready — show your hand ✋');
    this._loop();
  }

  stop() {
    this.running = false;
    if (this.stream) this.stream.getTracks().forEach(t => t.stop());
    if (this.landmarker) { this.landmarker.close(); this.landmarker = null; }
  }

  _loop() {
    if (!this.running) return;
    requestAnimationFrame(() => this._loop());

    const v = this.video;
    if (v.readyState < 2) return;

    let result = null;
    try {
      result = this.landmarker.detectForVideo(v, performance.now());
    } catch (e) { return; }

    const players = [null, null];
    if (result && result.landmarks) {
      for (const lm of result.landmarks) {
        // Hand center from palm landmarks, mirrored for selfie view.
        const cx = (lm[0].x + lm[5].x + lm[9].x + lm[13].x + lm[17].x) / 5;
        const cy = (lm[0].y + lm[5].y + lm[9].y + lm[13].y + lm[17].y) / 5;
        const mx = 1 - cx;
        const gesture = classifyGesture(lm);
        const state = { present: true, x: mx, y: cy, gesture, lm };
        if (this.twoPlayer) {
          const slot = mx < 0.5 ? 0 : 1;
          if (!players[slot]) players[slot] = state;
        } else if (!players[0]) {
          players[0] = state;
        }
      }
    }
    this.players = players;
    this._drawPreview(players);
    this.onUpdate(players);
  }

  _drawPreview(players) {
    const ctx = this.ctx, w = this.canvas.width, h = this.canvas.height;
    ctx.save();
    ctx.translate(w, 0); ctx.scale(-1, 1);
    ctx.drawImage(this.video, 0, 0, w, h);
    ctx.restore();

    if (this.twoPlayer) {
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.setLineDash([6, 6]);
      ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.font = 'bold 13px sans-serif';
      ctx.fillText('P1', 8, 16);
      ctx.fillText('P2', w / 2 + 8, 16);
    }

    const colors = ['#ff5533', '#3fb8f5'];
    players.forEach((p, i) => {
      if (!p || !p.lm) return;
      ctx.fillStyle = colors[i];
      for (const pt of p.lm) {
        ctx.beginPath();
        ctx.arc((1 - pt.x) * w, pt.y * h, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = colors[i];
      ctx.lineWidth = 2;
      ctx.strokeRect(p.x * w - 26, p.y * h - 26, 52, 52);
    });
  }
}
