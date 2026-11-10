// World construction: gym, court, hoop, ball visuals. All units are metres.
import * as THREE from 'three';

export const BALL_R = 0.12;
export const COURT = { minX: -7.5, maxX: 7.5, minZ: -1.2, maxZ: 12.8 };
// Backboard front face sits on z = 0 and faces +z (toward the player).
export const BOARD = { w: 1.83, h: 1.07, t: 0.04, bottom: 2.9 };
export const HOOP = { x: 0, y: 3.05, z: 0.38, r: 0.2286, tube: 0.017 };
export const THREE_PT = { r: 7.24, cornerX: 6.7 };
THREE_PT.cornerZ = HOOP.z + Math.sqrt(THREE_PT.r ** 2 - THREE_PT.cornerX ** 2);

export function isThreePointer(x, z) {
  if (Math.abs(x) > THREE_PT.cornerX && z < THREE_PT.cornerZ) return true;
  return Math.hypot(x - HOOP.x, z - HOOP.z) > THREE_PT.r;
}

function courtTexture(renderer) {
  const S = 128; // pixels per metre
  const W = (COURT.maxX - COURT.minX) * S;
  const H = (COURT.maxZ - COURT.minZ) * S;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const X = (x) => (x - COURT.minX) * S;
  const Z = (z) => (z - COURT.minZ) * S;

  // Hardwood planks
  g.fillStyle = '#c98f4e';
  g.fillRect(0, 0, W, H);
  const plankW = 0.09 * S;
  for (let x = 0, i = 0; x < W; x += plankW, i++) {
    let y = -((i * 97) % 160);
    while (y < H) {
      const len = 150 + ((i * 53 + y * 7) % 130);
      const tint = ((i * 31 + Math.floor(y) * 17) % 23) - 11;
      g.fillStyle = `rgb(${201 + tint}, ${143 + tint * 0.8}, ${78 + tint * 0.6})`;
      g.fillRect(x, y, plankW - 1, len - 1);
      y += len;
    }
  }
  // Subtle grain
  g.globalAlpha = 0.05;
  g.fillStyle = '#3a2208';
  for (let i = 0; i < 5000; i++) g.fillRect(Math.random() * W, Math.random() * H, 1, 12 + Math.random() * 50);
  g.globalAlpha = 1;

  // Painted key
  g.fillStyle = 'rgba(190, 60, 20, 0.82)';
  g.fillRect(X(-2.45), Z(COURT.minZ), 4.9 * S, (4.6 - COURT.minZ) * S);

  // Lines
  g.strokeStyle = '#f7f3ea';
  g.lineWidth = 0.05 * S;
  g.lineCap = 'butt';
  const inset = g.lineWidth / 2;
  g.strokeRect(inset, inset, W - 2 * inset, H - 2 * inset);              // boundary + half-court line
  g.strokeRect(X(-2.45), Z(COURT.minZ) + inset, 4.9 * S, (4.6 - COURT.minZ) * S - inset); // key
  g.beginPath(); g.arc(X(0), Z(4.6), 1.8 * S, 0, Math.PI * 2); g.stroke();    // free-throw circle
  g.beginPath(); g.arc(X(HOOP.x), Z(HOOP.z), 1.25 * S, 0, Math.PI); g.stroke(); // restricted area
  // Three-point line
  const a = Math.acos(THREE_PT.cornerX / THREE_PT.r);
  g.beginPath();
  g.moveTo(X(THREE_PT.cornerX), Z(COURT.minZ));
  g.lineTo(X(THREE_PT.cornerX), Z(THREE_PT.cornerZ));
  g.arc(X(HOOP.x), Z(HOOP.z), THREE_PT.r * S, a, Math.PI - a);
  g.lineTo(X(-THREE_PT.cornerX), Z(COURT.minZ));
  g.stroke();
  // Centre circle (half of it is on this half-court)
  g.beginPath(); g.arc(X(0), Z(COURT.maxZ), 1.8 * S, Math.PI, Math.PI * 2); g.stroke();

  // Court wordmark
  g.save();
  g.translate(X(0), Z(9.9));
  g.font = `italic 900 ${1.0 * S}px "Segoe UI", Arial, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = 'rgba(40, 20, 5, 0.35)';
  g.fillText('ELITE SHOOTER', 0, 0);
  g.restore();

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}

function ballTexture() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#d9621a';
  g.fillRect(0, 0, 1024, 512);
  // Pebbled surface
  for (let i = 0; i < 16000; i++) {
    g.fillStyle = Math.random() < 0.5 ? 'rgba(90,30,0,0.16)' : 'rgba(255,170,90,0.12)';
    g.fillRect(Math.random() * 1024, Math.random() * 512, 2, 2);
  }
  g.strokeStyle = '#1a0f08';
  g.lineWidth = 9;
  g.beginPath(); g.moveTo(0, 256); g.lineTo(1024, 256); g.stroke();          // equator
  for (const x of [0, 512, 1024]) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 512); g.stroke(); }
  for (const cx of [256, 768]) {                                              // side seams
    for (const s of [-1, 1]) {
      g.beginPath();
      g.moveTo(cx + s * 150, 0);
      g.bezierCurveTo(cx + s * 40, 150, cx + s * 40, 362, cx + s * 150, 512);
      g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function boardTexture() {
  const c = document.createElement('canvas');
  c.width = 732; c.height = 428; // 400 px per metre
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(235, 242, 250, 0.9)';
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = '#f5f5f5';
  g.lineWidth = 20;
  g.strokeRect(10, 10, c.width - 20, c.height - 20);
  // Shooter's square: 0.59 x 0.45 m, bottom edge level with the rim
  g.strokeStyle = '#e8501a';
  g.lineWidth = 20;
  const sw = 0.59 * 400, sh = 0.45 * 400;
  const bottom = c.height - (HOOP.y - BOARD.bottom) * 400;
  g.strokeRect((c.width - sw) / 2, bottom - sh, sw, sh);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function buildNet() {
  const N = 12, rows = 4, depth = 0.42;
  const pts = [];
  const ring = (row) => {
    const k = row / rows;
    const r = HOOP.r * (1 - 0.42 * Math.sqrt(k));
    const y = -depth * k;
    const off = (row % 2) * (Math.PI / N);
    return Array.from({ length: N }, (_, i) => {
      const a = (i / N) * Math.PI * 2 + off;
      return new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
    });
  };
  let prev = ring(0);
  for (let row = 1; row <= rows; row++) {
    const cur = ring(row);
    // Odd rows are offset half a step, giving the diamond pattern.
    for (let i = 0; i < N; i++) {
      const other = row % 2 ? (i + N - 1) % N : (i + 1) % N;
      pts.push(prev[i], cur[i], prev[i], cur[other]);
    }
    prev = cur;
  }
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const net = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }));
  net.position.set(HOOP.x, HOOP.y - HOOP.tube, HOOP.z);
  return net;
}

export function buildWorld(renderer) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d1119);
  scene.fog = new THREE.Fog(0x0d1119, 26, 60);

  // Lighting
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x4a3520, 1.1));
  const sun = new THREE.DirectionalLight(0xfff2dd, 2.2);
  sun.position.set(5, 16, 9);
  sun.target.position.set(0, 0, 5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -11, right: 11, top: 11, bottom: -11, near: 1, far: 40 });
  sun.shadow.bias = -0.0004;
  scene.add(sun, sun.target);

  // Court floor
  const cw = COURT.maxX - COURT.minX, cd = COURT.maxZ - COURT.minZ;
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(cw, cd),
    new THREE.MeshStandardMaterial({ map: courtTexture(renderer), roughness: 0.42, metalness: 0.0 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, (COURT.minZ + COURT.maxZ) / 2);
  floor.receiveShadow = true;
  scene.add(floor);

  // Surrounding floor
  const apron = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 60),
    new THREE.MeshStandardMaterial({ color: 0x1b2330, roughness: 0.9 })
  );
  apron.rotation.x = -Math.PI / 2;
  apron.position.set(0, -0.01, 6);
  apron.receiveShadow = true;
  scene.add(apron);

  // Gym shell
  const shell = new THREE.Mesh(
    new THREE.BoxGeometry(30, 14, 30),
    new THREE.MeshStandardMaterial({ color: 0x232c3c, roughness: 1, side: THREE.BackSide })
  );
  shell.position.set(0, 6.99, 6);
  scene.add(shell);
  // Wall stripe + ceiling light panels
  const stripe = new THREE.Mesh(
    new THREE.BoxGeometry(29.9, 0.5, 29.9),
    // Only the four side faces are drawn (order: +x, -x, +y, -y, +z, -z)
    [0, 1, 2, 3, 4, 5].map((i) => new THREE.MeshBasicMaterial({ color: 0xff7a1a, side: THREE.BackSide, visible: i !== 2 && i !== 3 }))
  );
  stripe.position.set(0, 3.2, 6);
  scene.add(stripe);
  const panelMat = new THREE.MeshBasicMaterial({ color: 0xfff6e0 });
  for (const x of [-6, 0, 6]) for (const z of [0, 6, 12]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.9), panelMat);
    p.rotation.x = Math.PI / 2;
    p.position.set(x, 13.9, z);
    scene.add(p);
  }

  // Hoop assembly
  const hoop = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0x2a2f3a, roughness: 0.5, metalness: 0.6 });
  const tex = boardTexture();
  const glass = new THREE.MeshStandardMaterial({ map: tex, transparent: true, opacity: 0.92, roughness: 0.15 });
  const board = new THREE.Mesh(new THREE.BoxGeometry(BOARD.w, BOARD.h, BOARD.t), glass);
  board.position.set(0, BOARD.bottom + BOARD.h / 2, -BOARD.t / 2);
  board.castShadow = true;
  hoop.add(board);

  const rimMat = new THREE.MeshStandardMaterial({ color: 0xff5a14, roughness: 0.35, metalness: 0.5 });
  const rim = new THREE.Mesh(new THREE.TorusGeometry(HOOP.r, HOOP.tube, 12, 48), rimMat);
  rim.rotation.x = Math.PI / 2;
  rim.position.set(HOOP.x, HOOP.y, HOOP.z);
  rim.castShadow = true;
  hoop.add(rim);
  const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.03, HOOP.z - HOOP.r), rimMat);
  bracket.position.set(0, HOOP.y - 0.01, (HOOP.z - HOOP.r) / 2);
  hoop.add(bracket);

  const net = buildNet();
  hoop.add(net);

  // Support: post behind the baseline with an arm reaching to the board
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, 3.4, 0.22), steel);
  post.position.set(0, 1.7, COURT.minZ - 0.9);
  post.castShadow = true;
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 2.2), steel);
  arm.position.set(0, 3.3, COURT.minZ - 0.9 + 1.0);
  arm.castShadow = true;
  const pad = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.9, 0.4), new THREE.MeshStandardMaterial({ color: 0x1d4ed8, roughness: 0.8 }));
  pad.position.set(0, 0.95, COURT.minZ - 0.9);
  hoop.add(post, arm, pad);
  scene.add(hoop);

  // Ball factory
  const ballGeo = new THREE.SphereGeometry(BALL_R, 32, 20);
  const ballMat = new THREE.MeshStandardMaterial({ map: ballTexture(), roughness: 0.75 });
  const makeBall = () => {
    const m = new THREE.Mesh(ballGeo, ballMat);
    m.castShadow = true;
    return m;
  };

  return { scene, net, makeBall };
}
