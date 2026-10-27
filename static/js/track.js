import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { waterSideAt, inRanges } from './themes.js';
import { buildTerrain } from './terrain.js';

export let HW = 9;            // road half width (4 lanes; ghat roads are narrower)
export function setRoadWidth(hw) { HW = hw; }
const SIDEWALK = 5;
const WALL = 0.5;

const CONTROL = [
  [0, -50], [0, 250], [20, 420], [120, 520], [300, 560], [480, 520], [560, 420], [560, 300],
  [520, 200], [600, 120], [600, 20], [520, -60], [500, -160], [620, -260], [800, -280],
  [930, -200], [960, -40], [1040, 40], [1120, -20], [1110, -200], [1020, -380], [820, -520],
  [520, -600], [220, -600], [60, -540], [0, -400], [0, -250],
];

// Seeded RNG so every LAN client builds the identical city.
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Flat outline of the built-in street circuit for map previews: much cheaper than building a whole Track.
export function circuitOutline(n = 160) {
  const curve = new THREE.CatmullRomCurve3(CONTROL.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'centripetal');
  return curve.getSpacedPoints(n).map((p) => [p.x, p.z, 0]);
}

export class Track {
  // map: { points:[[x,z],...] } for an open real-world road; omitted for the closed Tokyo circuit.
  constructor(map = null) {
    let pts;
    if (map?.points) {
      this.closed = false;
      pts = resamplePolyline(map.points, 2);
    } else {
      this.closed = true;
      const curve = new THREE.CatmullRomCurve3(CONTROL.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'centripetal');
      const v = curve.getSpacedPoints(Math.round(curve.getLength() / 2));
      v.pop();
      pts = v.map((p) => [p.x, p.z, 0]);
    }
    const n = this.n = pts.length;
    this.px = new Float32Array(n); this.pz = new Float32Array(n); this.py = new Float32Array(n);
    this.tx = new Float32Array(n); this.tz = new Float32Array(n);
    this.cum = new Float32Array(n + 1);
    this.curv = new Float32Array(n);
    for (let i = 0; i < n; i++) { this.px[i] = pts[i][0]; this.pz[i] = pts[i][1]; this.py[i] = pts[i][2] || 0; }
    this.minY = Math.min(...this.py); this.maxY = Math.max(...this.py);
    const wrap = (i) => (this.closed ? (i + n) % n : Math.max(0, Math.min(n - 1, i)));
    for (let i = 0; i < n; i++) {
      const j = wrap(i + 1), a = wrap(i - 1);
      this.cum[i + 1] = this.cum[i] + (this.closed || i < n - 1 ? Math.hypot(this.px[j] - this.px[i], this.pz[j] - this.pz[i]) : 0);
      const dx = this.px[j] - this.px[a], dz = this.pz[j] - this.pz[a];
      const l = Math.hypot(dx, dz) || 1;
      this.tx[i] = dx / l; this.tz[i] = dz / l;
    }
    this.length = this.closed ? this.cum[n] : this.cum[n - 1];
    for (let i = 0; i < n; i++) {
      const a = wrap(i - 3), b = wrap(i + 3);
      this.curv[i] = (this.tx[a] * this.tz[b] - this.tz[a] * this.tx[b]) / 12;
    }
    // Spatial hash for global nearest-point queries (long roads, city generation).
    this.cell = 40;
    this.grid = new Map();
    for (let i = 0; i < n; i++) {
      const k = this.key(Math.floor(this.px[i] / this.cell), Math.floor(this.pz[i] / this.cell));
      let a = this.grid.get(k); if (!a) this.grid.set(k, (a = [])); a.push(i);
    }
    this._near = { i: 0, dist: 0, lateral: 0, tx: 0, tz: 1, x: 0, z: 0 };
    if (this.closed) {
      this.tunnel = [this.nearest(505, -600).dist, this.nearest(235, -600).dist];
      this.overpasses = [[0.17, 0.25, 10.5], [0.42, -0.2, 12], [0.63, 0.1, 11]].map(([f, skew, h]) => ({ dist: f * this.length, skew, h }));
      this.startDist = 0;
      this.finishDist = 0;
    } else {
      this.tunnel = [-1, -1];
      this.overpasses = (map.overpasses || []).map(([f, skew, h]) => ({ dist: f * this.length, skew, h }));
      this.startDist = 75;
      this.finishDist = this.length - 70;
    }
  }

  key(cx, cz) { return cx * 73856093 ^ cz * 19349663; }

  idxAt(dist) {
    dist = this.closed ? ((dist % this.length) + this.length) % this.length : Math.max(0, Math.min(this.length, dist));
    const last = this.closed ? this.n - 1 : this.n - 2;
    let i = Math.min(last, Math.floor((dist / this.length) * this.n));
    while (i < last && this.cum[i + 1] < dist) i++;
    while (i > 0 && this.cum[i] > dist) i--;
    return [i, dist];
  }

  // Point on track at distance + lateral offset (positive = left of travel direction).
  sample(dist, lateral = 0, out = {}) {
    const [i, d] = this.idxAt(dist);
    const j = this.closed ? (i + 1) % this.n : i + 1;
    const seg = this.cum[i + 1] - this.cum[i] || 1;
    const t = Math.max(0, Math.min(1, (d - this.cum[i]) / seg));
    const cx = this.px[i] + (this.px[j] - this.px[i]) * t;
    const cz = this.pz[i] + (this.pz[j] - this.pz[i]) * t;
    let tx = this.tx[i] + (this.tx[j] - this.tx[i]) * t, tz = this.tz[i] + (this.tz[j] - this.tz[i]) * t;
    const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    out.x = cx + tz * lateral; out.z = cz - tx * lateral;
    out.y = this.py[i] + (this.py[j] - this.py[i]) * t;
    out.grade = (this.py[j] - this.py[i]) / seg;
    out.tx = tx; out.tz = tz; out.yaw = Math.atan2(tx, tz); out.dist = d;
    return out;
  }

  heightAt(dist) { const [i, d] = this.idxAt(dist); const j = this.closed ? (i + 1) % this.n : i + 1; const t = (d - this.cum[i]) / ((this.cum[i + 1] - this.cum[i]) || 1); return this.py[i] + (this.py[j] - this.py[i]) * t; }

  globalNearestIndex(x, z) {
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    let best = -1, bd = Infinity;
    for (let r = 0; r < 60; r++) {
      for (let gx = cx - r; gx <= cx + r; gx++) for (let gz = cz - r; gz <= cz + r; gz++) {
        if (Math.max(Math.abs(gx - cx), Math.abs(gz - cz)) !== r) continue;
        const a = this.grid.get(this.key(gx, gz));
        if (!a) continue;
        for (const i of a) {
          const d = (this.px[i] - x) ** 2 + (this.pz[i] - z) ** 2;
          if (d < bd) { bd = d; best = i; }
        }
      }
      if (best >= 0 && Math.sqrt(bd) < (r - 0.5) * this.cell) break;
    }
    if (best < 0) {
      for (let i = 0; i < this.n; i++) {
        const d = (this.px[i] - x) ** 2 + (this.pz[i] - z) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
    }
    return best;
  }

  nearest(x, z, hint = -1, out = this._near) {
    const n = this.n;
    let best = 0, bd = Infinity;
    if (hint < 0) best = this.globalNearestIndex(x, z);
    else {
      for (let k = -40; k <= 40; k++) {
        let i = hint + k;
        if (this.closed) i = (i + n) % n; else if (i < 0 || i >= n) continue;
        const d = (this.px[i] - x) ** 2 + (this.pz[i] - z) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
    }
    const nxt = (i) => (this.closed ? (i + 1) % n : Math.min(n - 1, i + 1));
    const prv = (i) => (this.closed ? (i - 1 + n) % n : Math.max(0, i - 1));
    let a = this.closed || best < n - 1 ? best : n - 2, b = nxt(a);
    let sx = this.px[b] - this.px[a], sz = this.pz[b] - this.pz[a];
    let t = ((x - this.px[a]) * sx + (z - this.pz[a]) * sz) / (sx * sx + sz * sz || 1);
    if (t < 0 && (this.closed || a > 0)) {
      a = prv(a); b = nxt(a);
      sx = this.px[b] - this.px[a]; sz = this.pz[b] - this.pz[a];
      t = ((x - this.px[a]) * sx + (z - this.pz[a]) * sz) / (sx * sx + sz * sz || 1);
    }
    t = Math.max(0, Math.min(1, t));
    const cx = this.px[a] + sx * t, cz = this.pz[a] + sz * t;
    let tx = this.tx[a] + (this.tx[b] - this.tx[a]) * t, tz = this.tz[a] + (this.tz[b] - this.tz[a]) * t;
    const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    out.i = best;
    out.dist = this.cum[a] + (this.cum[a + 1] - this.cum[a]) * t;
    out.lateral = (x - cx) * tz - (z - cz) * tx;
    out.tx = tx; out.tz = tz; out.x = cx; out.z = cz;
    out.y = this.py[a] + (this.py[b] - this.py[a]) * t;
    out.grade = (this.py[b] - this.py[a]) / (Math.hypot(sx, sz) || 1);
    return out;
  }

  // Signed distance a-b along the road (shortest way round on a closed loop).
  delta(a, b) {
    if (!this.closed) return a - b;
    const L = this.length;
    let d = (a - b) % L;
    if (d > L / 2) d -= L;
    if (d < -L / 2) d += L;
    return d;
  }

  inTunnel(dist) { return dist > this.tunnel[0] && dist < this.tunnel[1]; }
}

function resamplePolyline(src, step) {
  const out = [[src[0][0], src[0][1], src[0][2] || 0]];
  let carry = 0;
  for (let i = 1; i < src.length; i++) {
    const a = src[i - 1], b = src[i];
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let t = step - carry;
    while (t <= seg) { const k = t / seg; out.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, (a[2] || 0) + ((b[2] || 0) - (a[2] || 0)) * k]); t += step; }
    carry = seg - (t - step);
  }
  const last = src[src.length - 1];
  if (Math.hypot(out[out.length - 1][0] - last[0], out[out.length - 1][1] - last[1]) > step * 0.3) out.push([last[0], last[1], last[2] || 0]);
  return out;
}

// ---------- texture helpers ----------
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function tex(c, { repeat = true, srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}
function noise(ctx, w, h, base, amp, r) {
  const img = ctx.getImageData(0, 0, w, h); const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * amp;
    d[i] = Math.max(0, Math.min(255, d[i] + n * base[0]));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n * base[1]));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n * base[2]));
  }
  ctx.putImageData(img, 0, 0);
}

function roadTextures(aniso, style = 'tokyo') {
  const r = rng(11);
  const india = style === 'india';
  const RW = HW * 2, four = HW >= 8;
  const W = 512, H = 1024, ppm = W / RW; // road width x 36m
  const [c, x] = canvas(W, H);
  x.fillStyle = india ? '#3a3835' : '#2a2b2e'; x.fillRect(0, 0, W, H);
  noise(x, W, H, [1, 1, 1], india ? 44 : 34, r);
  for (let i = 0; i < (india ? 140 : 70); i++) { // patches & oil stains
    x.fillStyle = `rgba(${r() < 0.5 ? '10,10,12' : '60,60,62'},${0.12 + r() * 0.18})`;
    const w = 20 + r() * 120, h = 20 + r() * 160;
    x.fillRect(r() * W, r() * H, w, h);
  }
  for (const lane of (four ? [1, 3, 5, 7] : [1, 3]).map((k) => k * RW / (four ? 8 : 4))) { // tire wear lines
    for (const off of [-0.8, 0.8]) {
      const g = x.createLinearGradient((lane + off - 0.4) * ppm, 0, (lane + off + 0.4) * ppm, 0);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, 'rgba(0,0,0,0.22)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g; x.fillRect((lane + off - 0.4) * ppm, 0, 0.8 * ppm, H);
    }
  }
  const paint = (px, py, w, h) => {
    x.fillStyle = '#d9d6c8'; x.fillRect(px, py, w, h);
    x.fillStyle = 'rgba(40,40,40,0.25)';
    for (let i = 0; i < w * h / 30; i++) x.fillRect(px + r() * w, py + r() * h, 2, 2);
  };
  if (india) {
    x.globalAlpha = 0.55;
    for (let y = 0; y < 36; y += 6) { paint(0.35 * ppm, y * ppm, 0.15 * ppm, 3 * ppm); paint((RW - 0.5) * ppm, y * ppm, 0.15 * ppm, 3 * ppm); }
    if (four) for (const lx of [RW / 4, RW * 3 / 4]) for (let y = 0; y < 36; y += 12) paint((lx - 0.06) * ppm, y * ppm, 0.12 * ppm, 4 * ppm);
    x.globalAlpha = 0.8;
    x.fillStyle = '#d9a316'; x.fillRect((HW - 0.28) * ppm, 0, 0.15 * ppm, H); x.fillRect((HW + 0.13) * ppm, 0, 0.15 * ppm, H);
    x.globalAlpha = 1;
    for (let i = 0; i < 26; i++) { // potholes / tar patches
      x.fillStyle = r() < 0.5 ? 'rgba(12,11,10,0.55)' : 'rgba(80,76,70,0.35)';
      x.beginPath(); x.ellipse(r() * W, r() * H, 6 + r() * 26, 5 + r() * 20, r() * 3, 0, 7); x.fill();
    }
  } else {
    paint(0.35 * ppm, 0, 0.2 * ppm, H); paint((RW - 0.55) * ppm, 0, 0.2 * ppm, H);
    for (const lx of [RW / 4, RW / 2, RW * 3 / 4]) for (let y = 0; y < 36; y += 12) paint((lx - 0.08) * ppm, y * ppm, 0.16 * ppm, 6 * ppm);
  }
  const map = tex(c, { aniso });

  const [rc, rx] = canvas(256, 512);
  rx.fillStyle = 'rgb(200,200,200)'; rx.fillRect(0, 0, 256, 512);
  noise(rx, 256, 512, [1, 1, 1], 40, r);
  for (let i = 0; i < 34; i++) { // puddles -> glossy
    const gx = r() * 256, gy = r() * 512, gr = 15 + r() * 50;
    const g = rx.createRadialGradient(gx, gy, 0, gx, gy, gr);
    g.addColorStop(0, 'rgba(25,25,25,0.95)'); g.addColorStop(1, 'rgba(25,25,25,0)');
    rx.fillStyle = g; rx.fillRect(gx - gr, gy - gr, gr * 2, gr * 2);
  }
  const rough = tex(rc, { srgb: false, aniso });
  return { map, rough };
}

function simpleTex(w, h, draw, opts) { const [c, x] = canvas(w, h); draw(x, w, h); return tex(c, opts); }

// ---------- geometry ----------
// Ribbon along the track. profile: [[offset, y], ...] measured outward on `side` (+1 left / -1 right).
function ribbon(track, profile, side, vLen, i0 = 0, i1 = track.closed ? track.n : track.n - 1) {
  const pos = [], uv = [], idx = [];
  const m = profile.length;
  const uAcc = [0];
  for (let k = 1; k < m; k++) uAcc.push(uAcc[k - 1] + Math.hypot(profile[k][0] - profile[k - 1][0], profile[k][1] - profile[k - 1][1]));
  const uTot = uAcc[m - 1] || 1;
  let rows = 0;
  for (let ii = i0; ii <= i1; ii++) {
    const i = ii % track.n;
    const cx = track.px[i], cz = track.pz[i], lx = track.tz[i], lz = -track.tx[i];
    const v = (ii >= track.n ? track.length + track.cum[i] : track.cum[i]) / vLen;
    for (let k = 0; k < m; k++) {
      const off = profile[k][0] * side;
      pos.push(cx + lx * off, profile[k][1] + track.py[i], cz + lz * off);
      uv.push(uAcc[k] / uTot, v);
    }
    rows++;
  }
  for (let r = 0; r < rows - 1; r++) for (let k = 0; k < m - 1; k++) {
    const a = r * m + k, b = a + 1, c = a + m, d = c + 1;
    if (side > 0) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function rangesWhere(track, pred, pad) {
  const out = []; let start = -1;
  const end = track.closed ? track.n : track.n - 1;
  for (let i = 0; i < track.n; i++) {
    if (pred(i)) { if (start < 0) start = i; } else if (start >= 0) { out.push([Math.max(0, start - pad), Math.min(end, i + pad)]); start = -1; }
  }
  if (start >= 0) out.push([Math.max(0, start - pad), end]);
  return out;
}

const BUILDING_VS = `
varying vec2 vUv; varying vec3 vCol;
#include <fog_pars_vertex>
void main(){ vUv = uv; vCol = color; vec4 mvPosition = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mvPosition;
#include <fog_vertex>
}`;
const BUILDING_FS = `
uniform sampler2D map; uniform float glow;
varying vec2 vUv; varying vec3 vCol;
#include <fog_pars_fragment>
void main(){ vec3 t = texture2D(map, vUv).rgb; float l = max(t.r, max(t.g, t.b));
  float e = smoothstep(0.18, 0.55, l);
  vec3 c = t * vCol * 0.55 + t * e * glow;
  gl_FragColor = vec4(c, 1.0);
#include <fog_fragment>
}`;

function facadeTexture(r, style = 'tokyo') {
  if (style === 'india') return indiaFacade(r);
  if (style === 'glass') return glassFacade(r);
  const S = 1024, cell = 64;
  const [c, x] = canvas(S, S);
  x.fillStyle = '#14171d'; x.fillRect(0, 0, S, S);
  noise(x, S, S, [1, 1, 1.2], 18, r);
  const warm = ['#ffd99a', '#ffe7c0', '#f6c27e'], cool = ['#d8ecff', '#b8dcff', '#eef5ff', '#c9f2ff', '#ffc4ea'];
  for (let row = 0; row < 16; row++) {
    const floorLit = r() < 0.18 ? 0.75 : r() < 0.2 ? 0.04 : 0.28;
    const floorCool = r() < 0.65;
    for (let col = 0; col < 16; col++) {
      const px = col * cell, py = row * cell;
      if (row === 0) continue; // dark band used for roofs
      const lit = r() < floorLit;
      const wx = px + 9, wy = py + 12, ww = cell - 18, wh = cell - 22;
      if (lit) {
        const pal = floorCool ? cool : warm;
        const g = x.createLinearGradient(0, wy, 0, wy + wh);
        const base = pal[Math.floor(r() * pal.length)];
        g.addColorStop(0, base); g.addColorStop(1, r() < 0.5 ? '#6b4a22' : base);
        x.fillStyle = g; x.fillRect(wx, wy, ww, wh);
        if (r() < 0.4) { x.fillStyle = 'rgba(20,15,10,0.6)'; x.fillRect(wx + r() * ww * 0.6, wy, ww * 0.35, wh); }
      } else {
        const g = x.createLinearGradient(0, wy, 0, wy + wh);
        g.addColorStop(0, '#1d2633'); g.addColorStop(1, '#0b0e14');
        x.fillStyle = g; x.fillRect(wx, wy, ww, wh);
      }
      x.fillStyle = '#0d0f13'; x.fillRect(px + cell / 2 - 1, wy, 2, wh);
    }
  }
  return tex(c, { aniso: 4 });
}

function signAtlas() {
  const W = 1024, H = 512;
  const [c, x] = canvas(W, H);
  x.fillStyle = '#000'; x.fillRect(0, 0, W, H);
  const signs = [['NITRO', '#ff2e88'], ['MOTEL', '#39e6ff'], ['24H GARAGE', '#ffb400'], ['NOODLES', '#ff4d4d'],
    ['HARBOR', '#7cff6b'], ['TURBO', '#b56bff'], ['PIT STOP', '#39e6ff'], ['HOTEL', '#ff2e88']];
  signs.forEach(([txt, col], k) => {
    const cx = (k % 2) * 512 + 256, cy = Math.floor(k / 2) * 128 + 64;
    x.save();
    x.font = 'italic 900 78px "Arial Black", Impact, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    let s = 1; const w = x.measureText(txt).width; if (w > 460) s = 460 / w;
    x.translate(cx, cy); x.scale(s, 1);
    x.shadowColor = col; x.shadowBlur = 26; x.fillStyle = col;
    x.fillText(txt, 0, 0); x.fillText(txt, 0, 0);
    x.shadowBlur = 4; x.fillStyle = '#fff'; x.globalAlpha = 0.85; x.fillText(txt, 0, 0);
    x.restore();
    x.strokeStyle = col; x.lineWidth = 5; x.shadowColor = col; x.shadowBlur = 14;
    x.strokeRect((k % 2) * 512 + 14, Math.floor(k / 2) * 128 + 10, 484, 108);
    x.shadowBlur = 0;
  });
  return tex(c, { repeat: false });
}

function indiaFacade(r) {
  const S = 1024, cell = 64;
  const [c, x] = canvas(S, S);
  x.fillStyle = '#4a463f'; x.fillRect(0, 0, S, S);
  noise(x, S, S, [1, 1, 1], 30, r);
  for (let i = 0; i < 40; i++) { x.fillStyle = `rgba(20,18,14,${0.15 + r() * 0.2})`; x.fillRect(r() * S, r() * S, 4 + r() * 10, 40 + r() * 120); }
  const lit = ['#eef6ff', '#e3f0ff', '#ffe0a8', '#ffd28a', '#bff0d0', '#ffffff'];
  for (let row = 0; row < 16; row++) {
    const py = row * cell;
    x.fillStyle = 'rgba(25,22,18,0.75)'; x.fillRect(0, py + cell - 9, S, 7); // slab / balcony band
    if (row === 0) continue;
    const floorLit = r() < 0.3 ? 0.55 : 0.18;
    for (let col = 0; col < 16; col++) {
      const px = col * cell;
      if (r() < 0.18) { x.fillStyle = '#8c8c86'; x.fillRect(px + 14, py + 30, 22, 14); continue; } // AC unit
      const wx = px + 16, wy = py + 14, ww = cell - 32, wh = cell - 30;
      x.fillStyle = r() < floorLit ? lit[Math.floor(r() * lit.length)] : '#1a1c20';
      x.fillRect(wx, wy, ww, wh);
      x.strokeStyle = 'rgba(30,30,30,0.85)'; x.lineWidth = 2;
      for (let g = 1; g < 4; g++) { x.beginPath(); x.moveTo(wx + (ww * g) / 4, wy); x.lineTo(wx + (ww * g) / 4, wy + wh); x.stroke(); }
    }
  }
  return tex(c, { aniso: 4 });
}

function glassFacade(r) {
  const S = 1024;
  const [c, x] = canvas(S, S);
  const g = x.createLinearGradient(0, 0, S, S); g.addColorStop(0, '#0d1b2c'); g.addColorStop(1, '#0a1220');
  x.fillStyle = g; x.fillRect(0, 0, S, S);
  for (let row = 1; row < 32; row++) {
    const on = r() < 0.45;
    for (let col = 0; col < 32; col++) {
      if (on && r() < 0.8) { x.fillStyle = r() < 0.7 ? '#cfe6ff' : '#9fd0ff'; x.fillRect(col * 32 + 2, row * 32 + 4, 28, 22); }
    }
    x.fillStyle = '#05080e'; x.fillRect(0, row * 32, S, 3);
  }
  for (let col = 0; col < 32; col++) { x.fillStyle = '#05080e'; x.fillRect(col * 32, 0, 2, S); }
  return tex(c, { aniso: 4 });
}

function boxFaces(b, pos, uv, col, r) {
  // b: {x,z,yaw,w,d,h,u0,v0,tint}
  const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
  const hw = b.w / 2, hd = b.d / 2;
  const corner = (lx, lz) => [b.x + lx * c + lz * s, b.z - lx * s + lz * c];
  const P = [corner(-hw, -hd), corner(hw, -hd), corner(hw, hd), corner(-hw, hd)];
  const y0 = (b.y0 || 0) - (b.y0 ? 5 : 0), y1 = (b.y0 || 0) + b.h;
  const faceLen = [b.w, b.d, b.w, b.d];
  const shade = [0.8, 1.0, 0.7, 0.9];
  for (let f = 0; f < 4; f++) {
    const [ax, az] = P[f], [bx, bz] = P[(f + 1) % 4];
    const u1 = b.u0 + faceLen[f] / 32, v1 = b.v0 + (y1 - y0) / 48;
    const quad = [[ax, y0, az, b.u0, b.v0, 1], [bx, y0, bz, u1, b.v0, 1], [bx, y1, bz, u1, v1, 0], [ax, y1, az, b.u0, v1, 0]];
    for (const tri of [0, 2, 1, 0, 3, 2]) {
      const q = quad[tri];
      pos.push(q[0], q[1], q[2]); uv.push(q[3], q[4]);
      const k = shade[f] * b.tint, tc = b.tc || [1, 1, 1];
      const warm = q[5] ? 1.35 : 0.9;
      col.push(k * tc[0] * warm * 1.05, k * tc[1] * (q[5] ? 1.12 : 0.92), k * tc[2] * (q[5] ? 0.95 : 1.05));
    }
  }
  const roof = [P[0], P[1], P[2], P[3]];
  for (const tri of [0, 2, 1, 0, 3, 2]) {
    pos.push(roof[tri][0], y1, roof[tri][1]); uv.push(0.5, 0.995); col.push(0.5, 0.5, 0.55);
  }
}

export function buildWorld(scene, track, renderer, T) {
  const aniso = renderer.capabilities.getMaxAnisotropy();
  const r = rng(1337);
  const world = { lamps: [], startLights: [], update: () => {} };
  const L = track.length;
  const [t0, t1] = track.tunnel;
  const hasTunnel = t0 >= 0;
  const tunnelIdx = hasTunnel ? [track.idxAt(t0)[0], track.idxAt(t1)[0]] : [-1, -1];
  const india = T.road === 'india';
  const frac = (d) => (track.closed ? d / L : (d - track.startDist) / (track.finishDist - track.startDist));
  const waterSide = (d) => {
    if (!T.water || !inRanges(frac(d), T.water.ranges)) return 0;
    return waterSideAt(track, d, T.water.dir);
  };
  world.waterSide = waterSide;
  world.frac = frac;
  const groundY = T.terrain ? buildTerrain(scene, track, T.terrain, T) : track.closed ? () => 0 : (x, z) => track.nearest(x, z).y;
  world.groundY = groundY;

  // Ground
  const groundTex = simpleTex(256, 256, (x, w, h) => {
    x.fillStyle = T.ground; x.fillRect(0, 0, w, h); noise(x, w, h, [1, 1, 1], 26, r);
    x.strokeStyle = 'rgba(0,0,0,0.5)'; x.lineWidth = 2; x.strokeRect(0, 0, w, h);
  }, { aniso });
  groundTex.repeat.set(4000, 4000);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000), new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.95, color: 0x8a8a8a }));
  ground.rotation.x = -Math.PI / 2; ground.position.set((track.px[0] + track.px[track.n - 1]) / 2, T.terrain ? track.minY - 12 : -0.02, (track.pz[0] + track.pz[track.n - 1]) / 2);
  scene.add(ground);

  // Road
  const rt = roadTextures(aniso, T.road);
  const roadMat = new THREE.MeshStandardMaterial({ map: rt.map, roughnessMap: rt.rough, roughness: india ? 0.75 : 0.62, metalness: 0.0, envMapIntensity: 1.6, color: 0xb8bcc8 });
  scene.add(new THREE.Mesh(ribbon(track, [[-HW, 0.02], [HW, 0.02]], 1, 36), roadMat));
  // Flyovers: a concrete underside along the whole road (buried under the ground where the road is at grade) and
  // pillars wherever the road runs more than 3 m above the ground.
  const deckMat = new THREE.MeshStandardMaterial({ color: 0x6d6a66, roughness: 0.9, side: THREE.DoubleSide });
  scene.add(new THREE.Mesh(ribbon(track, [[-(HW + WALL + 0.3), -0.8], [HW + WALL + 0.3, -0.8]], 1, 36), deckMat));
  const piers = [];
  for (let i = 0, next = 0; i < track.n; i++) {
    if (track.cum[i] < next) continue;
    const x = track.px[i], z = track.pz[i], top = track.py[i] - 0.8, g = groundY(x, z);
    if (top - g < 3) continue;
    next = track.cum[i] + 28;
    piers.push(new THREE.Matrix4().compose(new THREE.Vector3(x, (top + g) / 2 - 0.5, z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(track.tx[i], track.tz[i])), new THREE.Vector3(1, top - g + 1, 1)));
  }
  if (piers.length) {
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(HW * 1.1, 1, 1.8), deckMat, piers.length);
    piers.forEach((m, i) => im.setMatrixAt(i, m));
    im.computeBoundingSphere();
    scene.add(im);
  }

  // Curbs on corners (circuit only)
  if (!india) {
    const curbTex = simpleTex(64, 128, (x, w, h) => {
      for (let i = 0; i < 4; i++) { x.fillStyle = i % 2 ? '#e8e8e8' : '#c4161c'; x.fillRect(0, i * h / 4, w, h / 4); }
    }, { aniso });
    const curbGeos = [];
    for (const [a, b] of rangesWhere(track, i => Math.abs(track.curv[i]) > 1 / 110 && !(i > tunnelIdx[0] && i < tunnelIdx[1]), 6)) {
      for (const side of [1, -1]) curbGeos.push(ribbon(track, [[HW - 1.1, 0.035], [HW - 0.05, 0.05]], side, 4, a, b));
    }
    if (curbGeos.length) scene.add(new THREE.Mesh(mergeGeometries(curbGeos), new THREE.MeshStandardMaterial({ map: curbTex, roughness: 0.6 })));
  }

  // Start line + grid
  const checker = simpleTex(256, 32, (x, w, h) => {
    for (let i = 0; i < 32; i++) for (let j = 0; j < 4; j++) { x.fillStyle = (i + j) % 2 ? '#111' : '#eee'; x.fillRect(i * 8, j * 8, 8, 8); }
  }, { repeat: false, aniso });
  const lineAt = (d) => {
    const s0 = track.sample(d);
    const line = new THREE.Mesh(new THREE.PlaneGeometry(HW * 2, 1.6), new THREE.MeshStandardMaterial({ map: checker, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 }));
    line.rotation.x = -Math.PI / 2; line.rotation.z = s0.yaw; line.position.set(s0.x, s0.y + 0.03, s0.z);
    scene.add(line);
  };
  lineAt(track.startDist);
  if (!track.closed) lineAt(track.finishDist);
  const slotTex = simpleTex(64, 128, (x, w, h) => {
    x.strokeStyle = '#e8e8e0'; x.lineWidth = 7; x.beginPath(); x.moveTo(4, h - 30); x.lineTo(4, h - 4); x.lineTo(w - 4, h - 4); x.lineTo(w - 4, h - 30); x.stroke();
  }, { repeat: false });
  for (let k = 0; k < 8; k++) {
    const g = gridSlot(track, k);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 5.2), new THREE.MeshBasicMaterial({ map: slotTex, transparent: true, opacity: 0.85, depthWrite: false, color: 0x999999 }));
    m.rotation.x = -Math.PI / 2; m.rotation.z = g.yaw; m.position.set(g.x, g.y + 0.031, g.z);
    scene.add(m);
  }

  // Barriers + footpaths
  let wallProfile, wallTex, wallV;
  if (T.wall === 'kerb') {
    wallProfile = [[HW, 0], [HW, 0.42], [HW + 0.08, 0.5], [HW + 0.42, 0.5], [HW + WALL, 0.42], [HW + WALL, 0]];
    wallV = 2;
    wallTex = simpleTex(64, 128, (x, w, h) => {
      x.fillStyle = '#f2c200'; x.fillRect(0, 0, w, h / 2); x.fillStyle = '#121212'; x.fillRect(0, h / 2, w, h / 2);
      noise(x, w, h, [1, 1, 1], 40, r);
    }, { aniso });
  } else {
    wallProfile = [[HW, 0], [HW + 0.06, 0.32], [HW + 0.16, 0.95], [HW + 0.34, 0.95], [HW + 0.44, 0.32], [HW + WALL, 0]];
    wallV = 8;
    wallTex = simpleTex(128, 512, (x, w, h) => {
      x.fillStyle = '#8d8c87'; x.fillRect(0, 0, w, h); noise(x, w, h, [1, 1, 1], 40, r);
      const g = x.createLinearGradient(0, 0, w, 0); g.addColorStop(0, 'rgba(30,25,20,0.55)'); g.addColorStop(0.35, 'rgba(30,25,20,0)');
      x.fillStyle = g; x.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 128) { x.fillStyle = 'rgba(0,0,0,0.5)'; x.fillRect(0, y, w, 2); }
      for (let y = 0; y < h; y += 64) { x.fillStyle = (y / 64) % 2 ? '#d7a300' : '#151515'; x.fillRect(w * 0.47, y, w * 0.08, 64); }
    }, { aniso });
  }
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.85, side: THREE.DoubleSide });
  const walkTex = simpleTex(256, 256, (x, w, h) => {
    if (T.shoulder === 'earth') { // ghat: laterite gravel shoulder, no footpath
      x.fillStyle = '#5a4434'; x.fillRect(0, 0, w, h); noise(x, w, h, [1, 0.85, 0.7], 48, r);
      for (let i = 0; i < 400; i++) { x.fillStyle = `rgba(${r() < 0.5 ? '30,24,18' : '120,100,80'},0.5)`; x.fillRect(r() * w, r() * h, 2 + r() * 4, 2 + r() * 4); }
    } else if (india) {
      x.fillStyle = '#6a5d52'; x.fillRect(0, 0, w, h); noise(x, w, h, [1, 0.9, 0.8], 36, r);
      x.strokeStyle = 'rgba(30,24,20,0.55)'; x.lineWidth = 2;
      for (let i = 0; i <= 8; i++) { x.beginPath(); x.moveTo(0, i * h / 8); x.lineTo(w, i * h / 8); x.stroke(); }
      for (let j = 0; j < 8; j++) for (let i = 0; i <= 4; i++) { const ox = (j % 2) * w / 8 + i * w / 4; x.beginPath(); x.moveTo(ox, j * h / 8); x.lineTo(ox, (j + 1) * h / 8); x.stroke(); }
    } else {
      x.fillStyle = '#5d5c58'; x.fillRect(0, 0, w, h); noise(x, w, h, [1, 1, 1], 30, r);
      x.strokeStyle = 'rgba(0,0,0,0.45)'; x.lineWidth = 3;
      for (let i = 0; i <= 2; i++) { x.beginPath(); x.moveTo(0, i * h / 2); x.lineTo(w, i * h / 2); x.stroke(); }
    }
  }, { aniso });
  const walkMat = new THREE.MeshStandardMaterial({ map: walkTex, roughness: 0.9 });
  const walls = [], walks = [];
  for (const side of [1, -1]) {
    walls.push(ribbon(track, wallProfile, side, wallV));
    const kerbH = T.shoulder === 'earth' ? 0.02 : 0.17;
    walks.push(ribbon(track, [[HW + WALL, kerbH], [HW + WALL + SIDEWALK, kerbH], [HW + WALL + SIDEWALK + 0.02, 0]], side, 3));
  }
  scene.add(new THREE.Mesh(mergeGeometries(walls), wallMat));
  scene.add(new THREE.Mesh(mergeGeometries(walks), walkMat));
  if (!track.closed) { // road-closed barriers at both ends
    for (const [d, yawAdd] of [[1.5, 0], [L - 1.5, Math.PI]]) {
      const p = track.sample(d);
      const b = new THREE.Mesh(new THREE.BoxGeometry(HW * 2 + 1, 1.1, 0.8), wallMat);
      b.position.set(p.x, p.y + 0.55, p.z); b.rotation.y = p.yaw + yawAdd; scene.add(b);
    }
  }

  const tunnelTex = simpleTex(128, 256, (x, w, h) => {
    x.fillStyle = '#4a4c50'; x.fillRect(0, 0, w, h); noise(x, w, h, [1, 1, 1], 30, r);
    for (let y = 0; y < h; y += 64) { x.fillStyle = 'rgba(0,0,0,0.4)'; x.fillRect(0, y, w, 3); }
  }, { aniso });
  if (hasTunnel) {
    const tunnelGeos = [], stripGeos = [];
    const [ta, tb] = tunnelIdx;
    for (const side of [1, -1]) tunnelGeos.push(ribbon(track, [[HW + WALL + 0.1, 0], [HW + WALL + 0.1, 7.2]], side, 6, ta, tb));
    tunnelGeos.push(ribbon(track, [[-(HW + WALL + 0.1), 7.2], [HW + WALL + 0.1, 7.2]], 1, 6, ta, tb));
    stripGeos.push(ribbon(track, [[-0.5, 7.15], [0.5, 7.15]], 1, 6, ta, tb));
    for (const side of [1, -1]) stripGeos.push(ribbon(track, [[HW + WALL + 0.05, 1.5], [HW + WALL + 0.05, 1.7]], side, 6, ta, tb));
    scene.add(new THREE.Mesh(mergeGeometries(tunnelGeos), new THREE.MeshStandardMaterial({ map: tunnelTex, roughness: 0.8, side: THREE.DoubleSide })));
    const stripTex = simpleTex(16, 128, (x, w, h) => { x.fillStyle = '#000'; x.fillRect(0, 0, w, h); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h * 0.6); }, { aniso });
    scene.add(new THREE.Mesh(mergeGeometries(stripGeos), new THREE.MeshBasicMaterial({ map: stripTex, color: new THREE.Color(2.2, 2.3, 2.6), side: THREE.DoubleSide })));
    for (const d of [t0, t1]) {
      const p = track.sample(d);
      const portal = new THREE.Mesh(new THREE.BoxGeometry(HW * 2 + 3, 2.2, 1.2), new THREE.MeshStandardMaterial({ map: tunnelTex, roughness: 0.8 }));
      portal.position.set(p.x, 8.2, p.z); portal.rotation.y = p.yaw; scene.add(portal);
    }
    for (let d = t0 + 6; d < t1; d += 16) world.lamps.push({ ...pick(track.sample(d)), y: 6.6, color: 0xdfe8ff, tunnel: true });
  }

  // Streetlights
  const poleGeos = [], bulbGeos = [], pools = [];
  const lampCol = new THREE.Color();
  let k = 0;
  for (let d = 10; d < L; d += T.lampSpacing, k++) {
    if (hasTunnel && d > t0 - 20 && d < t1 + 20) continue;
    if (track.overpasses.some((o) => Math.abs(track.delta(d, o.dist)) < 14)) continue;
    const side = k % 2 ? 1 : -1;
    const base = track.sample(d, side * (HW + WALL + 1.2));
    const ix = -side * base.tz, iz = side * base.tx;
    const th = Math.atan2(-iz, ix);
    const m = new THREE.Matrix4().makeRotationY(th).setPosition(base.x, base.y, base.z);
    const pole = new THREE.CylinderGeometry(0.11, 0.17, 9.2, 8).translate(0, 4.6, 0);
    const arm = new THREE.BoxGeometry(2.9, 0.13, 0.13).translate(1.35, 9.0, 0);
    const head = new THREE.BoxGeometry(1.1, 0.22, 0.55).translate(2.75, 8.92, 0);
    poleGeos.push(pole.applyMatrix4(m), arm.applyMatrix4(m), head.applyMatrix4(m));
    const color = T.lampColors[Math.floor(r() * T.lampColors.length)];
    lampCol.set(color).multiplyScalar(4);
    const bulb = new THREE.BoxGeometry(0.9, 0.05, 0.4).translate(2.75, 8.8, 0).applyMatrix4(m).toNonIndexed();
    const cArr = new Float32Array(bulb.attributes.position.count * 3);
    for (let i = 0; i < cArr.length; i += 3) { cArr[i] = lampCol.r; cArr[i + 1] = lampCol.g; cArr[i + 2] = lampCol.b; }
    bulb.setAttribute('color', new THREE.BufferAttribute(cArr, 3));
    bulb.deleteAttribute('uv'); bulb.deleteAttribute('normal');
    bulbGeos.push(bulb);
    const lp = track.sample(d, side * (HW + WALL + 1.2 - 2.75));
    world.lamps.push({ x: lp.x, z: lp.z, y: lp.y + 8.6, color });
    pools.push([lp.x, lp.z, 20, color, lp.y]);
  }
  for (const l of world.lamps) if (l.tunnel) pools.push([l.x, l.z, 14, 0x9fb8ff, 0]);
  if (poleGeos.length) {
    scene.add(new THREE.Mesh(mergeGeometries(poleGeos), new THREE.MeshStandardMaterial({ color: 0x2c3036, metalness: 0.7, roughness: 0.45 })));
    scene.add(new THREE.Mesh(mergeGeometries(bulbGeos), new THREE.MeshBasicMaterial({ vertexColors: true })));
  }

  const poolTex = simpleTex(128, 128, (x, w, h) => {
    const g = x.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
  }, { repeat: false });
  if (pools.length) {
    const pos = [], uv = [], col = [];
    const c = new THREE.Color();
    for (const [px, pz, s, color, py] of pools) {
      c.set(color);
      const h = s / 2;
      const v = [[px - h, pz - h, 0, 0], [px + h, pz - h, 1, 0], [px + h, pz + h, 1, 1], [px - h, pz + h, 0, 1]];
      for (const t of [0, 2, 1, 0, 3, 2]) { pos.push(v[t][0], py + 0.045, v[t][1]); uv.push(v[t][2], v[t][3]); col.push(c.r, c.g, c.b); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    scene.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: poolTex, vertexColors: true, transparent: true, opacity: india ? 0.26 : 0.2, blending: THREE.AdditiveBlending, depthWrite: false })));
  }

  // Buildings
  const sets = { main: { pos: [], uv: [], col: [] }, glass: { pos: [], uv: [], col: [] } };
  const boxes = [];
  const decks = track.overpasses.map((o) => {
    const p = track.sample(o.dist);
    const a = Math.atan2(p.tx, p.tz) + Math.PI / 2 + o.skew;
    return { x: p.x, z: p.z, ax: Math.sin(a), az: Math.cos(a) };
  });
  const reserved = T.reserved || [];
  const blocked = (x, z, rad) => {
    if (T.tokyo && Math.hypot(x + 380, z - 1380) < 70 + rad) return true;
    for (const q of reserved) if (Math.hypot(x - q.x, z - q.z) < q.r + rad) return true;
    for (const k2 of decks) {
      const t = Math.max(-215, Math.min(215, (x - k2.x) * k2.ax + (z - k2.z) * k2.az));
      if (Math.hypot(x - (k2.x + k2.ax * t), z - (k2.z + k2.az * t)) < rad + 10) return true;
    }
    return false;
  };
  const need = HW + WALL + SIDEWALK + 0.8;
  const tryBox = (b) => {
    if (blocked(b.x, b.z, Math.hypot(b.w, b.d) / 2)) return false;
    const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
    for (const [lx, lz] of [[-b.w / 2, -b.d / 2], [b.w / 2, -b.d / 2], [b.w / 2, b.d / 2], [-b.w / 2, b.d / 2], [0, 0]]) {
      const n = track.nearest(b.x + lx * c + lz * s, b.z - lx * s + lz * c);
      if (Math.abs(n.lateral) <= need) return false;
      if (!track.closed && (n.dist < 1 || n.dist > L - 1) && Math.hypot(b.x - n.x, b.z - n.z) < need + 30) return false;
      const ws = waterSide(n.dist);
      if (ws && Math.sign(n.lateral) === ws) return false;
    }
    b.y0 = groundY(b.x, b.z);
    b.u0 = r(); b.v0 = r(); b.tint = 0.75 + r() * 0.5;
    if (T.tints) b.tc = T.tints[Math.floor(r() * T.tints.length)];
    const set = b.glass ? sets.glass : sets.main;
    boxFaces(b, set.pos, set.uv, set.col, r);
    boxes.push(b);
    return true;
  };
  const builtAt = (d) => inRanges(frac(d), T.buildRanges);
  const tallFn = () => r() < T.tall;
  for (const side of [1, -1]) {
    let d = r() * 20;
    while (d < L) {
      const w = 9 + r() * 15, dep = 14 + r() * 16;
      d += w / 2;
      if (builtAt(d) && r() < T.density) {
        const tall = tallFn();
        const h = tall ? T.tallH[0] + r() * (T.tallH[1] - T.tallH[0]) : T.nearH[0] + r() * (T.nearH[1] - T.nearH[0]);
        const setback = HW + WALL + SIDEWALK + 1.5 + dep / 2;
        const p = track.sample(d, side * setback);
        tryBox({ x: p.x, z: p.z, yaw: p.yaw, w, d: dep, h, front: side, near: true, glass: tall && !T.tokyo });
      }
      d += w / 2 + 0.6 + r() * 2.5;
    }
  }
  if (track.closed) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < track.n; i++) { minX = Math.min(minX, track.px[i]); maxX = Math.max(maxX, track.px[i]); minZ = Math.min(minZ, track.pz[i]); maxZ = Math.max(maxZ, track.pz[i]); }
    for (let gx = minX - 700; gx < maxX + 700; gx += 46) {
      for (let gz = minZ - 700; gz < maxZ + 700; gz += 46) {
        if (r() < 0.12) continue;
        const w = 16 + r() * 22, dep = 16 + r() * 22;
        const h = 12 + Math.pow(r(), 2.4) * 150;
        tryBox({ x: gx + (r() - 0.5) * 10, z: gz + (r() - 0.5) * 10, yaw: (r() < 0.8 ? 0 : r() * Math.PI), w, d: dep, h });
      }
    }
  } else {
    for (let d = 0; d < L; d += 38) {
      if (!builtAt(d)) continue;
      for (const side of [1, -1]) for (let row = 0; row < 4; row++) {
        if (r() > 0.75 * T.density) continue;
        const w = 12 + r() * 18, dep = 12 + r() * 18;
        const tall = r() < T.tall * 1.5;
        const h = tall ? T.tallH[0] + r() * (T.tallH[1] - T.tallH[0]) : T.nearH[0] + Math.pow(r(), 1.5) * (T.nearH[1] - T.nearH[0]) * 1.3;
        const p = track.sample(d + (r() - 0.5) * 20, side * (48 + row * 52 + r() * 18));
        tryBox({ x: p.x, z: p.z, yaw: p.yaw + (r() - 0.5) * 0.3, w, d: dep, h, glass: tall && !T.tokyo });
      }
    }
  }
  const bmatFor = (map) => {
    const m = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: null }, glow: { value: 0.95 } }]),
      vertexShader: BUILDING_VS, fragmentShader: BUILDING_FS, vertexColors: true, fog: true,
    });
    m.uniforms.map.value = map;
    return m;
  };
  for (const [key, style] of [['main', T.facade], ['glass', 'glass']]) {
    const set = sets[key];
    if (!set.pos.length) continue;
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.Float32BufferAttribute(set.pos, 3));
    bg.setAttribute('uv', new THREE.Float32BufferAttribute(set.uv, 2));
    bg.setAttribute('color', new THREE.Float32BufferAttribute(set.col, 3));
    scene.add(new THREE.Mesh(bg, bmatFor(facadeTexture(r, style))));
  }

  // Neon signs on buildings facing the road (Tokyo)
  if (T.neon) {
    const atlas = signAtlas();
    const spos = [], suv = [];
    for (const b of boxes) {
      if (!b.near || r() > 0.32 || b.h < 10) continue;
      const id = Math.floor(r() * 8);
      const u0 = (id % 2) * 0.5, v1 = 1 - Math.floor(id / 2) * 0.25, v0 = v1 - 0.25;
      const nx = -b.front * Math.cos(b.yaw), nz = b.front * Math.sin(b.yaw);
      const tx = Math.sin(b.yaw), tz = Math.cos(b.yaw);
      const sw = Math.min(b.w * 0.8, 12), sh = sw / 4;
      const y = b.y0 + 5 + r() * Math.min(18, b.h - 8);
      const cx = b.x + nx * (b.d / 2 + 0.25), cz = b.z + nz * (b.d / 2 + 0.25);
      const dirSign = b.front;
      const ax = cx - tx * sw / 2 * dirSign, az = cz - tz * sw / 2 * dirSign;
      const bx = cx + tx * sw / 2 * dirSign, bz = cz + tz * sw / 2 * dirSign;
      const quad = [[ax, y, az, u0, v0], [bx, y, bz, u0 + 0.5, v0], [bx, y + sh, bz, u0 + 0.5, v1], [ax, y + sh, az, u0, v1]];
      for (const t of [0, 1, 2, 0, 2, 3]) { spos.push(quad[t][0], quad[t][1], quad[t][2]); suv.push(quad[t][3], quad[t][4]); }
    }
    if (spos.length) {
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.Float32BufferAttribute(spos, 3));
      sg.setAttribute('uv', new THREE.Float32BufferAttribute(suv, 2));
      scene.add(new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ map: atlas, color: new THREE.Color(2.6, 2.6, 2.6), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false })));
    }
  }

  // Aviation lights on tall roofs
  const avGeos = [];
  for (const b of boxes) if (b.h > 75) avGeos.push(new THREE.SphereGeometry(0.7, 6, 4).translate(b.x, b.y0 + b.h + 0.6, b.z));
  const avMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(8, 0.2, 0.1) });
  if (avGeos.length) scene.add(new THREE.Mesh(mergeGeometries(avGeos), avMat));

  // Start gantry (with race lights) and, on open roads, the finish arch
  const gantry = (d, text, lights) => {
    const p = track.sample(d);
    const g = new THREE.Group();
    g.position.set(p.x, p.y, p.z); g.rotation.y = p.yaw;
    const steel = new THREE.MeshStandardMaterial({ color: 0x1b1e24, metalness: 0.8, roughness: 0.35 });
    for (const sx of [-1, 1]) { const pil = new THREE.Mesh(new THREE.BoxGeometry(0.9, 9, 0.9), steel); pil.position.set(sx * (HW + 1.1), 4.5, 0); g.add(pil); }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(HW * 2 + 3.2, 1.9, 0.9), steel); beam.position.y = 8.4; g.add(beam);
    const banner = simpleTex(1024, 96, (x, w, h) => {
      x.fillStyle = '#05060a'; x.fillRect(0, 0, w, h);
      for (let i = 0; i < 12; i++) for (let j = 0; j < 6; j++) { x.fillStyle = (i + j) % 2 ? '#eee' : '#111'; x.fillRect(i * 16, j * 16, 16, 16); x.fillRect(w - 192 + i * 16, j * 16, 16, 16); }
      x.font = 'italic 900 58px "Arial Black", Impact, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
      const tw = x.measureText(text).width; const sc = Math.min(1, 600 / tw);
      x.save(); x.translate(w / 2, h / 2 + 2); x.scale(sc, 1);
      x.shadowColor = '#39e6ff'; x.shadowBlur = 20; x.fillStyle = '#bff6ff'; x.fillText(text, 0, 0); x.restore();
    }, { repeat: false });
    for (const zf of [-0.46, 0.46]) {
      const bm = new THREE.Mesh(new THREE.PlaneGeometry(HW * 2 + 3, 1.7), new THREE.MeshBasicMaterial({ map: banner, color: new THREE.Color(1.6, 1.6, 1.6) }));
      bm.position.set(0, 8.4, zf); if (zf < 0) bm.rotation.y = Math.PI; g.add(bm);
    }
    if (lights) {
      for (let i = 0; i < 5; i++) {
        const lm = new THREE.MeshBasicMaterial({ color: 0x220000 });
        const l = new THREE.Mesh(new THREE.CircleGeometry(0.42, 20), lm);
        l.position.set((i - 2) * 1.3, 6.95, -0.5); l.rotation.y = Math.PI; g.add(l);
        world.startLights.push(lm);
      }
      const housing = new THREE.Mesh(new THREE.BoxGeometry(7, 1.1, 0.3), steel); housing.position.set(0, 6.95, -0.32); g.add(housing);
    }
    scene.add(g);
  };
  gantry(track.startDist, T.banner, true);
  if (!track.closed) gantry(track.finishDist, 'FINISH · ' + T.endLabel, false);

  world.boxes = boxes;
  world.update = (t) => {
    const on = (t % 1.6) < 0.25;
    avMat.color.setRGB(on ? 8 : 0.4, on ? 0.2 : 0.01, on ? 0.1 : 0.01);
  };
  world.setStartLights = (lit, green) => {
    world.startLights.forEach((m, i) => m.color.setRGB(green ? 0.2 : i < lit ? 9 : 0.15, green ? 8 : 0, green ? 0.6 : 0));
  };
  return world;
}

function pick(s) { return { x: s.x, z: s.z }; }

export function gridSlot(track, k) {
  const d = track.startDist - 14 - k * 6.5;
  const lat = (k % 2 === 0 ? 1 : -1) * 3.4;
  return track.sample(d, lat);
}
