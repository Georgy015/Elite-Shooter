// Level definitions. A spot is { d, a }: distance from the hoop in metres and the angle
// around it in degrees (0 = straight on, positive = the right side of the court as you face the hoop).
import { HOOP, isThreePointer } from './scene.js';

export const LEVEL_COUNT = 30;
const S = (d, a) => ({ d, a });
const ARC = [S(7.5, -45), S(7.5, 0), S(7.5, 45)];
const CORNERS = [S(7.0, -85), S(7.0, 85)];

const DEFS = [
  // --- Close range ---
  { name: 'Warm-up', spots: [S(2.2, 0)], tip: 'Hold to charge, release inside the green zone.' },
  { name: 'One step back', spots: [S(3.0, 0)] },
  { name: 'Off the glass', spots: [S(2.6, 45)], tip: 'From the side, aim at the backboard square: bank shots score +2.' },
  { name: 'Other side', spots: [S(2.6, -45)], tip: 'Bank it in off the glass for +2.' },
  { name: 'Close-range rush', spots: [S(2.4, -45), S(2.4, 0), S(2.4, 45)], bonus: true },
  // --- Mid range ---
  { name: 'Free throws', spots: [S(4.2, 0)] },
  { name: 'Elbows', spots: [S(4.0, 30), S(4.0, -30)], tip: 'You switch spots after every shot.' },
  { name: 'Bank angles', spots: [S(3.6, 55), S(3.6, -55)], tip: 'These angles are made for the glass.' },
  { name: 'Around the key', spots: [S(4.2, -40), S(4.8, 0), S(4.2, 40)] },
  { name: 'Mid-range rush', spots: [S(4.0, -30), S(4.2, 0), S(4.0, 30)], bonus: true },
  // --- Long twos ---
  { name: 'Long two', spots: [S(5.6, 0)] },
  { name: 'Wings', spots: [S(5.3, 45), S(5.3, -45)] },
  { name: 'Baseline', spots: [S(5.0, 75), S(5.0, -75)] },
  { name: 'Mix it up', spots: [S(5.8, -20), S(4.2, 0), S(5.8, 20), S(3.0, 50)] },
  { name: 'Long-two rush', spots: [S(5.5, -45), S(5.6, 0), S(5.5, 45)], bonus: true },
  // --- Three-pointers ---
  { name: 'Top of the arc', spots: [S(7.5, 0)], tip: 'Beyond the arc: every make is worth 3.' },
  { name: 'Three-point wings', spots: [S(7.5, 45), S(7.5, -45)] },
  { name: 'Corner threes', spots: CORNERS },
  { name: 'Around the arc', spots: [CORNERS[0], ...ARC, CORNERS[1]] },
  { name: 'Three-point contest', spots: [CORNERS[0], ...ARC, CORNERS[1]], bonus: true },
  // --- Deep and unpredictable ---
  { name: 'Deep range', spots: [S(8.4, 0)] },
  { name: 'Deep wings', spots: [S(8.2, 35), S(8.2, -35)] },
  { name: 'Anywhere', spots: [S(3.0, 40), S(7.5, -45), S(4.2, 0), S(7.0, 85), S(5.5, -60), S(8.2, 15)], random: true },
  { name: 'Arc shuffle', spots: [CORNERS[0], ...ARC, CORNERS[1], S(7.6, 22), S(7.6, -22)], random: true },
  { name: 'Deep rush', spots: [S(8.2, -30), S(8.4, 0), S(8.2, 30)], bonus: true },
  // --- Elite ---
  { name: 'Logo shots', spots: [S(9.4, 0)] },
  { name: 'Deep shuffle', spots: [S(8.6, -40), S(9.0, -15), S(9.0, 15), S(8.6, 40)], random: true },
  { name: 'No easy ones', spots: [CORNERS[0], S(8.8, 0), CORNERS[1], S(8.4, 40), S(8.4, -40)], random: true },
  { name: 'Full repertoire', spots: [S(2.6, 50), S(9.2, 0), S(5.0, -75), S(7.5, 45), S(4.2, 0), S(8.6, -35), S(7.0, 85)], random: true },
  { name: 'Elite Shooter', spots: [S(9.4, 0), S(8.8, 30), S(8.8, -30), CORNERS[0], CORNERS[1], S(7.6, 0)], random: true },
];

export function spotPosition(spot) {
  const a = (spot.a * Math.PI) / 180;
  return { x: HOOP.x + spot.d * Math.sin(a), z: HOOP.z + spot.d * Math.cos(a) };
}

const lerp = (a, b, k) => a + (b - a) * k;

// Everything the game needs to run level n (1-based), including difficulty tuning.
export function getLevel(n) {
  const def = DEFS[n - 1];
  const k = (n - 1) / (LEVEL_COUNT - 1); // 0 → 1 across the game
  const time = def.bonus ? 20 : 30;
  const avgBase = def.spots.reduce((sum, s) => {
    const p = spotPosition(s);
    return sum + (isThreePointer(p.x, p.z) ? 3 : 2);
  }, 0) / def.spots.length;
  const attempts = time / 2.6;                 // roughly how many shots fit in the time limit
  const makeRate = lerp(0.3, 0.55, k);         // share of them you need to hit
  return {
    n,
    name: def.name,
    tip: def.tip || '',
    bonus: !!def.bonus,
    spots: def.spots,
    random: !!def.random,
    time,
    target: def.bonus ? 0 : Math.round(attempts * makeRate * (avgBase + 0.4)),
    multiplier: def.bonus ? 2 : 1,
    zone: lerp(0.09, 0.035, k),                // half-width of the green zone on the power bar
    yawTolerance: lerp(6, 2, k) * Math.PI / 180, // how close your aim must be for the zone to appear
    aimDrift: lerp(0, 7, k) * Math.PI / 180,   // how far off-target you start at each new spot
    chargeTime: lerp(1.3, 0.95, k),            // seconds for the power bar to fill
  };
}
