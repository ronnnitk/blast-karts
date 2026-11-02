import { mulberry32 } from './util.js';

const toCenter = (x, z) => Math.atan2(-x, -z); // heading (forward = sin h, cos h) that faces the origin

function ring(n, r, offset = 0) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = offset + (i / n) * Math.PI * 2;
    out.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return out;
}

/** Chaikin corner-cutting: turns a blocky polygon into a smooth custom outline */
function smooth(pts, iters = 2) {
  let p = pts;
  for (let it = 0; it < iters; it++) {
    const out = [];
    for (let i = 0; i < p.length; i++) {
      const [ax, az] = p[i], [bx, bz] = p[(i + 1) % p.length];
      out.push([ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25], [ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75]);
    }
    p = out;
  }
  return p;
}

/** polygon outline, world units, centred on the origin */
function poly(pts) {
  let ex = 0, ez = 0;
  for (const [x, z] of pts) { ex = Math.max(ex, Math.abs(x)); ez = Math.max(ez, Math.abs(z)); }
  return { type: 'poly', pts, hw: ex, hd: ez, r: Math.hypot(ex, ez) * 0.8 };
}

/** distance from the origin to the outline along angle a (outlines are star-shaped around the origin) */
function rayR(pts, a) {
  const dx = Math.cos(a), dz = Math.sin(a);
  let best = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % pts.length];
    const ex = bx - ax, ez = bz - az, den = dx * ez - dz * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = (ax * ez - az * ex) / den, u = (ax * dz - az * dx) / den;
    if (t > 0 && u >= 0 && u <= 1) best = Math.min(best, t);
  }
  return best;
}

/** n points inside the outline at fraction f of the way to the wall */
const along = (pts, n, f, off = 0) => Array.from({ length: n }, (_, i) => {
  const a = off + (i / n) * Math.PI * 2, r = rayR(pts, a) * f;
  return [Math.cos(a) * r, Math.sin(a) * r];
});
const withHeading = (pts) => pts.map(([x, z]) => [x, z, toCenter(x, z)]);

/* ---------------------------------------------------------------- Skibidi Arena */
function skibidiArena() {
  // fat plus-shaped arena with smoothed corners
  const A = 92, B = 66, W = 34;
  const pts = smooth([
    [W, -B], [W, -W], [A, -W], [A, W], [W, W], [W, B], [-W, B], [-W, W], [-A, W], [-A, -W], [-W, -W], [-W, -B],
  ], 2);
  const boxes = [];
  for (const sx of [-1, 1]) boxes.push({ x: sx * 62, z: 0, w: 3, d: 14 });
  for (const sz of [-1, 1]) boxes.push({ x: 0, z: sz * 44, w: 14, d: 3 });
  const pillars = [{ x: 0, z: 0, r: 4 }];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    pillars.push({ x: sx * 18, z: sz * 18, r: 1.8 });
    pillars.push({ x: sx * 78, z: sz * 14, r: 2 });
  }
  const items = [[-30, 0], [30, 0], [0, -30], [0, 30], [-76, 0], [76, 0], [0, -56], [0, 56]];
  const spawns = withHeading([[-84, -2], [84, 2], [-2, -60], [2, 60], [-70, -24], [70, 24], [-24, 56], [24, -56]]);
  return {
    id: 'arena', name: 'Skibidi Arena', emoji: '🚽', desc: 'Huge plus-shaped arena. Wide open arms, a pillar-ringed core, loud everything.',
    bounds: poly(pts), boxes, pillars, items, spawns, boosts: [], slime: [],
    theme: {
      skyTop: 0x3a95ff, skyBottom: 0xd6f1ff, fog: 0xcdeeff, groundA: 0xb9bfca, groundB: 0xaab1bd, outside: 0x32b4ff,
      wall: [0x3a6dff, 0x2fd35a, 0xb236ff], accent: 0xff4040, sun: 0xffffff,
    },
    props: ['☁️', '🚽', '☁️', '🎈', '☁️', '🦈'],
  };
}

/* ---------------------------------------------------------------- Sigma Maze */
function sigmaMaze() {
  const N = 8, C = 16, half = (N * C) / 2, T = 2;
  const rnd = mulberry32(1337);
  // recursive backtracker over cells, then knock out extra walls so the maze is open and loopy
  const vOpen = Array.from({ length: N + 1 }, () => Array(N).fill(false)); // wall between (i-1,j) and (i,j)
  const hOpen = Array.from({ length: N }, () => Array(N + 1).fill(false)); // wall between (i,j-1) and (i,j)
  const seen = Array.from({ length: N }, () => Array(N).fill(false));
  const stack = [[0, 0]];
  seen[0][0] = true;
  while (stack.length) {
    const [i, j] = stack[stack.length - 1];
    const nb = [];
    if (i > 0 && !seen[i - 1][j]) nb.push([i - 1, j, 'v', i]);
    if (i < N - 1 && !seen[i + 1][j]) nb.push([i + 1, j, 'v', i + 1]);
    if (j > 0 && !seen[i][j - 1]) nb.push([i, j - 1, 'h', j]);
    if (j < N - 1 && !seen[i][j + 1]) nb.push([i, j + 1, 'h', j + 1]);
    if (!nb.length) { stack.pop(); continue; }
    const [ni, nj, kind, idx] = nb[Math.floor(rnd() * nb.length)];
    if (kind === 'v') vOpen[idx][j] = true; else hOpen[i][idx] = true;
    seen[ni][nj] = true;
    stack.push([ni, nj]);
  }
  for (let i = 1; i < N; i++) for (let j = 0; j < N; j++) if (rnd() < 0.3) vOpen[i][j] = true;
  for (let i = 0; i < N; i++) for (let j = 1; j < N; j++) if (rnd() < 0.3) hOpen[i][j] = true;

  // chamfered octagon outline: the four corner regions are cut away
  const k = 3 * C;
  const pts = [[-half + k, -half], [half - k, -half], [half, -half + k], [half, half - k], [half - k, half], [-half + k, half], [-half, half - k], [-half, -half + k]];
  const inside = (x, z) => Math.abs(x) + Math.abs(z) < half * 2 - k - 4 && Math.abs(x) < half && Math.abs(z) < half;
  const boxes = [];
  for (let i = 1; i < N; i++) for (let j = 0; j < N; j++) {
    if (vOpen[i][j]) continue;
    const x = -half + i * C, z = -half + j * C + C / 2;
    if (inside(x, z)) boxes.push({ x, z, w: T, d: C + T, h: 3.6 });
  }
  for (let i = 0; i < N; i++) for (let j = 1; j < N; j++) {
    if (hOpen[i][j]) continue;
    const x = -half + i * C + C / 2, z = -half + j * C;
    if (inside(x, z)) boxes.push({ x, z, w: C + T, d: T, h: 3.6 });
  }
  const cell = (i, j) => [-half + i * C + C / 2, -half + j * C + C / 2];
  const spawns = [[3, 0], [4, 0], [3, 7], [4, 7], [0, 3], [0, 4], [7, 3], [7, 4]].map(([i, j]) => {
    const [x, z] = cell(i, j);
    return [x, z, toCenter(x, z)];
  });
  const items = [[2, 2], [5, 5], [2, 5], [5, 2], [3, 3], [4, 4], [3, 4], [4, 3]].map(([i, j]) => cell(i, j));
  return {
    id: 'maze', name: 'Sigma Maze', emoji: '🗿', desc: 'Octagonal labyrinth with loops and short-cuts. Rockets bend around walls. Only sigmas survive.',
    bounds: poly(pts), boxes, pillars: [], items, spawns, boosts: [], slime: [],
    theme: {
      skyTop: 0x5a7dff, skyBottom: 0xe6ddff, fog: 0xdfe2ff, groundA: 0xd7dcf5, groundB: 0xc3caee, outside: 0x7fb0ff,
      wall: [0xff5ab0, 0xffcf2a, 0x2fd3b0], accent: 0xff5ab0, sun: 0xffffff,
    },
    props: ['☁️', '🗿', '☁️', '🎈', '☁️', '😎'],
  };
}

/* ---------------------------------------------------------------- Ohio Wasteland */
function ohioWasteland() {
  // lumpy irregular blob
  const raw = [];
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    const r = 84 * (1 + 0.16 * Math.sin(3 * a + 0.6) + 0.09 * Math.sin(5 * a + 1.9) + 0.05 * Math.sin(8 * a));
    raw.push([Math.cos(a) * r * 1.08, Math.sin(a) * r * 0.9]);
  }
  const pts = smooth(raw, 1);
  const rnd = mulberry32(4242);
  const items = [...along(pts, 6, 0.55, 0.3), ...along(pts, 2, 0.82, 1.2)];
  const spawns = withHeading(along(pts, 8, 0.82, 0.2));
  const slime = [{ x: 0, z: 0, r: 11 }, { x: -44, z: 28, r: 8 }, { x: 44, z: -28, r: 8 }];
  const keep = [...items.map(([x, z]) => ({ x, z, r: 8 })), ...spawns.map(([x, z]) => ({ x, z, r: 11 })),
    ...slime.map((s) => ({ x: s.x, z: s.z, r: s.r + 5 }))];
  const clear = (x, z, r) => keep.every((q) => (q.x - x) ** 2 + (q.z - z) ** 2 > (q.r + r) ** 2);
  const within = (x, z, r) => rayR(pts, Math.atan2(z, x)) > Math.hypot(x, z) + r + 6;
  const boxes = [], pillars = [];
  let tries = 0;
  while (boxes.length < 10 && tries++ < 800) {
    const w = 4 + rnd() * 6, d = 4 + rnd() * 6;
    const x = (rnd() * 2 - 1) * 90, z = (rnd() * 2 - 1) * 75;
    const r = Math.hypot(w, d) / 2 + 1;
    if (!within(x, z, r) || !clear(x, z, r)) continue;
    boxes.push({ x, z, w, d, h: 3 + rnd() * 2 });
    keep.push({ x, z, r: r + 4 });
  }
  tries = 0;
  while (pillars.length < 8 && tries++ < 800) {
    const x = (rnd() * 2 - 1) * 90, z = (rnd() * 2 - 1) * 75;
    if (!within(x, z, 3) || !clear(x, z, 3)) continue;
    pillars.push({ x, z, r: 1.4 });
    keep.push({ x, z, r: 4 });
  }
  return {
    id: 'ohio', name: 'Ohio Wasteland', emoji: '☢️', desc: 'Lumpy crater with sparse crates and toxic slime pools. Anything can happen in Ohio.',
    bounds: poly(pts), boxes, pillars, items, spawns, boosts: [], slime,
    theme: {
      skyTop: 0x48a8ff, skyBottom: 0xfff0c8, fog: 0xffeccc, groundA: 0xe3c98e, groundB: 0xd6b878, outside: 0x3fbcff,
      wall: [0x2fd35a, 0xff8a1a, 0xffd23a], accent: 0x6bff3a, sun: 0xffffff,
    },
    props: ['☁️', '🐊', '☁️', '🎈', '☁️', '🛸'],
  };
}

/* ---------------------------------------------------------------- Grimace Colosseum */
function grimaceColosseum() {
  // five-petal flower: a big open core with pockets to hide in
  const pts = [];
  for (let i = 0; i < 80; i++) {
    const a = (i / 80) * Math.PI * 2;
    const r = 82 * (1 + 0.2 * Math.cos(5 * a));
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  const pillars = [{ x: 0, z: 0, r: 8, h: 5 }];
  for (const [x, z] of ring(4, 34, Math.PI / 4)) pillars.push({ x, z, r: 2.6 });
  const boxes = ring(3, 58, Math.PI / 5).map(([x, z]) => ({ x, z, w: 3, d: 12, h: 3 }));
  const items = [...ring(4, 20, Math.PI / 4), ...ring(4, 62, 0)];
  const spawns = withHeading(along(pts, 8, 0.82, 0.1));
  return {
    id: 'colosseum', name: 'Grimace Colosseum', emoji: '🟣', desc: 'Giant five-petal arena with a huge core. Orbit it, hide in the petals, try not to get ratio\'d.',
    bounds: poly(pts), boxes, pillars, items, spawns, boosts: [], slime: [],
    theme: {
      skyTop: 0x6a8dff, skyBottom: 0xf0dcff, fog: 0xe8dcff, groundA: 0xd9c7f5, groundB: 0xc8b2ee, outside: 0x59a8ff,
      wall: [0xb236ff, 0xff4bb0, 0xffc83a], accent: 0xffc83a, sun: 0xffffff,
    },
    props: ['☁️', '🥤', '☁️', '🎈', '☁️', '🦄'],
  };
}

export const MAPS = [skibidiArena(), sigmaMaze(), ohioWasteland(), grimaceColosseum()];
export const getMap = (id) => MAPS.find((m) => m.id === id) || MAPS[0];
