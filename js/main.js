import * as THREE from 'three';
import { buildWorld, isThreePointer, BALL_R, COURT, BOARD, HOOP } from './scene.js';
import { initAudio, sfx } from './audio.js';

// ---------- Tunables ----------
const ROUND_TIME = 60;
const EYE_HEIGHT = 1.75;
const MOVE_SPEED = 4.2;
const GRAVITY = 9.81;
const LOFT = THREE.MathUtils.degToRad(25);   // added to the look pitch so aiming at the rim gives a real arc
const MAX_LAUNCH = THREE.MathUtils.degToRad(82);
const MIN_SPEED = 5, MAX_SPEED = 13;         // launch speed at 0% / 100% power
const CHARGE_TIME = 1.15;                    // seconds from empty to full power
const SHOT_COOLDOWN = 0.45;
const BALL_LIFE = 7;
const SUBSTEPS = 4;
const ARENA = { minX: -14, maxX: 14, minZ: -8, maxZ: 20 };
const BEST_KEY = 'elite-shooter-best';

// ---------- Setup ----------
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const { scene, net, makeBall } = buildWorld(renderer);
const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 100);
camera.rotation.order = 'YXZ';
scene.add(camera);

// Ball held in view, waiting to be shot
const heldBall = makeBall();
heldBall.castShadow = false;
const HELD_REST = new THREE.Vector3(0.27, -0.31, -0.66);
const HELD_UP = new THREE.Vector3(0.17, -0.22, -0.6);
heldBall.position.copy(HELD_REST);
camera.add(heldBall);

// Arc preview dots (only the first part of the flight)
const PREVIEW_N = 9;
const previewDots = [];
{
  const geo = new THREE.SphereGeometry(0.025, 8, 6);
  for (let i = 0; i < PREVIEW_N; i++) {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.85 * (1 - i / PREVIEW_N), depthWrite: false,
    }));
    m.visible = false;
    scene.add(m);
    previewDots.push(m);
  }
}

const isTouch = window.matchMedia('(pointer: coarse)').matches;

const ui = {
  hud: document.getElementById('hud'),
  overlay: document.getElementById('overlay'),
  msg: document.getElementById('overlayMsg'),
  results: document.getElementById('results'),
  playBtn: document.getElementById('playBtn'),
  score: document.getElementById('score'),
  time: document.getElementById('time'),
  timerBox: document.querySelector('.stat.timer'),
  streak: document.getElementById('streak'),
  popup: document.getElementById('popup'),
  zone: document.getElementById('zone'),
  powerFill: document.getElementById('powerFill'),
  touch: document.getElementById('touch'),
  stick: document.getElementById('stick'),
  knob: document.getElementById('knob'),
  shootBtn: document.getElementById('shootBtn'),
};
if (isTouch) {
  ui.touch.hidden = false;
  document.getElementById('controlsDesktop').hidden = true;
  document.getElementById('controlsTouch').hidden = false;
  document.getElementById('crosshair').style.opacity = '0.6';
}

// ---------- State ----------
const game = {
  mode: 'menu',            // menu | playing | paused | ending | over
  score: 0, streak: 0, makes: 0, attempts: 0,
  timeLeft: ROUND_TIME,
  endTimer: 0,
  best: Number(localStorage.getItem(BEST_KEY) || 0),
};
const player = { x: 0, z: 4.6, yaw: 0, pitch: 0.2 };
const input = { keys: new Set(), moveX: 0, moveY: 0, charging: false, chargeT: 0, cooldown: 0 };
const balls = [];
let netKick = 0;
let lastTick = -1;

// ---------- Shooting ----------
const tmpV = new THREE.Vector3();

function currentPower() {
  // Ping-pong 0 → 1 → 0 so over-holding isn't a free max-power shot
  const k = (input.chargeT / CHARGE_TIME) % 2;
  return k <= 1 ? k : 2 - k;
}

function launchParams(power) {
  const lp = Math.min(player.pitch + LOFT, MAX_LAUNCH);
  const speed = MIN_SPEED + (MAX_SPEED - MIN_SPEED) * power;
  const ch = Math.cos(lp);
  const vel = new THREE.Vector3(-Math.sin(player.yaw) * ch, Math.sin(lp), -Math.cos(player.yaw) * ch).multiplyScalar(speed);
  const pos = new THREE.Vector3(
    player.x - Math.sin(player.yaw) * 0.35,
    EYE_HEIGHT + 0.3,
    player.z - Math.cos(player.yaw) * 0.35
  );
  return { pos, vel };
}

function startCharge() {
  if (game.mode !== 'playing' || input.cooldown > 0 || input.charging) return;
  input.charging = true;
  input.chargeT = 0;
}

function releaseShot() {
  if (!input.charging) return;
  input.charging = false;
  if (game.mode !== 'playing') return;
  const { pos, vel } = launchParams(currentPower());
  const mesh = makeBall();
  mesh.position.copy(pos);
  scene.add(mesh);
  balls.push({
    mesh, pos, vel, prevY: pos.y,
    points: isThreePointer(player.x, player.z) ? 3 : 2,
    touched: false, scored: false, resolved: false, life: 0,
    spin: new THREE.Vector3(Math.cos(player.yaw), 0, -Math.sin(player.yaw)), // backspin axis
  });
  game.attempts++;
  input.cooldown = SHOT_COOLDOWN;
  sfx.shoot();
}

// ---------- Ball physics ----------
const boardMin = new THREE.Vector3(-BOARD.w / 2, BOARD.bottom, -BOARD.t);
const boardMax = new THREE.Vector3(BOARD.w / 2, BOARD.bottom + BOARD.h, 0);
const closest = new THREE.Vector3();
const normal = new THREE.Vector3();

// Push the ball out of a surface point and reflect its velocity. Returns impact speed (0 if no hit).
function collidePoint(b, point, radius, restitution) {
  normal.subVectors(b.pos, point);
  const d = normal.length();
  if (d >= radius || d < 1e-6) return 0;
  normal.multiplyScalar(1 / d);
  b.pos.copy(point).addScaledVector(normal, radius);
  const vn = b.vel.dot(normal);
  if (vn >= 0) return 0;
  b.vel.addScaledVector(normal, -(1 + restitution) * vn);
  return -vn;
}

function resolveMiss(b) {
  if (b.resolved) return;
  b.resolved = true;
  if (game.streak >= 2) showPopup('MISS', true);
  game.streak = 0;
}

function onScore(b) {
  b.scored = true;
  b.resolved = true;
  const swish = !b.touched;
  const pts = b.points + (swish ? 1 : 0);
  game.score += pts;
  game.makes++;
  game.streak++;
  netKick = 1;
  // The net slows the ball down
  b.vel.x *= 0.35; b.vel.z *= 0.35; b.vel.y *= 0.6;
  if (swish) sfx.swish(); else sfx.swish(), sfx.score();
  const label = swish ? 'SWISH!' : (b.points === 3 ? 'FROM DEEP!' : 'BUCKET!');
  showPopup(`${label} +${pts}`);
}

function stepBall(b, h) {
  b.prevY = b.pos.y;
  b.vel.y -= GRAVITY * h;
  b.pos.addScaledVector(b.vel, h);

  // Floor
  if (b.pos.y < BALL_R) {
    b.pos.y = BALL_R;
    if (b.vel.y < 0) {
      if (b.vel.y < -0.8) sfx.bounce(Math.min(1, -b.vel.y / 6));
      b.vel.y = -b.vel.y * 0.72;
      b.vel.x *= 0.92; b.vel.z *= 0.92;
      if (b.vel.y < 0.5) b.vel.y = 0;
    }
    resolveMiss(b);
  }

  // Backboard (sphere vs box)
  closest.copy(b.pos).clamp(boardMin, boardMax);
  let hit = collidePoint(b, closest, BALL_R, 0.62);
  if (hit > 0) { b.touched = true; if (hit > 0.5) sfx.board(Math.min(1, hit / 6)); }

  // Rim (sphere vs ring)
  const dx = b.pos.x - HOOP.x, dz = b.pos.z - HOOP.z;
  const hd = Math.hypot(dx, dz);
  if (hd > 1e-6) {
    closest.set(HOOP.x + (dx / hd) * HOOP.r, HOOP.y, HOOP.z + (dz / hd) * HOOP.r);
    hit = collidePoint(b, closest, BALL_R + HOOP.tube, 0.5);
    if (hit > 0) { b.touched = true; if (hit > 0.4) sfx.rim(Math.min(1, hit / 5)); }
  }

  // Through the hoop, moving down
  if (!b.scored && b.vel.y < 0 && b.prevY > HOOP.y && b.pos.y <= HOOP.y && hd < HOOP.r - 0.01) onScore(b);

  // Gym walls
  if (b.pos.x < ARENA.minX + BALL_R) { b.pos.x = ARENA.minX + BALL_R; b.vel.x = Math.abs(b.vel.x) * 0.6; }
  if (b.pos.x > ARENA.maxX - BALL_R) { b.pos.x = ARENA.maxX - BALL_R; b.vel.x = -Math.abs(b.vel.x) * 0.6; }
  if (b.pos.z < ARENA.minZ + BALL_R) { b.pos.z = ARENA.minZ + BALL_R; b.vel.z = Math.abs(b.vel.z) * 0.6; }
  if (b.pos.z > ARENA.maxZ - BALL_R) { b.pos.z = ARENA.maxZ - BALL_R; b.vel.z = -Math.abs(b.vel.z) * 0.6; }
}

function updateBalls(dt) {
  const h = dt / SUBSTEPS;
  for (let i = balls.length - 1; i >= 0; i--) {
    const b = balls[i];
    for (let s = 0; s < SUBSTEPS; s++) stepBall(b, h);
    b.life += dt;
    b.mesh.position.copy(b.pos);
    b.mesh.rotateOnWorldAxis(b.spin, b.vel.length() * dt * 2.2);
    if (b.life > BALL_LIFE) {
      resolveMiss(b);
      // Shrink away
      const k = 1 - (b.life - BALL_LIFE) / 0.3;
      if (k <= 0) { scene.remove(b.mesh); balls.splice(i, 1); } else b.mesh.scale.setScalar(k);
    }
  }
}

// ---------- Player ----------
function updatePlayer(dt) {
  let mx = input.moveX, my = input.moveY;
  const k = input.keys;
  if (k.has('KeyW') || k.has('ArrowUp')) my += 1;
  if (k.has('KeyS') || k.has('ArrowDown')) my -= 1;
  if (k.has('KeyD') || k.has('ArrowRight')) mx += 1;
  if (k.has('KeyA') || k.has('ArrowLeft')) mx -= 1;
  const len = Math.hypot(mx, my);
  if (len > 1) { mx /= len; my /= len; }
  if (len > 0 && game.mode === 'playing') {
    const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
    const speed = MOVE_SPEED * (input.charging ? 0.45 : 1); // you slow down while setting your shot
    player.x += (-sin * my + cos * mx) * speed * dt;
    player.z += (-cos * my - sin * mx) * speed * dt;
    player.x = THREE.MathUtils.clamp(player.x, COURT.minX + 0.3, COURT.maxX - 0.3);
    player.z = THREE.MathUtils.clamp(player.z, COURT.minZ + 0.4, COURT.maxZ - 0.3);
  }
  camera.position.set(player.x, EYE_HEIGHT, player.z);
  camera.rotation.set(player.pitch, player.yaw, 0);
}

function look(dx, dy, sens) {
  player.yaw -= dx * sens;
  player.pitch = THREE.MathUtils.clamp(player.pitch - dy * sens, -1.2, 1.35);
}

// ---------- HUD ----------
function showPopup(text, miss = false) {
  ui.popup.textContent = text;
  ui.popup.className = '';
  void ui.popup.offsetWidth; // restart the animation
  ui.popup.className = miss ? 'show miss' : 'show';
}

function updateHud() {
  ui.score.textContent = game.score;
  ui.streak.textContent = game.streak;
  const t = Math.max(0, Math.ceil(game.timeLeft));
  ui.time.textContent = t;
  ui.timerBox.classList.toggle('low', t <= 10 && game.mode === 'playing');
  const three = isThreePointer(player.x, player.z);
  ui.zone.textContent = three ? '3-point range' : '2-point range';
  ui.zone.classList.toggle('three', three);
  ui.powerFill.style.width = `${(input.charging ? currentPower() : 0) * 100}%`;
}

function updatePreview() {
  const show = input.charging && game.mode === 'playing';
  if (!show) { for (const d of previewDots) d.visible = false; return; }
  const { pos, vel } = launchParams(currentPower());
  previewDots.forEach((d, i) => {
    const t = 0.07 + i * 0.05;
    d.position.set(pos.x + vel.x * t, pos.y + vel.y * t - 0.5 * GRAVITY * t * t, pos.z + vel.z * t);
    d.visible = true;
  });
}

function updateHeldBall(dt) {
  heldBall.visible = input.cooldown <= 0 && (game.mode === 'playing' || game.mode === 'paused');
  const target = input.charging ? HELD_UP : HELD_REST;
  heldBall.position.lerp(target, 1 - Math.exp(-dt * 14));
  if (input.charging) heldBall.position.y += Math.sin(performance.now() / 28) * 0.0012 * currentPower() * 3;
}

// ---------- Game flow ----------
function showOverlay(msg, { results = false, button = 'PLAY' } = {}) {
  ui.msg.textContent = msg;
  ui.results.hidden = !results;
  ui.playBtn.textContent = button;
  ui.overlay.hidden = false;
}

function startRound() {
  Object.assign(game, { mode: 'playing', score: 0, streak: 0, makes: 0, attempts: 0, timeLeft: ROUND_TIME, endTimer: 0 });
  Object.assign(player, { x: 0, z: 4.6, yaw: 0, pitch: 0.2 });
  for (const b of balls) scene.remove(b.mesh);
  balls.length = 0;
  input.charging = false;
  input.cooldown = 0;
  lastTick = -1;
  ui.overlay.hidden = true;
  ui.hud.hidden = false;
}

function finishRound() {
  game.mode = 'over';
  const newBest = game.score > game.best;
  if (newBest) {
    game.best = game.score;
    try { localStorage.setItem(BEST_KEY, String(game.best)); } catch { /* storage unavailable */ }
  }
  document.getElementById('finalScore').textContent = game.score;
  document.getElementById('finalMakes').textContent = `${game.makes}/${game.attempts}`;
  document.getElementById('finalBest').textContent = game.best;
  if (document.pointerLockElement) document.exitPointerLock();
  showOverlay(newBest && game.score > 0 ? 'New personal best!' : 'Time! Final buzzer.', { results: true, button: 'PLAY AGAIN' });
}

function onPlayClicked() {
  initAudio();
  if (game.mode === 'paused') {
    game.mode = 'playing';
    ui.overlay.hidden = true;
  } else {
    startRound();
  }
  if (!isTouch) canvas.requestPointerLock?.();
}

function pause() {
  if (game.mode !== 'playing') return;
  game.mode = 'paused';
  input.charging = false;
  showOverlay('Paused', { button: 'RESUME' });
}

// ---------- Input wiring ----------
ui.playBtn.addEventListener('click', onPlayClicked);

document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement) pause();
});
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === canvas && game.mode !== 'paused') look(e.movementX, e.movementY, 0.0022);
});
canvas.addEventListener('mousedown', (e) => {
  if (isTouch || e.button !== 0) return;
  if (document.pointerLockElement !== canvas) { canvas.requestPointerLock?.(); return; }
  startCharge();
});
window.addEventListener('mouseup', (e) => { if (!isTouch && e.button === 0) releaseShot(); });

window.addEventListener('keydown', (e) => {
  input.keys.add(e.code);
  if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) startCharge(); }
});
window.addEventListener('keyup', (e) => {
  input.keys.delete(e.code);
  if (e.code === 'Space') releaseShot();
});
window.addEventListener('blur', () => input.keys.clear());
window.addEventListener('contextmenu', (e) => e.preventDefault());

// Touch: drag the screen to look, stick to move, button to shoot
if (isTouch) {
  let lookId = null, lx = 0, ly = 0;
  canvas.addEventListener('pointerdown', (e) => { if (lookId === null) { lookId = e.pointerId; lx = e.clientX; ly = e.clientY; } });
  window.addEventListener('pointermove', (e) => {
    if (e.pointerId !== lookId) return;
    look(e.clientX - lx, e.clientY - ly, 0.005);
    lx = e.clientX; ly = e.clientY;
  });
  const endLook = (e) => { if (e.pointerId === lookId) lookId = null; };
  window.addEventListener('pointerup', endLook);
  window.addEventListener('pointercancel', endLook);

  let stickId = null;
  const moveStick = (e) => {
    const r = ui.stick.getBoundingClientRect();
    let x = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
    let y = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    input.moveX = x; input.moveY = -y;
    ui.knob.style.transform = `translate(${x * 34}px, ${y * 34}px)`;
  };
  ui.stick.addEventListener('pointerdown', (e) => { stickId = e.pointerId; ui.stick.setPointerCapture(e.pointerId); moveStick(e); });
  ui.stick.addEventListener('pointermove', (e) => { if (e.pointerId === stickId) moveStick(e); });
  const endStick = (e) => {
    if (e.pointerId !== stickId) return;
    stickId = null; input.moveX = input.moveY = 0; ui.knob.style.transform = '';
  };
  ui.stick.addEventListener('pointerup', endStick);
  ui.stick.addEventListener('pointercancel', endStick);

  ui.shootBtn.addEventListener('pointerdown', (e) => { ui.shootBtn.setPointerCapture(e.pointerId); startCharge(); });
  ui.shootBtn.addEventListener('pointerup', releaseShot);
  ui.shootBtn.addEventListener('pointercancel', () => { input.charging = false; });
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---------- Main loop ----------
function update(dt) {
  if (game.mode === 'paused') return;

  if (game.mode === 'playing') {
    game.timeLeft -= dt;
    if (input.charging) input.chargeT += dt;
    input.cooldown = Math.max(0, input.cooldown - dt);
    const sec = Math.ceil(game.timeLeft);
    if (sec <= 5 && sec > 0 && sec !== lastTick) { lastTick = sec; sfx.tick(); }
    if (game.timeLeft <= 0) {
      // Buzzer: no new shots, but balls already in the air still count
      game.mode = 'ending';
      game.endTimer = 0;
      input.charging = false;
      sfx.buzzer();
    }
  } else if (game.mode === 'ending') {
    game.endTimer += dt;
    if (game.endTimer > 0.8 && (balls.every((b) => b.resolved) || game.endTimer > 5)) finishRound();
  }

  updatePlayer(dt);
  updateBalls(dt);
  updatePreview();
  updateHeldBall(dt);

  // Net reacts to a made basket
  if (netKick > 0) {
    netKick = Math.max(0, netKick - dt * 1.8);
    const w = Math.sin(netKick * 18) * netKick;
    net.scale.set(1 + w * 0.12, 1 + netKick * 0.25 + w * 0.1, 1 + w * 0.12);
  }
  updateHud();
}

let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 1 / 30);
  last = now;
  update(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// Menu backdrop: a view of the hoop from the free-throw line
updatePlayer(0);
showOverlay(game.best > 0 ? `Sink as many shots as you can in ${ROUND_TIME} seconds. Best: ${game.best}` : `Sink as many shots as you can in ${ROUND_TIME} seconds.`);
requestAnimationFrame(frame);

// Small debug handle for the console
window.__elite = { game, player, input, balls, startCharge, releaseShot };
