import * as THREE from 'three';
import { HW } from './track.js';

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Real-elevation terrain: road-hugging near the carriageway, blending into SRTM heights further out.
// Returns groundY(x, z) used to seat buildings, trees and landmarks.
export function buildTerrain(scene, track, terr, T) {
  const { x0, z0, step, nx, nz, h } = terr;
  const cell = (i, j) => (i < 0 || j < 0 || i >= nx || j >= nz ? null : h[j * nx + i]);
  const dem = (x, z) => {
    const fx = (x - x0) / step, fz = (z - z0) / step;
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
    const a = cell(i, j), b = cell(i + 1, j), c = cell(i, j + 1), d = cell(i + 1, j + 1);
    if (a == null || b == null || c == null || d == null) {
      const v = [a, b, c, d].filter((q) => q != null);
      return v.length ? v.reduce((s, q) => s + q, 0) / v.length : null;
    }
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  };
  // Road samples on a coarse grid: terrain must stay under EVERY nearby stretch of road (hairpins stack legs within a
  // few metres of each other), rising at most CUT per metre away from the road edge — like a cutting in a hillside.
  const RC = 24, CUT = 2, CLEAR = HW + 18, MAXD = CLEAR + 24, roadCells = new Map(), rk = (i, j) => i * 100003 + j;
  for (let i = 0; i < track.n; i += 2) {
    const k = rk(Math.floor(track.px[i] / RC), Math.floor(track.pz[i] / RC));
    let a = roadCells.get(k); if (!a) roadCells.set(k, a = []); a.push(i);
  }
  const reach = Math.ceil(MAXD / RC), M2 = MAXD * MAXD;
  const carve = (x, z, h) => {
    const ci = Math.floor(x / RC), cj = Math.floor(z / RC);
    for (let a = -reach; a <= reach; a++) for (let b = -reach; b <= reach; b++) {
      const list = roadCells.get(rk(ci + a, cj + b)); if (!list) continue;
      for (const i of list) {
        const dx = x - track.px[i], dz = z - track.pz[i], d2 = dx * dx + dz * dz;
        if (d2 > M2) continue;
        const lim = track.py[i] - 0.4 + Math.max(0, Math.sqrt(d2) - CLEAR) * CUT;
        if (lim < h) h = lim;
      }
    }
    return h;
  };
  const near = {};
  const groundY = (x, z) => {
    const n = track.nearest(x, z, -1, near);
    const d = Math.hypot(x - n.x, z - n.z);
    const g = dem(x, z);
    const w = smooth(18, 110, d);
    return carve(x, z, (g == null ? n.y : n.y * (1 - w) + g * w) - (d < 16 ? 0.3 : 0));
  };

  const [flat, steep] = (T.terrainColors || ['#3b3a2c', '#5a4a36']).map((c) => new THREE.Color(c));
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const colorize = (geo) => {
    geo.computeVertexNormals();
    const nrm = geo.attributes.normal, n = nrm.count, col = new Float32Array(n * 3), c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const s = Math.min(1, (1 - nrm.getY(i)) * 3);
      c.copy(flat).lerp(steep, s).multiplyScalar(0.85 + ((i * 2654435761) % 1000) / 1000 * 0.3);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  };

  // Fine mesh (15 m) in 60 m blocks within ~420 m of the road.
  const FS = 15, BLK = 4, REACH = 420;
  const blocks = new Set();
  const bsz = FS * BLK, br = Math.ceil(REACH / bsz);
  for (let i = 0; i < track.n; i += 15) {
    const bx = Math.floor(track.px[i] / bsz), bz = Math.floor(track.pz[i] / bsz);
    for (let a = -br; a <= br; a++) for (let b = -br; b <= br; b++) if (a * a + b * b <= br * br) blocks.add(`${bx + a},${bz + b}`);
  }
  const vidx = new Map(), pos = [], idx = [];
  const vert = (i, j) => {
    const k = i * 100003 + j;
    let v = vidx.get(k);
    if (v === undefined) {
      const x = i * FS, z = j * FS;
      v = pos.length / 3; vidx.set(k, v);
      pos.push(x, groundY(x, z), z);
    }
    return v;
  };
  for (const key of blocks) {
    const [bx, bz] = key.split(',').map(Number);
    for (let a = 0; a < BLK; a++) for (let b = 0; b < BLK; b++) {
      const i = bx * BLK + a, j = bz * BLK + b;
      const v00 = vert(i, j), v10 = vert(i + 1, j), v01 = vert(i, j + 1), v11 = vert(i + 1, j + 1);
      idx.push(v00, v01, v10, v10, v01, v11);
    }
  }
  const fine = new THREE.BufferGeometry();
  fine.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  fine.setIndex(idx);
  colorize(fine);
  const fineMesh = new THREE.Mesh(fine, mat); fineMesh.name = 'terrain'; scene.add(fineMesh);

  // Coarse far terrain straight from the SRTM grid (slightly lowered so the fine mesh wins at the seam).
  const cpos = [], cidx = [], cv = new Map();
  const cvert = (i, j) => {
    const k = j * nx + i;
    let v = cv.get(k);
    if (v === undefined) { v = cpos.length / 3; cv.set(k, v); cpos.push(x0 + i * step, h[k] - 1.5, z0 + j * step); }
    return v;
  };
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    if ([cell(i, j), cell(i + 1, j), cell(i, j + 1), cell(i + 1, j + 1)].some((q) => q == null)) continue;
    const cx = x0 + (i + 0.5) * step, cz = z0 + (j + 0.5) * step;
    const bx = Math.floor(cx / bsz), bz = Math.floor(cz / bsz);
    if (blocks.has(`${bx},${bz}`) && blocks.has(`${bx - 1},${bz}`) && blocks.has(`${bx + 1},${bz}`)) continue;
    const a = cvert(i, j), b = cvert(i + 1, j), c = cvert(i, j + 1), d = cvert(i + 1, j + 1);
    cidx.push(a, c, b, b, c, d);
  }
  if (cidx.length) {
    const coarse = new THREE.BufferGeometry();
    coarse.setAttribute('position', new THREE.Float32BufferAttribute(cpos, 3));
    coarse.setIndex(cidx);
    colorize(coarse);
    const coarseMesh = new THREE.Mesh(coarse, mat); coarseMesh.name = 'terrain-far'; scene.add(coarseMesh);
  }
  return groundY;
}
