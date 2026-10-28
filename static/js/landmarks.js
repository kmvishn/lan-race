import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { HW } from './track.js';
import { FONTS, WELCOME, waterSideAt } from './themes.js';

const RESERVE = { palace: 110, gopuram: 45, lighthouse: 25, charminar: 40, buddha: 30, fort: 70, mall: 80, glassTowers: 60, techpark: 90, viewpoint: 20, gateway: 0, bridgeArches: 0, statueRow: 0, kakatiyaArch: 0 };
const OFFSET = { palace: 150, gopuram: 70, lighthouse: 90, charminar: 55, buddha: 260, fort: 110, mall: 110, glassTowers: 80, techpark: 140, viewpoint: 45 };

// Roadside pieces place themselves along the road (no plan offset, no reserved circle).
const ROADSIDE = new Set(['gateway', 'bridgeArches', 'statueRow', 'kakatiyaArch']);

// Decide where each landmark of a theme sits; buildings keep clear of the returned circles.
export function planLandmarks(track, T) {
  const out = [];
  const span = track.closed ? track.length : track.finishDist - track.startDist;
  const waterAt = (d) => (T.water ? waterSideAt(track, d, T.water.dir) : 1);
  for (const lm of T.landmarks || []) {
    let d;
    let ahead = false;
    if (lm.at === 'start') d = track.startDist + (lm.type === 'gateway' ? 35 : 160);
    else if (lm.at === 'end') { d = track.finishDist - (lm.type === 'gateway' ? 40 : 0); ahead = lm.type !== 'gateway'; }
    else d = track.startDist + lm.at * span;
    const p = track.sample(d);
    let x = p.x, z = p.z, yaw = p.yaw;
    if (ahead && !track.closed) {
      const e = track.sample(track.length);
      const dist = (OFFSET[lm.type] || 80) * 0.7 + 40;
      x = e.x + e.tx * dist; z = e.z + e.tz * dist; yaw = e.yaw + Math.PI;
    } else if (!ROADSIDE.has(lm.type)) {
      let side = lm.side ?? 1;
      if (side === 'water') side = waterAt(d);
      if (side === 'land') side = -waterAt(d);
      const off = OFFSET[lm.type] || 80;
      x = p.x + p.tz * side * off; z = p.z - p.tx * side * off;
      yaw = Math.atan2(-p.tz * side, p.tx * side); // face the road
    }
    out.push({ ...lm, d, x, z, yaw, r: RESERVE[lm.type] ?? 40 });
  }
  return out;
}

export function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
export const basic = (color, k = 1) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k) });
export const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra });

export function labelSign(text, sub, color, w = 30, font = '"Arial Black", Impact, sans-serif') {
  const t = canvasTex(1024, 256, (x, W, H) => {
    x.fillStyle = 'rgba(0,0,0,0)'; x.clearRect(0, 0, W, H);
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = `900 ${sub ? 110 : 140}px ${font}`;
    const tw = x.measureText(text).width; const sc = Math.min(1, (W - 40) / tw);
    x.save(); x.translate(W / 2, sub ? H * 0.38 : H / 2); x.scale(sc, 1);
    x.shadowColor = color; x.shadowBlur = 24; x.fillStyle = color; x.fillText(text, 0, 0);
    x.shadowBlur = 0; x.fillStyle = '#ffffff'; x.globalAlpha = 0.85; x.fillText(text, 0, 0); x.restore();
    if (sub) { x.globalAlpha = 1; x.font = '700 54px Arial, sans-serif'; x.fillStyle = '#ffffff'; x.fillText(sub, W / 2, H * 0.8); }
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), new THREE.MeshBasicMaterial({ map: t, transparent: true, color: new THREE.Color(1.8, 1.8, 1.8), side: THREE.DoubleSide, depthWrite: false }));
  return m;
}

// Thousands of tiny bulbs outlining a box (Mysore Palace style illumination).
function bulbOutline(boxes, spacing, color) {
  const pts = [];
  for (const [cx, cy, cz, w, h, d] of boxes) {
    const xs = [cx - w / 2, cx + w / 2], ys = [cy - h / 2, cy + h / 2], zs = [cz - d / 2, cz + d / 2];
    const edge = (a, b) => { const n = Math.max(1, Math.round(a.distanceTo(b) / spacing)); for (let i = 0; i <= n; i++) pts.push(a.clone().lerp(b, i / n)); };
    for (const y of ys) {
      edge(new THREE.Vector3(xs[0], y, zs[0]), new THREE.Vector3(xs[1], y, zs[0]));
      edge(new THREE.Vector3(xs[0], y, zs[1]), new THREE.Vector3(xs[1], y, zs[1]));
      edge(new THREE.Vector3(xs[0], y, zs[0]), new THREE.Vector3(xs[0], y, zs[1]));
      edge(new THREE.Vector3(xs[1], y, zs[0]), new THREE.Vector3(xs[1], y, zs[1]));
    }
    for (const x of xs) for (const z of zs) edge(new THREE.Vector3(x, ys[0], z), new THREE.Vector3(x, ys[1], z));
  }
  const im = new THREE.InstancedMesh(new THREE.SphereGeometry(0.16, 5, 3), basic(color, 6), pts.length);
  const m = new THREE.Matrix4();
  pts.forEach((p, i) => im.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z)));
  return im;
}

export function dome(r, h, color, spike = true) {
  const g = new THREE.Group();
  const s = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), color);
  s.scale.y = h / r; g.add(s);
  if (spike) { const c = new THREE.Mesh(new THREE.ConeGeometry(r * 0.12, r * 0.9, 8), basic(0xffc94a, 1.6)); c.position.y = h + r * 0.4; g.add(c); }
  return g;
}

export const BUILD = {
  palace(T) {
    const g = new THREE.Group();
    const stone = std(0xd9cfb8);
    const parts = [[0, 10, 0, 110, 20, 45], [0, 25, 0, 80, 10, 34], [0, 41, 0, 18, 22, 18]];
    for (const [x, y, z, w, h, d] of parts) { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), stone); b.position.set(x, y, z); g.add(b); }
    const gold = std(0xd9a441, { metalness: 0.6, roughness: 0.35 });
    const big = dome(10, 14, gold); big.position.y = 52; g.add(big);
    for (const [x, z] of [[-48, 18], [48, 18], [-48, -18], [48, -18], [-30, 12], [30, 12]]) { const dm = dome(4, 6, gold); dm.position.set(x, x * x > 1000 ? 20 : 30, z); g.add(dm); }
    g.add(bulbOutline(parts.map(([x, y, z, w, h, d]) => [x, y, z, w + 0.2, h + 0.1, d + 0.2]).concat([[0, 26, 23.2, 60, 6, 0.2]]), 1.1, 0xffd27a));
    return g;
  },
  gopuram(T) {
    const g = new THREE.Group();
    const sculpt = canvasTex(256, 256, (x, w, h) => {
      x.fillStyle = '#c9a46a'; x.fillRect(0, 0, w, h);
      const cols = ['#d8442f', '#2f7bd8', '#e8b92f', '#2fa85a', '#e8e0d0'];
      for (let i = 0; i < 8; i++) for (let j = 0; j < 4; j++) {
        x.fillStyle = cols[(i + j) % cols.length]; x.fillRect(i * 32 + 6, j * 64 + 14, 20, 40);
        x.fillStyle = '#7a5a30'; x.fillRect(i * 32 + 2, j * 64 + 56, 30, 6);
      }
    });
    sculpt.wrapS = sculpt.wrapT = THREE.RepeatWrapping;
    const mat = new THREE.MeshBasicMaterial({ map: sculpt, color: new THREE.Color(1.15, 1.05, 0.95) });
    const base = new THREE.Mesh(new THREE.BoxGeometry(34, 10, 24), std(0xb89a72)); base.position.y = 5; g.add(base);
    let w = 30, d = 20, y = 10;
    for (let i = 0; i < 9; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, 5.4, d), mat); b.position.y = y + 2.7; g.add(b);
      y += 5.4; w *= 0.88; d *= 0.86;
    }
    const top = new THREE.Mesh(new THREE.CylinderGeometry(d * 0.6, d * 0.6, w, 16, 1, false, 0, Math.PI), std(0xd9a441, { metalness: 0.5 }));
    top.rotation.z = Math.PI / 2; top.position.y = y; g.add(top);
    for (let i = -2; i <= 2; i++) { const k = new THREE.Mesh(new THREE.ConeGeometry(0.6, 3, 8), basic(0xffc94a, 1.8)); k.position.set(i * w / 5, y + d * 0.6 + 1, 0); g.add(k); }
    return g;
  },
  lighthouse(T, lm) {
    const g = new THREE.Group();
    const stripes = canvasTex(64, 256, (x, w, h) => {
      for (let i = 0; i < 8; i++) { x.fillStyle = lm.stripes === false ? '#eeeeee' : i % 2 ? '#f2f2f2' : '#c4161c'; x.fillRect(0, i * h / 8, w, h / 8); }
    });
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 4.2, 46, 20), new THREE.MeshBasicMaterial({ map: stripes, color: new THREE.Color(0.7, 0.7, 0.7) }));
    tower.position.y = 23; g.add(tower);
    const gallery = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 0.6, 20), std(0x222222)); gallery.position.y = 46.3; g.add(gallery);
    const lantern = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 3.4, 16), basic(0xfff2c8, 5)); lantern.position.y = 48.3; g.add(lantern);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(2.6, 2.4, 16), std(0x1a1a1a)); cap.position.y = 51.2; g.add(cap);
    const beamMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.5, 1.2), transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const beam = new THREE.Group(); beam.position.y = 48.3;
    for (const s of [1, -1]) { const c = new THREE.Mesh(new THREE.ConeGeometry(9, 260, 16, 1, true), beamMat); c.rotation.z = s * Math.PI / 2; c.position.x = s * 130; beam.add(c); }
    g.add(beam);
    g.userData.update = (t) => { beam.rotation.y = t * 0.8; };
    return g;
  },
  charminar() {
    const g = new THREE.Group();
    const stone = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.95, 0.85, 0.66) });
    const arches = canvasTex(256, 256, (x, w, h) => {
      x.fillStyle = '#e8d6ae'; x.fillRect(0, 0, w, h);
      x.fillStyle = '#1a140c'; x.beginPath(); x.moveTo(60, h); x.lineTo(60, 110); x.quadraticCurveTo(128, 10, 196, 110); x.lineTo(196, h); x.fill();
      x.strokeStyle = '#b8a070'; x.lineWidth = 6; x.strokeRect(8, 8, w - 16, h - 16);
    });
    const face = new THREE.MeshBasicMaterial({ map: arches, color: new THREE.Color(1.05, 1, 0.9) });
    const base = new THREE.Mesh(new THREE.BoxGeometry(30, 20, 30), [face, face, stone, stone, face, face]); base.position.y = 10; g.add(base);
    const upper = new THREE.Mesh(new THREE.BoxGeometry(26, 8, 26), stone); upper.position.y = 24; g.add(upper);
    for (const [x, z] of [[-15, -15], [15, -15], [-15, 15], [15, 15]]) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.2, 52, 12), stone); m.position.set(x, 26, z); g.add(m);
      for (const y of [22, 34, 44]) { const b = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 0.8, 12), stone); b.position.set(x, y, z); g.add(b); }
      const dm = dome(2, 3, stone); dm.position.set(x, 52, z); g.add(dm);
    }
    g.add(bulbOutline([[0, 10, 0, 30.2, 20.1, 30.2]], 1.4, 0xfff0c8));
    return g;
  },
  buddha() {
    const g = new THREE.Group();
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(12, 1), std(0x55524c)); rock.scale.y = 0.45; rock.position.y = 1; g.add(rock);
    const white = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.3, 1.28, 1.2) });
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 4, 4, 16), white); ped.position.y = 7; g.add(ped);
    const robe = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 3.2, 13, 16), white); robe.position.y = 15.5; g.add(robe);
    const sh = new THREE.Mesh(new THREE.SphereGeometry(2.6, 16, 10), white); sh.scale.y = 0.6; sh.position.y = 22; g.add(sh);
    const head = new THREE.Mesh(new THREE.SphereGeometry(1.5, 16, 12), white); head.position.y = 24.4; g.add(head);
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 8), white); top.position.y = 25.9; g.add(top);
    return g;
  },
  fort() {
    const g = new THREE.Group();
    const laterite = std(0x8a4a2e);
    const S = 70, H = 9;
    for (const [x, z, w, d] of [[0, -S / 2, S, 3], [0, S / 2, S, 3], [-S / 2, 0, 3, S], [S / 2, 0, 3, S]]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w, H, d), laterite); wall.position.set(x, H / 2, z); g.add(wall);
      const n = Math.round(Math.max(w, d) / 3);
      for (let i = 0; i < n; i += 2) {
        const c = new THREE.Mesh(new THREE.BoxGeometry(w > d ? 1.5 : 3, 1.4, w > d ? 3 : 1.5), laterite);
        c.position.set(x + (w > d ? -w / 2 + i * 3 : 0), H + 0.7, z + (w > d ? 0 : -d / 2 + i * 3)); g.add(c);
      }
    }
    for (const [x, z] of [[-S / 2, -S / 2], [S / 2, -S / 2], [-S / 2, S / 2], [S / 2, S / 2]]) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(6, 7, H + 2, 16), laterite); b.position.set(x, (H + 2) / 2, z); g.add(b);
    }
    return g;
  },
  mall(T, lm) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(130, 26, 70), std(0x2c2f36)); body.position.y = 13; g.add(body);
    for (const y of [6, 14, 22]) { const band = new THREE.Mesh(new THREE.BoxGeometry(130.4, 0.8, 70.4), basic(0x9fd8ff, 2.2)); band.position.y = y; g.add(band); }
    const sign = labelSign(lm.label || 'MALL', 'SHOPPING · FOOD · CINEMA', '#ff7a2e', 60); sign.position.set(0, 30, 36); g.add(sign);
    return g;
  },
  glassTowers(T, lm) {
    const g = new THREE.Group();
    const glass = canvasTex(256, 512, (x, w, h) => {
      x.fillStyle = '#0c1a2a'; x.fillRect(0, 0, w, h);
      for (let j = 0; j < 32; j++) for (let i = 0; i < 16; i++) if (Math.random() < 0.55) { x.fillStyle = Math.random() < 0.8 ? '#cfe6ff' : '#ffe2b0'; x.fillRect(i * 16 + 2, j * 16 + 3, 12, 10); }
    });
    glass.wrapS = glass.wrapT = THREE.RepeatWrapping;
    for (const [x, h, w] of [[-22, 86, 30], [24, 70, 28]]) {
      const tm = glass.clone(); tm.needsUpdate = true; tm.repeat.set(w / 16, h / 32);
      const t = new THREE.Mesh(new THREE.BoxGeometry(w, h, 26), new THREE.MeshBasicMaterial({ map: tm, color: new THREE.Color(1.1, 1.1, 1.2) }));
      t.position.set(x, h / 2, 0); g.add(t);
      const crown = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 0.6, 26.4), basic(0x39e6ff, 3)); crown.position.set(x, h - 0.3, 0); g.add(crown);
    }
    const sign = labelSign(lm.label, null, '#39e6ff', 40); sign.position.set(-22, 92, 14); g.add(sign);
    return g;
  },
  techpark(T, lm) {
    const g = new THREE.Group();
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x0e1f33, metalness: 0.9, roughness: 0.15, emissive: 0x16304a, emissiveIntensity: 0.6 });
    for (const [x, z, h] of [[-45, -30, 48], [0, -40, 62], [45, -30, 40], [-30, 25, 36], [35, 25, 52]]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(34, h, 26), glassMat); b.position.set(x, h / 2, z); g.add(b);
      for (let y = 4; y < h; y += 4) { const band = new THREE.Mesh(new THREE.BoxGeometry(34.3, 0.4, 26.3), basic(0xbfe0ff, Math.random() < 0.6 ? 1.6 : 0.3)); band.position.set(x, y, z); g.add(band); }
    }
    const sign = labelSign(lm.label, 'TECH PARK', '#7cff6b', 56); sign.position.set(0, 70, 0); g.add(sign);
    return g;
  },
  viewpoint(T, lm) {
    const g = new THREE.Group();
    const wall = new THREE.Mesh(new THREE.BoxGeometry(40, 1.2, 1.2), std(0x6b6660)); wall.position.y = 0.6; g.add(wall);
    const sign = labelSign(lm.label, WELCOME[T.lang] ? `${WELCOME[T.lang]} · WAYANAD` : null, '#ffd23f', 26, FONTS[T.lang] + ', Arial'); sign.position.set(0, 9, 0); g.add(sign);
    for (const sx of [-12, 12]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.5, 9, 0.5), std(0x333333)); p.position.set(sx, 4.5, -0.3); g.add(p); }
    return g;
  },
};

function gateway(track, lm, T) {
  const p = track.sample(lm.d);
  const g = new THREE.Group();
  g.position.set(p.x, p.y, p.z); g.rotation.y = p.yaw;
  const pillarMat = std(0xe8d8b8);
  for (const sx of [-1, 1]) {
    const pil = new THREE.Mesh(new THREE.BoxGeometry(2.4, 11, 2.4), pillarMat); pil.position.set(sx * (HW + 2.5), 5.5, 0); g.add(pil);
    const dm = dome(1.6, 2.4, std(0xd9a441, { metalness: 0.5 })); dm.position.set(sx * (HW + 2.5), 11, 0); g.add(dm);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(HW * 2 + 7, 3.2, 1.4), std(0x7a1f1f)); beam.position.y = 12.2; g.add(beam);
  const t = canvasTex(1024, 160, (x, W, H) => {
    x.fillStyle = '#7a1f1f'; x.fillRect(0, 0, W, H);
    x.strokeStyle = '#ffd27a'; x.lineWidth = 8; x.strokeRect(8, 8, W - 16, H - 16);
    x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = '#ffe9a8';
    x.font = `900 64px ${FONTS[T.lang]}, Arial`; x.fillText(WELCOME[T.lang] || 'WELCOME', W * 0.24, H / 2 + 4);
    x.font = '900 58px "Arial Black", Impact, sans-serif';
    const tw = x.measureText(lm.label).width; const sc = Math.min(1, (W * 0.55) / tw);
    x.save(); x.translate(W * 0.68, H / 2 + 4); x.scale(sc, 1); x.fillText(lm.label, 0, 0); x.restore();
  });
  for (const zf of [-0.71, 0.71]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(HW * 2 + 6.6, 3), new THREE.MeshBasicMaterial({ map: t, color: new THREE.Color(1.4, 1.4, 1.4) }));
    m.position.set(0, 12.2, zf); if (zf < 0) m.rotation.y = Math.PI; g.add(m);
  }
  g.add(bulbOutline([[0, 12.2, 0, HW * 2 + 7.2, 3.4, 1.6]], 0.9, 0xffd27a));
  return g;
}

// Napier Bridge: steel tied arches either side of the deck with vertical hangers, painted as a black-and-white
// chessboard since 2022 and lit at night.
function bridgeArches(track, lm) {
  const g = new THREE.Group();
  const chess = canvasTex(256, 64, (x, W, H) => { for (let i = 0; i < 8; i++) for (let j = 0; j < 2; j++) { x.fillStyle = (i + j) % 2 ? '#111214' : '#f2f2ee'; x.fillRect(i * 32, j * 32, 32, 32); } });
  chess.wrapS = chess.wrapT = THREE.RepeatWrapping; chess.repeat.set(10, 1);
  const steel = new THREE.MeshStandardMaterial({ map: chess, roughness: 0.5, metalness: 0.3, emissive: 0xffffff, emissiveMap: chess, emissiveIntensity: 0.08 });
  const hangers = [], R = 21, rise = 9;
  for (let k = 0; k < 3; k++) {
    const d0 = lm.d + k * 42, p = track.sample(d0 + 21);
    for (const side of [1, -1]) {
      const a = new THREE.Mesh(new THREE.TorusGeometry(R, 0.55, 6, 40, Math.PI).scale(1, rise / R, 1), steel);
      a.position.set(p.x + p.tz * side * (HW + 1.2), p.y, p.z - p.tx * side * (HW + 1.2));
      a.rotation.y = p.yaw + Math.PI / 2;
      g.add(a);
      for (let h = -0.8; h <= 0.81; h += 0.2) { // vertical hangers under the arch, in the arch's own frame
        const hy = rise * Math.sqrt(1 - h * h);
        hangers.push(new THREE.BoxGeometry(0.12, hy, 0.12).translate(h * R, hy / 2, 0).rotateY(p.yaw + Math.PI / 2).translate(a.position.x, a.position.y, a.position.z));
      }
    }
  }
  g.add(new THREE.Mesh(mergeGeometries(hangers), new THREE.MeshStandardMaterial({ color: 0xe8e8e2, roughness: 0.6 })));
  return g;
}

// Tank Bund: bronze statues of Telugu luminaries on granite plinths along the lake, ~95 m apart. Instanced.
function statueRow(track, lm, T, groundY) {
  const span = track.finishDist - track.startDist, d0 = track.startDist + lm.from * span, d1 = track.startDist + lm.to * span;
  const n = Math.max(1, Math.floor((d1 - d0) / 95));
  const figure = mergeGeometries([
    new THREE.CylinderGeometry(0.34, 0.5, 1.7, 10).translate(0, 0.85, 0), // robe
    new THREE.CylinderGeometry(0.3, 0.34, 0.55, 10).translate(0, 1.95, 0), // shoulders
    new THREE.SphereGeometry(0.22, 10, 8).translate(0, 2.42, 0), // head
    new THREE.CylinderGeometry(0.08, 0.08, 0.75, 6).rotateZ(-0.9).translate(0.45, 1.8, 0.15), // raised arm
    new THREE.CylinderGeometry(0.08, 0.08, 0.8, 6).rotateZ(0.2).translate(-0.36, 1.45, 0),
  ]);
  const plinth = mergeGeometries([new THREE.BoxGeometry(1.6, 2.4, 1.6).translate(0, 1.2, 0), new THREE.BoxGeometry(2.0, 0.3, 2.0).translate(0, 0.15, 0),
    new THREE.BoxGeometry(1.8, 0.2, 1.8).translate(0, 2.5, 0)]);
  const fig = new THREE.InstancedMesh(figure, new THREE.MeshStandardMaterial({ color: 0x8c6a3c, metalness: 0.75, roughness: 0.42 }), n);
  const base = new THREE.InstancedMesh(plinth, new THREE.MeshStandardMaterial({ color: 0x8d8a86, roughness: 0.85 }), n);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < n; i++) {
    const d = d0 + (i + 0.5) * ((d1 - d0) / n), p = track.sample(d);
    const side = T.water ? waterSideAt(track, d, T.water.dir) : 1;
    const x = p.x + p.tz * side * (HW + 3.5), z = p.z - p.tx * side * (HW + 3.5), y = groundY(x, z);
    q.setFromAxisAngle(up, Math.atan2(-p.tz * side, p.tx * side) + Math.PI); // face the road
    base.setMatrixAt(i, m.compose(new THREE.Vector3(x, y, z), q, one));
    fig.setMatrixAt(i, m.compose(new THREE.Vector3(x, y + 2.6, z), q, one));
  }
  const g = new THREE.Group(); g.add(base, fig);
  return g;
}

// Kakatiya Kala Thoranam replica gateway (the Warangal arch) over the lakeside footpath.
function kakatiyaArch(track, lm, T, groundY) {
  const span = track.finishDist - track.startDist, d = track.startDist + lm.at * span, p = track.sample(d);
  const side = T.water ? waterSideAt(track, d, T.water.dir) : 1;
  const x = p.x + p.tz * side * (HW + 4), z = p.z - p.tx * side * (HW + 4);
  const stone = new THREE.MeshStandardMaterial({ color: 0xb7a58a, roughness: 0.9 });
  const parts = [];
  for (const s of [-1, 1]) {
    parts.push(new THREE.BoxGeometry(1.1, 9, 1.1).translate(s * 3.6, 4.5, 0), new THREE.BoxGeometry(1.5, 0.6, 1.5).translate(s * 3.6, 0.3, 0),
      new THREE.BoxGeometry(1.4, 0.5, 1.4).translate(s * 3.6, 9.2, 0));
    for (let k = 1; k < 6; k++) parts.push(new THREE.BoxGeometry(1.25, 0.12, 1.25).translate(s * 3.6, k * 1.5, 0)); // carved bands
    parts.push(new THREE.ConeGeometry(0.45, 1.6, 6).translate(s * 4.4, 11.3, 0)); // hamsa finials
  }
  parts.push(new THREE.BoxGeometry(9.6, 1.0, 1.0).translate(0, 9.9, 0), new THREE.BoxGeometry(8.4, 0.5, 0.8).translate(0, 10.65, 0),
    new THREE.BoxGeometry(5.2, 0.9, 0.7).translate(0, 11.35, 0));
  const g = new THREE.Group();
  const arch = new THREE.Mesh(mergeGeometries(parts.map((q) => q.toNonIndexed())), stone);
  g.add(arch, bulbOutline([[0, 10.4, 0, 9.8, 2.2, 1.2]], 0.9, 0xffd27a));
  g.position.set(x, groundY(x, z), z);
  g.rotation.y = p.yaw;
  return g;
}

export function buildLandmarks(scene, track, T, plans, groundY = () => 0) {
  const updates = [];
  for (const lm of plans) {
    let obj;
    if (lm.type === 'gateway') obj = gateway(track, lm, T);
    else if (lm.type === 'bridgeArches') obj = bridgeArches(track, lm);
    else if (lm.type === 'statueRow') obj = statueRow(track, lm, T, groundY);
    else if (lm.type === 'kakatiyaArch') obj = kakatiyaArch(track, lm, T, groundY);
    else if (BUILD[lm.type]) {
      obj = BUILD[lm.type](T, lm);
      obj.position.set(lm.x, groundY(lm.x, lm.z), lm.z);
      obj.rotation.y = lm.yaw;
    }
    if (!obj) continue;
    scene.add(obj);
    if (obj.userData.update) updates.push(obj.userData.update);
  }
  return (t) => { for (const u of updates) u(t); };
}
