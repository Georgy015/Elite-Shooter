import * as THREE from 'three';
import { buildWorld, isThreePointer, BALL_R, BOARD, HOOP } from './scene.js';
import { createPlayer } from './player.js';
import { getLevel, spotPosition, LEVEL_COUNT } from './levels.js';
import { initAudio, sfx } from './audio.js';

// ---------- Tunables ----------
const GRAVITY = 9.81;
const LOFT = THREE.MathUtils.degToRad(45);   // launch angle = look pitch + loft
const MAX_LAUNCH = THREE.MathUtils.degToRad(80);
const MIN_SPEED = 3.5, MAX_SPEED = 11.5;     // launch speed at 0% / 100% power
const E_BOARD = 0.62, E_RIM = 0.5;           // bounciness of backboard and rim
const BALL_LIFE = 6;
const SUBSTEPS = 4;
const CAM_DIST = 4.4, CAM_PIVOT_Y = 2.8;     // camera orbits a point above the player's head
const VIEW_STRETCH = 1.35, AIM_SCREEN_Y = 0.36; // the aim point sits 36% down the screen, not dead centre
const PITCH_MIN = -0.15, PITCH_MAX = 0.8;
const SWISH_BONUS = 1, BANK_BONUS = 2;
const BANK_MIN_SPLIT = THREE.MathUtils.degToRad(4); // rim and glass must be at least this far apart to aim at separately
const CARRY_CAP = 0.5;                       // at most this share of the next target can be carried over
const ARENA = { minX: -14, maxX: 14, minZ: -8, maxZ: 20 };
const SAVE_KEY = 'elite-shooter-save', BEST_KEY = 'elite-shooter-best';

// A bank shot is aimed at a "virtual hoop" behind the glass: where the ball would end up
// if the backboard weren't there, allowing for the speed it loses in the bounce.
const BANK_TARGET = new THREE.Vector3(HOOP.x, HOOP.y, BALL_R - (HOOP.z - BALL_R) / E_BOARD);
const RIM_TARGET = new THREE.Vector3(HOOP.x, HOOP.y, HOOP.z);

// ---------- Setup ----------
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const { scene, net, makeBall } = buildWorld(renderer);
const camera = new THREE.PerspectiveCamera(62, 1, 0.05, 100);
camera.rotation.order = 'YXZ';
scene.add(camera);

const shooter = createPlayer(makeBall);
scene.add(shooter.group);

// Arc preview dots (only the first part of the flight)
const PREVIEW_N = 9;
const previewDots = [];
{
  const geo = new THREE.SphereGeometry(0.03, 8, 6);
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
const $ = (id) => document.getElementById(id);
const ui = {
  hud: $('hud'), overlay: $('overlay'), kicker: $('kicker'), title: $('title'), msg: $('overlayMsg'),
  results: $('results'), playBtn: $('playBtn'), resetBtn: $('resetBtn'), help: $('help'),
  level: $('level'), score: $('score'), target: $('target'), scoreBox: $('scoreBox'),
  time: $('time'), timerBox: $('timerBox'),
  popup: $('popup'), zone: $('zone'), powerFill: $('powerFill'), powerZone: $('powerZone'),
  touch: $('touch'), shootBtn: $('shootBtn'),
};
if (isTouch) {
  ui.touch.hidden = false;
  $('controlsDesktop').hidden = true;
  $('controlsTouch').hidden = false;
}

// ---------- State ----------
function loadSave() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (s && s.level >= 1 && s.level <= LEVEL_COUNT) return s;
  } catch { /* corrupt or unavailable storage */ }
  return { level: 1, carry: 0, total: 0 };
}
function store(key, value) {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
}

const save = loadSave();
const game = {
  mode: 'menu',            // menu | intro | playing | paused | ending | result | complete
  level: getLevel(save.level),
  score: 0, carryIn: 0, makes: 0, attempts: 0, streak: 0,
  timeLeft: 0, endTimer: 0, spotIdx: 0,
  best: Number(localStorage.getItem(BEST_KEY) || 0),
};
const player = { x: 0, z: 4.6, yaw: 0, pitch: 0.1, points: 2 };
const input = { charging: false, chargeT: 0 };
const balls = [];
let netKick = 0;
let lastTick = -1;

// ---------- Aiming ----------
const rel = new THREE.Vector3();
const releasePoint = () => shooter.releasePoint(player.x, player.z, player.yaw, rel);
const launchAngle = () => Math.min(player.pitch + LOFT, MAX_LAUNCH);
const yawTo = (fromX, fromZ, toX, toZ) => Math.atan2(-(toX - fromX), -(toZ - fromZ));
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

function currentPower() {
  // Ping-pong 0 → 1 → 0 so over-holding isn't a free max-power shot
  const k = (input.chargeT / game.level.chargeTime) % 2;
  return k <= 1 ? k : 2 - k;
}

// Launch speed that carries the ball from the release point to `target` at launch angle `theta`
function solveShot(target, theta) {
  const dx = target.x - rel.x, dz = target.z - rel.z;
  const d = Math.hypot(dx, dz);
  const denom = 2 * Math.cos(theta) ** 2 * (d * Math.tan(theta) - (target.y - rel.y));
  if (denom <= 0) return null;
  const speed = Math.sqrt((GRAVITY * d * d) / denom);
  const power = (speed - MIN_SPEED) / (MAX_SPEED - MIN_SPEED);
  if (power < 0.04 || power > 0.96) return null;
  return { speed, power, d, dirX: dx / d, dirZ: dz / d, yawErr: wrapAngle(player.yaw - yawTo(rel.x, rel.z, target.x, target.z)) };
}

// Would a shot at the bank target actually meet the glass?
function bankReachable(sol, theta) {
  const f = (rel.z - BALL_R) / (rel.z - BANK_TARGET.z);
  if (f <= 0 || f >= 1) return false;
  const t = (f * sol.d) / (sol.speed * Math.cos(theta));
  const x = rel.x + f * (BANK_TARGET.x - rel.x);
  const y = rel.y + sol.speed * Math.sin(theta) * t - 0.5 * GRAVITY * t * t;
  return Math.abs(x) < BOARD.w / 2 - 0.08 && y > BOARD.bottom + 0.12 && y < BOARD.bottom + BOARD.h - 0.05;
}

// What the player is currently lined up for: the rim, the glass, or nothing.
function aimInfo() {
  releasePoint();
  const theta = launchAngle();
  const tol = game.level.yawTolerance;
  const rim = solveShot(RIM_TARGET, theta);
  let bank = solveShot(BANK_TARGET, theta);
  if (bank && !bankReachable(bank, theta)) bank = null;
  // Head-on, the rim and the glass are the same direction: only offer the bank from an angle
  if (bank && rim && Math.abs(wrapAngle(bank.yawErr - rim.yawErr)) < BANK_MIN_SPLIT) bank = null;
  const rimOk = rim && Math.abs(rim.yawErr) < tol;
  const bankOk = bank && Math.abs(bank.yawErr) < tol;
  if (bankOk && (!rimOk || Math.abs(bank.yawErr) < Math.abs(rim.yawErr) - 0.01)) return { ...bank, kind: 'bank', theta };
  if (rimOk) return { ...rim, kind: 'rim', theta };
  return { kind: 'free', theta };
}

// ---------- Shooting ----------
function rawVelocity(power, theta) {
  const speed = MIN_SPEED + (MAX_SPEED - MIN_SPEED) * power;
  const ch = Math.cos(theta);
  return new THREE.Vector3(-Math.sin(player.yaw) * ch, Math.sin(theta), -Math.cos(player.yaw) * ch).multiplyScalar(speed);
}

function startCharge() {
  if (game.mode !== 'playing' || shooter.busy || input.charging) return;
  input.charging = true;
  input.chargeT = 0;
}

function releaseShot() {
  if (!input.charging) return;
  input.charging = false;
  if (game.mode !== 'playing' || shooter.busy) return;

  const power = currentPower();
  const aim = aimInfo();
  const zone = game.level.zone;
  let vel;
  if (aim.kind !== 'free' && Math.abs(power - aim.power) <= zone) {
    // Inside the green zone: the shot is on line, with a little error toward the zone's edges
    const e = (power - aim.power) / zone;
    const speed = aim.speed * (1 + 0.012 * e);
    const yawNudge = (aim.yawErr / game.level.yawTolerance) * 0.012;
    const c = Math.cos(yawNudge), s = Math.sin(yawNudge);
    const ch = Math.cos(aim.theta);
    vel = new THREE.Vector3((aim.dirX * c + aim.dirZ * s) * ch, Math.sin(aim.theta), (-aim.dirX * s + aim.dirZ * c) * ch).multiplyScalar(speed);
  } else {
    vel = rawVelocity(power, aim.theta);
  }

  const pos = rel.clone();
  const points = player.points;
  const spin = new THREE.Vector3(Math.cos(player.yaw), 0, -Math.sin(player.yaw)); // backspin axis
  game.attempts++;
  shooter.shoot(
    () => {
      const mesh = makeBall();
      mesh.position.copy(pos);
      scene.add(mesh);
      balls.push({ mesh, pos, vel, prevY: pos.y, points, spin, touchedRim: false, touchedBoard: false, scored: false, resolved: false, life: 0 });
      sfx.shoot();
    },
    () => { if (game.mode === 'playing' && game.level.spots.length > 1) nextSpot(); }
  );
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
  const swish = !b.touchedRim && !b.touchedBoard;
  const bank = b.touchedBoard;
  const pts = (b.points + (swish ? SWISH_BONUS : 0) + (bank ? BANK_BONUS : 0)) * game.level.multiplier;
  game.score += pts;
  game.makes++;
  game.streak++;
  netKick = 1;
  // The net slows the ball down
  b.vel.x *= 0.35; b.vel.z *= 0.35; b.vel.y *= 0.6;
  sfx.swish();
  if (!swish) sfx.score();
  const label = bank ? 'BANK SHOT!' : swish ? 'SWISH!' : b.points === 3 ? 'FROM DEEP!' : 'BUCKET!';
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
  let hit = collidePoint(b, closest, BALL_R, E_BOARD);
  if (hit > 0) { b.touchedBoard = true; if (hit > 0.5) sfx.board(Math.min(1, hit / 6)); }

  // Rim (sphere vs ring)
  const dx = b.pos.x - HOOP.x, dz = b.pos.z - HOOP.z;
  const hd = Math.hypot(dx, dz);
  if (hd > 1e-6) {
    closest.set(HOOP.x + (dx / hd) * HOOP.r, HOOP.y, HOOP.z + (dz / hd) * HOOP.r);
    hit = collidePoint(b, closest, BALL_R + HOOP.tube, E_RIM);
    if (hit > 0) { b.touchedRim = true; if (hit > 0.4) sfx.rim(Math.min(1, hit / 5)); }
  }

  // A ball that comes to rest wedged between rim and glass gets nudged off
  if ((b.touchedRim || b.touchedBoard) && b.pos.y > HOOP.y - 0.05 && b.vel.lengthSq() < 0.25) {
    b.vel.z += 3 * h;
    b.vel.x += (b.pos.x >= HOOP.x ? 1 : -1) * 1.5 * h;
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
      const k = 1 - (b.life - BALL_LIFE) / 0.3; // shrink away
      if (k <= 0) { scene.remove(b.mesh); balls.splice(i, 1); } else b.mesh.scale.setScalar(k);
    }
  }
}

function clearBalls() {
  for (const b of balls) scene.remove(b.mesh);
  balls.length = 0;
}

// ---------- Player and camera ----------
function setSpot(index) {
  game.spotIdx = index;
  const p = spotPosition(game.level.spots[index]);
  player.x = p.x;
  player.z = p.z;
  player.points = isThreePointer(p.x, p.z) ? 3 : 2;
  // Face the hoop (later levels start you slightly off-target) with the rim on the crosshair
  // The ball leaves from the shooting hand, not the body's centre, so line that up with the hoop
  player.yaw = yawTo(p.x, p.z, HOOP.x, HOOP.z);
  for (let i = 0; i < 3; i++) {
    releasePoint();
    player.yaw = yawTo(rel.x, rel.z, HOOP.x, HOOP.z);
  }
  const drift = game.level.aimDrift;
  if (drift) player.yaw += (Math.random() < 0.5 ? -1 : 1) * drift * (0.5 + 0.5 * Math.random());
  const d = Math.hypot(HOOP.x - p.x, HOOP.z - p.z);
  player.pitch = Math.atan2(HOOP.y + 0.25 - CAM_PIVOT_Y, d);
}

function nextSpot() {
  const n = game.level.spots.length;
  let i = (game.spotIdx + 1) % n;
  if (game.level.random) {
    do { i = Math.floor(Math.random() * n); } while (i === game.spotIdx);
  }
  setSpot(i);
}

const camTarget = new THREE.Vector3();
function updateCamera(dt) {
  const cp = Math.cos(player.pitch);
  camTarget.set(
    player.x + Math.sin(player.yaw) * cp * CAM_DIST,
    Math.max(0.35, CAM_PIVOT_Y - Math.sin(player.pitch) * CAM_DIST),
    player.z + Math.cos(player.yaw) * cp * CAM_DIST
  );
  // Glide when the player jumps to a new spot, otherwise track exactly
  if (dt > 0 && camera.position.distanceTo(camTarget) > 0.6) camera.position.lerp(camTarget, 1 - Math.exp(-dt * 9));
  else camera.position.copy(camTarget);
  camera.rotation.set(player.pitch, player.yaw, 0);
}

function look(dx, dy, sens) {
  if (game.mode !== 'playing') return;
  player.yaw -= dx * sens;
  player.pitch = THREE.MathUtils.clamp(player.pitch - dy * sens, PITCH_MIN, PITCH_MAX);
}

// ---------- HUD ----------
function showPopup(text, miss = false) {
  ui.popup.textContent = text;
  ui.popup.className = '';
  void ui.popup.offsetWidth; // restart the animation
  ui.popup.className = miss ? 'show miss' : 'show';
}

const ZONE_LABEL = { rim: 'Locked on the rim', bank: `Bank shot  +${BANK_BONUS}`, free: 'Free aim — line up the hoop' };

function updateHud() {
  const lv = game.level;
  ui.level.textContent = lv.bonus ? 'BONUS' : lv.n;
  ui.score.textContent = game.score;
  ui.target.textContent = lv.bonus ? '×2' : `/ ${lv.target}`;
  ui.scoreBox.classList.toggle('done', !lv.bonus && game.score >= lv.target);
  const t = Math.max(0, Math.ceil(game.timeLeft));
  ui.time.textContent = t;
  ui.timerBox.classList.toggle('low', t <= 5 && game.mode === 'playing');

  const aim = aimInfo();
  ui.zone.textContent = ZONE_LABEL[aim.kind];
  ui.zone.className = aim.kind;
  if (aim.kind === 'free') {
    ui.powerZone.hidden = true;
  } else {
    ui.powerZone.hidden = false;
    ui.powerZone.style.left = `${(aim.power - lv.zone) * 100}%`;
    ui.powerZone.style.width = `${lv.zone * 200}%`;
    ui.powerZone.classList.toggle('bank', aim.kind === 'bank');
  }
  ui.powerFill.style.width = `${(input.charging ? currentPower() : 0) * 100}%`;

  // Arc preview
  const show = input.charging && game.mode === 'playing';
  if (!show) { for (const d of previewDots) d.visible = false; return; }
  const vel = rawVelocity(currentPower(), aim.theta);
  previewDots.forEach((d, i) => {
    const tt = 0.06 + i * 0.05;
    d.position.set(rel.x + vel.x * tt, rel.y + vel.y * tt - 0.5 * GRAVITY * tt * tt, rel.z + vel.z * tt);
    d.visible = true;
  });
}

// ---------- Game flow ----------
function showOverlay({ kicker = '', title, msg = '', cells = null, button, menu = false }) {
  ui.kicker.textContent = kicker;
  ui.kicker.hidden = !kicker;
  ui.title.innerHTML = title;
  ui.msg.textContent = msg;
  ui.msg.hidden = !msg;
  ui.results.hidden = !cells;
  if (cells) ui.results.innerHTML = cells.map(([value, label]) => `<div><span>${value}</span><small>${label}</small></div>`).join('');
  ui.playBtn.textContent = button;
  ui.help.hidden = !menu;
  ui.resetBtn.hidden = !(menu && (save.level > 1 || save.total > 0));
  ui.overlay.hidden = false;
}

function showMenu() {
  game.mode = 'menu';
  ui.hud.hidden = true;
  showOverlay({
    title: 'ELITE <span>SHOOTER</span>',
    msg: `${LEVEL_COUNT} levels. Beat each target score before time runs out.` + (game.best ? ` Best run: ${game.best} points.` : ''),
    button: save.level > 1 ? `CONTINUE · LEVEL ${save.level}` : 'PLAY',
    menu: true,
  });
}

function showIntro(n) {
  game.mode = 'intro';
  game.level = getLevel(n);
  const lv = game.level;
  const cap = Math.floor(lv.target * CARRY_CAP);
  game.carryIn = lv.bonus ? 0 : Math.min(save.carry, cap);
  Object.assign(game, { score: game.carryIn, makes: 0, attempts: 0, streak: 0, timeLeft: lv.time });
  clearBalls();
  setSpot(0);
  updateCamera(0);
  ui.hud.hidden = false;
  showOverlay({
    kicker: lv.bonus ? `BONUS LEVEL · ${n} / ${LEVEL_COUNT}` : `LEVEL ${n} / ${LEVEL_COUNT}`,
    title: lv.name,
    msg: lv.bonus
      ? 'No target here. Every basket counts double, and what you score becomes your head start on the next level.'
      : lv.tip,
    cells: lv.bonus
      ? [[`${lv.time}s`, 'time'], ['×2', 'points']]
      : [[lv.target, 'target'], [`${lv.time}s`, 'time'], [`+${game.carryIn}`, 'head start']],
    button: 'START',
  });
}

function startLevel() {
  game.mode = 'playing';
  input.charging = false;
  lastTick = -1;
  ui.overlay.hidden = true;
}

function finishLevel() {
  const lv = game.level;
  const passed = lv.bonus || game.score >= lv.target;
  const earned = game.score - game.carryIn;
  if (document.pointerLockElement) document.exitPointerLock();

  if (!passed) {
    game.mode = 'result';
    showOverlay({
      kicker: 'TIME UP',
      title: 'So close',
      msg: `You needed ${lv.target - game.score} more. Shots made: ${game.makes}/${game.attempts}.`,
      cells: [[game.score, 'score'], [lv.target, 'target']],
      button: 'RETRY',
    });
    return;
  }

  const extra = game.score - lv.target;
  save.total += earned;
  if (save.total > game.best) { game.best = save.total; store(BEST_KEY, String(game.best)); }

  if (lv.n === LEVEL_COUNT) {
    game.mode = 'complete';
    const total = save.total;
    Object.assign(save, { level: 1, carry: 0, total: 0 });
    store(SAVE_KEY, JSON.stringify(save));
    showOverlay({
      kicker: 'ALL 30 LEVELS CLEARED',
      title: 'ELITE <span>SHOOTER</span>',
      msg: 'You beat the game.',
      cells: [[total, 'total points'], [game.best, 'best run']],
      button: 'PLAY AGAIN',
    });
    return;
  }

  const next = getLevel(lv.n + 1);
  const carried = next.bonus ? 0 : Math.min(extra, Math.floor(next.target * CARRY_CAP));
  Object.assign(save, { level: lv.n + 1, carry: extra });
  store(SAVE_KEY, JSON.stringify(save));
  game.mode = 'result';
  showOverlay({
    kicker: lv.bonus ? 'BONUS COMPLETE' : 'LEVEL COMPLETE',
    title: lv.name,
    msg: next.bonus ? 'Bonus level next.' : (extra > carried ? `Head starts are capped at half of the next target.` : ''),
    cells: lv.bonus
      ? [[game.score, 'bonus points'], [`+${carried}`, 'carried over']]
      : [[game.score, 'score'], [lv.target, 'target'], [`+${carried}`, 'carried over']],
    button: 'NEXT LEVEL',
  });
}

function onPlayClicked() {
  initAudio();
  switch (game.mode) {
    case 'menu': case 'result': case 'complete':
      showIntro(save.level);
      return;
    case 'intro':
      startLevel();
      break;
    case 'paused':
      game.mode = 'playing';
      ui.overlay.hidden = true;
      break;
    default:
      return;
  }
  if (!isTouch) canvas.requestPointerLock?.();
}

function pause() {
  if (game.mode !== 'playing') return;
  game.mode = 'paused';
  input.charging = false;
  showOverlay({ kicker: `LEVEL ${game.level.n}`, title: 'Paused', button: 'RESUME' });
}

// ---------- Input wiring ----------
ui.playBtn.addEventListener('click', onPlayClicked);
ui.resetBtn.addEventListener('click', () => {
  Object.assign(save, { level: 1, carry: 0, total: 0 });
  store(SAVE_KEY, JSON.stringify(save));
  showMenu();
});

let lockedAt = 0;
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement) lockedAt = performance.now(); else pause();
});
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas) return;
  // Browsers can report one huge jump right after the pointer locks; don't let it throw the aim off
  if (performance.now() - lockedAt < 120 || Math.abs(e.movementX) > 300 || Math.abs(e.movementY) > 300) return;
  look(e.movementX, e.movementY, 0.0016);
});
canvas.addEventListener('mousedown', (e) => {
  if (isTouch || e.button !== 0) return;
  if (document.pointerLockElement !== canvas) { canvas.requestPointerLock?.(); return; }
  startCharge();
});
window.addEventListener('mouseup', (e) => { if (!isTouch && e.button === 0) releaseShot(); });

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) startCharge(); }
});
window.addEventListener('keyup', (e) => { if (e.code === 'Space') releaseShot(); });
window.addEventListener('contextmenu', (e) => e.preventDefault());

// Touch: drag the screen to aim, hold the button to shoot
if (isTouch) {
  let lookId = null, lx = 0, ly = 0;
  canvas.addEventListener('pointerdown', (e) => { if (lookId === null) { lookId = e.pointerId; lx = e.clientX; ly = e.clientY; } });
  window.addEventListener('pointermove', (e) => {
    if (e.pointerId !== lookId) return;
    look(e.clientX - lx, e.clientY - ly, 0.0035);
    lx = e.clientX; ly = e.clientY;
  });
  const endLook = (e) => { if (e.pointerId === lookId) lookId = null; };
  window.addEventListener('pointerup', endLook);
  window.addEventListener('pointercancel', endLook);

  ui.shootBtn.addEventListener('pointerdown', (e) => { ui.shootBtn.setPointerCapture(e.pointerId); startCharge(); });
  ui.shootBtn.addEventListener('pointerup', releaseShot);
  ui.shootBtn.addEventListener('pointercancel', () => { input.charging = false; });
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  // Render the lower part of a taller frame, so the aim point sits above the middle of the
  // screen (matching the crosshair in CSS) and the whole player stays in view below it.
  const baseFov = w / h < 1 ? 80 : 62; // wider on tall (phone portrait) screens
  camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(VIEW_STRETCH * Math.tan(THREE.MathUtils.degToRad(baseFov / 2))));
  camera.setViewOffset(w, h * VIEW_STRETCH, 0, h * (VIEW_STRETCH / 2 - AIM_SCREEN_Y), w, h);
}
window.addEventListener('resize', resize);
resize();

// ---------- Main loop ----------
function update(dt) {
  if (game.mode === 'paused') return;

  if (game.mode === 'playing') {
    game.timeLeft -= dt;
    if (input.charging) input.chargeT += dt;
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
    if (game.endTimer > 0.8 && !shooter.busy && (balls.every((b) => b.resolved) || game.endTimer > 5)) finishLevel();
  }

  shooter.setTransform(player.x, player.z, player.yaw);
  shooter.update(dt, input.charging && game.mode === 'playing');
  updateCamera(dt);
  updateBalls(dt);

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

setSpot(0);
updateCamera(0);
showMenu();
requestAnimationFrame(frame);

// Small debug handle for the console
window.__elite = { game, save, player, input, balls, shooter, aimInfo, startCharge, releaseShot, showIntro, resetAim: () => setSpot(game.spotIdx) };
