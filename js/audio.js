// Tiny synthesized sound effects (no audio files needed).
let ctx = null;
let noiseBuf = null;

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}

function tone(type, f0, f1, dur, vol) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(freq, q, dur, vol, type = 'bandpass') {
  if (!ctx) return;
  const t = ctx.currentTime;
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.03);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(ctx.destination);
  s.start(t);
  s.stop(t + dur + 0.02);
}

export const sfx = {
  bounce(v = 1) { tone('sine', 150, 55, 0.16, 0.5 * v); noise(900, 0.8, 0.05, 0.12 * v); },
  rim(v = 1) { tone('triangle', 520, 480, 0.22, 0.22 * v); tone('square', 1310, 1250, 0.09, 0.05 * v); },
  board(v = 1) { tone('sine', 210, 120, 0.12, 0.4 * v); noise(1800, 1, 0.04, 0.1 * v); },
  swish() { noise(3200, 0.7, 0.32, 0.4, 'highpass'); },
  shoot() { noise(600, 0.6, 0.12, 0.12); },
  score() { tone('sine', 660, 660, 0.12, 0.16); setTimeout(() => tone('sine', 990, 990, 0.2, 0.16), 90); },
  buzzer() { tone('sawtooth', 190, 185, 1.1, 0.22); tone('square', 95, 93, 1.1, 0.14); },
  tick() { tone('square', 880, 880, 0.05, 0.06); },
};
