// The shooter: a stylised, procedurally animated basketball player seen from behind.
// Arms are driven by two-bone IK toward hand targets, so poses are authored as
// "where is the ball / where are the hands" rather than as raw joint angles.
import * as THREE from 'three';
import { BALL_R } from './scene.js';

const SCALE = 1.06;
const L = { thigh: 0.46, shin: 0.46, foot: 0.07, upper: 0.31, fore: 0.27, palm: 0.05 };
const SHOULDER_Y = 0.5, SHOULDER_X = 0.2;
const DOWN = new THREE.Vector3(0, -1, 0);
const UP = new THREE.Vector3(0, 1, 0);
const FWD_Z = new THREE.Vector3(0, 0, 1);

// Shot timeline (seconds after the shot is triggered)
const TAKEOFF = 0.06;
const RELEASE = 0.24;
const JUMP_V = 2.8;
const GRAV = 9.81;
const LAND = TAKEOFF + (2 * JUMP_V) / GRAV;
const END = 1.0;
const AIR_CROUCH = 0.08;

const jumpY = (t) => {
  const a = t - TAKEOFF;
  return a <= 0 || t >= LAND ? 0 : JUMP_V * a - 0.5 * GRAV * a * a;
};

// Poses, in torso space: origin at the hips, +y up, -z is the direction the player faces.
const v = (x, y, z) => new THREE.Vector3(x, y, z);
const POSES = {
  // Ball held in both hands in front of the body
  idle: { lean: -0.05, ball: v(0.03, 0.22, -0.30), rH: v(0.16, 0.22, -0.27), lH: v(-0.10, 0.22, -0.27), rPole: v(0.6, -0.4, 0.7), lPole: v(-0.6, -0.4, 0.7), wrist: 0 },
  // Set point: ball above the forehead, shooting hand under it, elbow tucked in, guide hand on the side
  set: { lean: -0.1, ball: v(0.10, 0.96, -0.15), rH: v(0.12, 0.85, -0.08), lH: v(-0.025, 0.94, -0.11), rPole: v(0.2, -0.6, -1), lPole: v(-1, -0.5, -0.3), wrist: 0 },
  // Release: shooting arm fully extended up and slightly forward, guide hand has let go
  release: { lean: 0, ball: v(0.12, 1.2, -0.22), rH: v(0.12, 1.075, -0.175), lH: v(-0.06, 1.0, -0.14), rPole: v(0.2, -0.6, -1), lPole: v(-1, -0.5, -0.3), wrist: 0 },
  // Follow-through: arm stays up, wrist snapped down
  follow: { lean: 0, ball: v(0.12, 1.2, -0.22), rH: v(0.14, 1.09, -0.22), lH: v(-0.1, 0.95, -0.12), rPole: v(0.2, -0.6, -1), lPole: v(-1, -0.5, -0.3), wrist: 1.4 },
  land: { lean: -0.12, ball: v(0.03, 0.22, -0.30), rH: v(0.17, 0.9, -0.3), lH: v(-0.15, 0.6, -0.2), rPole: v(0.5, -0.5, 0.2), lPole: v(-0.7, -0.5, 0.3), wrist: 0.8 },
};
const SET_CROUCH = 0.55, IDLE_CROUCH = 0.16;

const smooth = (k) => { k = Math.min(1, Math.max(0, k)); return k * k * (3 - 2 * k); };

function mixPose(out, a, b, k) {
  out.lean = a.lean + (b.lean - a.lean) * k;
  out.wrist = a.wrist + (b.wrist - a.wrist) * k;
  for (const key of ['ball', 'rH', 'lH', 'rPole', 'lPole']) out[key].lerpVectors(a[key], b[key], k);
  return out;
}

function jerseyTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#f4f4f0';
  g.fillRect(0, 0, 512, 256);
  g.fillStyle = '#ff7a1a';
  for (const x of [128, 384]) g.fillRect(x - 14, 0, 28, 256);   // side panels
  g.fillRect(0, 0, 512, 12);
  g.fillRect(0, 244, 512, 12);
  g.fillStyle = '#14213d';
  g.textAlign = 'center';
  g.font = '900 34px "Segoe UI", Arial, sans-serif';
  g.fillText('ELITE', 256, 62);     // centre of the canvas wraps onto the player's back
  g.font = '900 140px "Segoe UI", Arial, sans-serif';
  g.fillText('7', 256, 200);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createPlayer(makeBall) {
  const mat = (color, roughness = 0.8) => new THREE.MeshStandardMaterial({ color, roughness });
  const skin = mat(0x8d5a3b, 0.7);
  const jersey = new THREE.MeshStandardMaterial({ map: jerseyTexture(), roughness: 0.85 });
  const shorts = mat(0xf4f4f0);
  const trim = mat(0xff7a1a);
  const sleeve = mat(0x15171c, 0.6);
  const shoe = mat(0x1b1d22, 0.5);
  const sock = mat(0xffffff);
  const hair = mat(0x18120e, 0.95);

  const add = (parent, geo, material, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };
  // A limb segment hanging down from its joint
  const limb = (parent, r, len, material) =>
    add(parent, new THREE.CapsuleGeometry(r, Math.max(0.01, len - 2 * r), 4, 12), material, 0, -len / 2, 0);

  const root = new THREE.Group();
  root.scale.setScalar(SCALE);
  const hips = new THREE.Group();
  root.add(hips);
  const torso = new THREE.Group();
  hips.add(torso);

  // Torso, neck, head
  const chest = add(torso, new THREE.CylinderGeometry(0.2, 0.155, 0.56, 20), jersey, 0, 0.27, 0);
  chest.scale.z = 0.62;
  chest.rotation.y = Math.PI; // puts the texture seam on the chest, artwork on the back
  add(torso, new THREE.CylinderGeometry(0.05, 0.055, 0.1, 12), skin, 0, 0.59, 0);
  const head = add(torso, new THREE.SphereGeometry(0.112, 20, 16), skin, 0, 0.73, 0);
  head.scale.set(0.92, 1.06, 1);
  const cap = add(torso, new THREE.SphereGeometry(0.116, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.46), hair, 0, 0.738, 0.006);
  cap.scale.set(0.93, 1.05, 1);
  for (const s of [-1, 1]) add(torso, new THREE.SphereGeometry(0.03, 8, 6), skin, s * 0.105, 0.725, 0); // ears

  // Shorts
  const waist = add(hips, new THREE.CylinderGeometry(0.16, 0.175, 0.2, 16), shorts, 0, -0.02, 0);
  waist.scale.z = 0.7;
  const band = add(hips, new THREE.CylinderGeometry(0.162, 0.162, 0.035, 16), trim, 0, 0.07, 0);
  band.scale.z = 0.7;

  // Legs: hip → knee → ankle, all bending in the forward/back plane
  const legs = [-1, 1].map((s) => {
    const hip = new THREE.Group();
    hip.position.set(s * 0.095, -0.06, 0);
    hips.add(hip);
    limb(hip, 0.068, L.thigh, skin);
    add(hip, new THREE.CapsuleGeometry(0.088, 0.16, 4, 12), shorts, 0, -0.13, 0);
    const knee = new THREE.Group();
    knee.position.y = -L.thigh;
    hip.add(knee);
    limb(knee, 0.052, L.shin, skin);
    add(knee, new THREE.CylinderGeometry(0.05, 0.046, 0.14, 12), sock, 0, -L.shin + 0.1, 0);
    const ankle = new THREE.Group();
    ankle.position.y = -L.shin;
    knee.add(ankle);
    add(ankle, new THREE.BoxGeometry(0.1, 0.085, 0.27), shoe, 0, -0.025, -0.05);
    add(ankle, new THREE.BoxGeometry(0.104, 0.025, 0.275), sock, 0, -0.06, -0.05);
    return { hip, knee, ankle };
  });

  // Arms: shoulder → elbow, hands are placed separately each frame
  const makeArm = (s, upperMat, foreMat) => {
    const origin = v(s * SHOULDER_X, SHOULDER_Y, 0);
    const shoulder = new THREE.Group();
    shoulder.position.copy(origin);
    torso.add(shoulder);
    add(shoulder, new THREE.SphereGeometry(0.062, 12, 10), upperMat === sleeve ? skin : upperMat);
    limb(shoulder, 0.046, L.upper, upperMat);
    const elbow = new THREE.Group();
    elbow.position.y = -L.upper;
    shoulder.add(elbow);
    limb(elbow, 0.04, L.fore, foreMat);
    const hand = add(torso, new THREE.SphereGeometry(1, 12, 10), skin);
    hand.scale.set(0.046, 0.062, 0.022);
    return { origin, shoulder, elbow, hand, palm: v(0, 0, 0), foreDir: v(0, -1, 0), foreEnd: v(0, 0, 0) };
  };
  const armR = makeArm(1, skin, sleeve);  // shooting arm wears a sleeve
  const armL = makeArm(-1, skin, skin);

  const heldBall = makeBall();
  torso.add(heldBall);

  // ---- IK ----
  const t = v(0, 0, 0), dir = v(0, 0, 0), perp = v(0, 0, 0), upper = v(0, 0, 0), fore = v(0, 0, 0), tmp = v(0, 0, 0);
  const q = new THREE.Quaternion();
  const REACH_FORE = L.fore + L.palm;
  function solveArm(arm, target, pole) {
    t.subVectors(target, arm.origin);
    let d = t.length();
    const maxD = L.upper + REACH_FORE - 0.004;
    if (d > maxD) { t.multiplyScalar(maxD / d); d = maxD; }
    dir.copy(t).divideScalar(d);
    const cosA = THREE.MathUtils.clamp((L.upper ** 2 + d * d - REACH_FORE ** 2) / (2 * L.upper * d), -1, 1);
    const a = Math.acos(cosA);
    perp.copy(pole).addScaledVector(dir, -pole.dot(dir)).normalize();
    upper.copy(dir).multiplyScalar(Math.cos(a)).addScaledVector(perp, Math.sin(a));
    fore.copy(t).addScaledVector(upper, -L.upper).normalize();
    arm.shoulder.quaternion.setFromUnitVectors(DOWN, upper);
    q.copy(arm.shoulder.quaternion).invert();
    arm.elbow.quaternion.setFromUnitVectors(DOWN, tmp.copy(fore).applyQuaternion(q));
    arm.palm.copy(arm.origin).add(t);
    arm.foreDir.copy(fore);
    arm.foreEnd.copy(arm.origin).addScaledVector(upper, L.upper).addScaledVector(fore, L.fore);
  }

  function placeHand(arm, holding, ballPos, wrist) {
    if (holding) {
      // Palm pressed flat against the ball
      arm.hand.position.copy(arm.palm);
      tmp.subVectors(ballPos, arm.palm).normalize();
      arm.hand.quaternion.setFromUnitVectors(FWD_Z, tmp);
    } else {
      // Hand continues from the forearm, bent forward/down by the wrist angle
      tmp.copy(arm.foreDir).applyAxisAngle(v(1, 0, 0), -wrist);
      arm.hand.position.copy(arm.foreEnd).addScaledVector(tmp, 0.06);
      arm.hand.quaternion.setFromUnitVectors(UP, tmp);
    }
  }

  // ---- Animation state ----
  const pose = { lean: 0, wrist: 0, ball: v(0, 0, 0), rH: v(0, 0, 0), lH: v(0, 0, 0), rPole: v(0, 0, 0), lPole: v(0, 0, 0) };
  const from = { lean: 0, wrist: 0, ball: v(0, 0, 0), rH: v(0, 0, 0), lH: v(0, 0, 0), rPole: v(0, 0, 0), lPole: v(0, 0, 0) };
  const state = { shooting: false, t: 0, setBlend: 0, released: false, onRelease: null, onDone: null, crouchFrom: IDLE_CROUCH };

  function applyPose(crouch, jump, toes, holding) {
    root.position.y = jump;
    hips.position.y = L.foot + (L.thigh + L.shin) * Math.cos(crouch);
    torso.rotation.x = pose.lean;
    for (const leg of legs) {
      leg.hip.rotation.x = crouch;
      leg.knee.rotation.x = -2 * crouch;
      leg.ankle.rotation.x = crouch - toes;
    }
    solveArm(armR, pose.rH, pose.rPole);
    solveArm(armL, pose.lH, pose.lPole);
    heldBall.visible = holding;
    heldBall.position.copy(pose.ball);
    placeHand(armR, holding, pose.ball, pose.wrist);
    placeHand(armL, holding, pose.ball, pose.wrist * 0.25);
  }

  const player = {
    group: root,
    get busy() { return state.shooting; },

    setTransform(x, z, yaw) {
      root.position.x = x;
      root.position.z = z;
      root.rotation.y = yaw;
    },

    // Where the ball leaves the hand for a shot taken from (x, z) facing `yaw`
    releasePoint(x, z, yaw, out) {
      const lx = POSES.release.ball.x * SCALE, lz = POSES.release.ball.z * SCALE;
      const y = (L.foot + (L.thigh + L.shin) * Math.cos(AIR_CROUCH) + POSES.release.ball.y) * SCALE + jumpY(RELEASE);
      return out.set(x + lx * Math.cos(yaw) + lz * Math.sin(yaw), y, z - lx * Math.sin(yaw) + lz * Math.cos(yaw));
    },

    shoot(onRelease, onDone) {
      if (state.shooting) return false;
      mixPose(from, POSES.idle, POSES.set, smooth(state.setBlend));
      state.crouchFrom = IDLE_CROUCH + (SET_CROUCH - IDLE_CROUCH) * smooth(state.setBlend);
      Object.assign(state, { shooting: true, t: 0, released: false, onRelease, onDone });
      return true;
    },

    update(dt, charging) {
      if (!state.shooting) {
        // Idle ↔ set: bring the ball up and sink into the legs while charging
        state.setBlend = THREE.MathUtils.clamp(state.setBlend + (charging ? dt / 0.26 : -dt / 0.2), 0, 1);
        const k = smooth(state.setBlend);
        mixPose(pose, POSES.idle, POSES.set, k);
        const breathe = Math.sin(performance.now() / 600) * 0.008 * (1 - k);
        pose.ball.y += breathe; pose.rH.y += breathe; pose.lH.y += breathe;
        applyPose(IDLE_CROUCH + (SET_CROUCH - IDLE_CROUCH) * k, 0, 0, true);
        return;
      }

      state.t += dt;
      const tt = state.t;
      if (tt < RELEASE) mixPose(pose, from, POSES.release, smooth(tt / RELEASE));
      else if (tt < RELEASE + 0.09) mixPose(pose, POSES.release, POSES.follow, smooth((tt - RELEASE) / 0.09));
      else if (tt < LAND - 0.02) mixPose(pose, POSES.follow, POSES.follow, 0);
      else if (tt < LAND + 0.16) mixPose(pose, POSES.follow, POSES.land, smooth((tt - LAND + 0.02) / 0.18));
      else mixPose(pose, POSES.land, POSES.idle, smooth((tt - LAND - 0.16) / (END - LAND - 0.16)));

      let crouch, toes = 0;
      if (tt < TAKEOFF) crouch = state.crouchFrom + (0.02 - state.crouchFrom) * (tt / TAKEOFF);
      else if (tt < LAND) { crouch = AIR_CROUCH; toes = 0.75 * smooth((tt - TAKEOFF) / 0.08) * smooth((LAND - tt) / 0.08); }
      else if (tt < LAND + 0.1) crouch = AIR_CROUCH + (0.42 - AIR_CROUCH) * smooth((tt - LAND) / 0.1);
      else crouch = 0.42 + (IDLE_CROUCH - 0.42) * smooth((tt - LAND - 0.1) / (END - LAND - 0.1));

      const holding = tt < RELEASE || tt > END - 0.12;
      applyPose(crouch, jumpY(tt), toes, holding);

      if (!state.released && tt >= RELEASE) { state.released = true; state.onRelease?.(); }
      if (tt >= END) {
        state.shooting = false;
        state.setBlend = 0;
        state.onDone?.();
      }
    },
  };

  mixPose(pose, POSES.idle, POSES.idle, 0);
  applyPose(IDLE_CROUCH, 0, 0, true);
  return player;
}
