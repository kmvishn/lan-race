import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { HW, rng } from './track.js';
import { quad, geo, rgb, buildShared, buildReflections } from './tokyo.js';
import { FONTS, BOARDS, inRanges } from './themes.js';
import { buildLandmarks } from './landmarks.js';
import { buildTrain } from './metro.js';

const SW = () => HW + 0.5 + 5; // sidewalk outer edge
const FLEX = ['#d8262c', '#f4c20d', '#1f6fd0', '#1e9b4a', '#ffffff', '#ff7a1a', '#7b2cbf', '#0d0d0d'];

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function tex(c) { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }

// 16 bilingual flex boards (regional script + English), 1024x128 each.
function boardAtlas(T, r) {
  const W = 1024, H = 128;
  const [c, x] = canvas(W * 2, H * 8);
  const words = BOARDS[T.lang];
  const meta = [];
  for (let k = 0; k < 16; k++) {
    const [loc, en] = words[k % words.length];
    const ox = (k % 2) * W, oy = Math.floor(k / 2) * H;
    const bg = FLEX[(k * 3 + 1) % FLEX.length];
    const fg = bg === '#ffffff' || bg === '#f4c20d' ? '#c4121a' : bg === '#0d0d0d' ? '#f4c20d' : '#ffffff';
    x.fillStyle = bg; x.fillRect(ox, oy, W, H);
    x.fillStyle = 'rgba(0,0,0,0.25)'; x.fillRect(ox, oy + H - 10, W, 10);
    x.strokeStyle = fg; x.lineWidth = 4; x.strokeRect(ox + 8, oy + 8, W - 16, H - 16);
    x.fillStyle = fg; x.textBaseline = 'middle';
    x.font = `900 72px ${FONTS[T.lang]}, Arial`; x.textAlign = 'left';
    x.fillText(loc, ox + 30, oy + H / 2 + 4);
    x.font = '900 58px "Arial Black", Impact, sans-serif'; x.textAlign = 'right';
    x.fillText(en, ox + W - 30, oy + H / 2 + 4);
    meta.push({ u0: ox / (W * 2), u1: (ox + W) / (W * 2), v1: 1 - oy / (H * 8), v0: 1 - (oy + H) / (H * 8), color: bg });
  }
  return { tex: tex(c), meta };
}

function shutterAtlas(r) {
  const W = 256, H = 256;
  const [c, x] = canvas(W * 4, H);
  const interiors = [['#fff3d8', '#e0b070'], ['#eaf4ff', '#9fc2e6'], ['#ffe9c4', '#c86a2a'], ['#f4fff0', '#8fd0a0']];
  interiors.forEach(([a, b], k) => {
    const ox = k * W;
    const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, a); g.addColorStop(1, b);
    x.fillStyle = g; x.fillRect(ox, 0, W, H);
    x.fillStyle = 'rgba(40,30,20,0.55)';
    for (let i = 0; i < 5; i++) x.fillRect(ox + 10 + i * 48, 120 + (i % 2) * 20, 36, 90);
    const shutter = 40 + r() * 70;
    x.fillStyle = '#7d8086'; x.fillRect(ox, 0, W, shutter);
    for (let y = 4; y < shutter; y += 6) { x.fillStyle = '#5c5f64'; x.fillRect(ox, y, W, 2); }
  });
  return tex(c);
}

function treeInstances(scene, list, kind, detail = 1) {
  if (!list.length) return;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler(), col = new THREE.Color();
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x3a2a1e });
  if (kind === 'palm') {
    const trunk = new THREE.CylinderGeometry(0.18, 0.28, 1, 6).translate(0, 0.5, 0);
    const fr = [];
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const leaf = new THREE.BoxGeometry(0.5, 0.05, 4.2).translate(0, 0, 2.1);
      leaf.rotateX(0.55); leaf.rotateY(a);
      fr.push(leaf.toNonIndexed());
    }
    const crown = mergeGeometries(fr);
    const tI = new THREE.InstancedMesh(trunk, trunkMat, list.length);
    const cI = new THREE.InstancedMesh(crown, new THREE.MeshLambertMaterial({ color: 0x2f5a22, side: THREE.DoubleSide }), list.length);
    list.forEach((t, i) => {
      e.set(t.lean * Math.cos(t.yaw), 0, t.lean * Math.sin(t.yaw)); q.setFromEuler(e);
      m.compose(p.set(t.x, t.y, t.z), q, s.set(1, t.h, 1)); tI.setMatrixAt(i, m);
      const top = new THREE.Vector3(0, t.h, 0).applyQuaternion(q);
      e.set(0, t.yaw, 0); q.setFromEuler(e);
      m.compose(p.set(t.x + top.x, t.y + top.y, t.z + top.z), q, s.set(t.s, t.s, t.s)); cI.setMatrixAt(i, m);
    });
    scene.add(tI, cI);
    return;
  }
  const trunk = new THREE.CylinderGeometry(0.25, 0.42, 1, 6).translate(0, 0.5, 0);
  const canopy = new THREE.IcosahedronGeometry(1, detail);
  const tI = new THREE.InstancedMesh(trunk, trunkMat, list.length);
  const cI = new THREE.InstancedMesh(canopy, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), list.length);
  list.forEach((t, i) => {
    m.compose(p.set(t.x, t.y - 0.5, t.z), q.identity(), s.set(t.trunkW || 1, t.h + 0.5, t.trunkW || 1)); tI.setMatrixAt(i, m);
    e.set(0, t.yaw, 0); q.setFromEuler(e);
    m.compose(p.set(t.x, t.y + t.h + t.s * 0.35, t.z), q, s.set(t.s * 1.25, t.s * 0.7, t.s * 1.15)); cI.setMatrixAt(i, m);
    cI.setColorAt(i, col.setHSL(0.27 + t.hue * 0.06, 0.45, 0.13 + t.hue * 0.08));
  });
  scene.add(tI, cI);
}

export function buildIndia(scene, track, world, T, plans) {
  const r = rng(2024);
  const L = track.length;
  const up = [0, 1, 0];
  const reflections = [];
  const near = world.boxes.filter((b) => b.near);
  const ws = world.waterSide;

  // --- shop fronts + bilingual boards on the ground floor of roadside buildings
  const boards = boardAtlas(T, r);
  const shut = shutterAtlas(r);
  const bp = [], bu = [], sp = [], su = [], gp = [], gc = [];
  for (const b of near) {
    if (b.h < 4) continue;
    const nx = -b.front * Math.cos(b.yaw), nz = b.front * Math.sin(b.yaw);
    const tx = Math.sin(b.yaw) * b.front, tz = Math.cos(b.yaw) * b.front;
    const count = Math.max(1, Math.round((b.w - 1) / 6));
    const w = (b.w - 1) / count;
    for (let i = 0; i < count; i++) {
      if (r() < 0.12) continue;
      const along = -b.w / 2 + 0.5 + w * (i + 0.5);
      const fx = b.x + nx * (b.d / 2 + 0.06) + tx * along, fz = b.z + nz * (b.d / 2 + 0.06) + tz * along;
      const k = Math.floor(r() * 4);
      quad(sp, su, null, [fx, b.y0 + 1.75, fz], [tx, 0, tz], up, w - 0.3, 3.2, k * 0.25, 0, k * 0.25 + 0.25, 1);
      const m = boards.meta[Math.floor(r() * boards.meta.length)];
      quad(bp, bu, null, [fx + nx * 0.12, b.y0 + 4.3, fz + nz * 0.12], [tx, 0, tz], up, w - 0.1, (w - 0.1) / 8 * 1.4, m.u0, m.v0, m.u1, m.v1);
      quad(gp, null, gc, [fx + nx * 3, b.y0 + 0.2, fz + nz * 3], [-tx, 0, -tz], [nx, 0, nz], w, 6, 0, 0, 1, 1, [1, 0.85, 0.6]);
      if (r() < 0.5) {
        const s = track.nearest(fx, fz);
        reflections.push([s.x + s.tz * Math.sign(s.lateral) * (HW - 2), s.z - s.tx * Math.sign(s.lateral) * (HW - 2), s.tx, s.tz, 10, 2.4, rgb(m.color), 0.35]);
      }
    }
  }
  if (sp.length) {
    scene.add(new THREE.Mesh(geo(sp, su), new THREE.MeshBasicMaterial({ map: shut, color: new THREE.Color(0.9, 0.9, 0.9) })));
    scene.add(new THREE.Mesh(geo(bp, bu), new THREE.MeshBasicMaterial({ map: boards.tex, color: new THREE.Color(1.25, 1.25, 1.25) })));
    scene.add(new THREE.Mesh(geo(gp, null, gc), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false })));
  }

  // --- black water tanks on low-rise roofs
  if (T.tanks) {
    const tanks = [];
    for (const b of world.boxes) {
      if (b.h > 35 || r() < 0.45) continue;
      const n = 1 + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) tanks.push(new THREE.CylinderGeometry(0.75, 0.75, 1.3, 10).translate(b.x + (r() - 0.5) * b.w * 0.6, b.y0 + b.h + 0.65, b.z + (r() - 0.5) * b.d * 0.6));
    }
    if (tanks.length) scene.add(new THREE.Mesh(mergeGeometries(tanks), new THREE.MeshLambertMaterial({ color: 0x141414 })));
  }

  // --- trees
  const leafy = [], palms = [];
  const frac = world.frac;
  const kind = T.trees;
  if (kind) {
    const dens = T.treeDensity || 1;
    const step = kind === 'forest' ? 9 : 18 / dens;
    for (let d = 20; d < L - 20; d += step * (0.7 + r() * 0.6)) {
      for (const side of [1, -1]) {
        const water = ws(d) === side;
        const built = inRanges(frac(d), T.buildRanges);
        const usePalm = kind === 'palm' || (kind === 'mixed' && r() < 0.35) || water;
        if (water && kind !== 'palm' && kind !== 'mixed') continue;
        const rows = kind === 'forest' && !built ? 6 : 1;
        for (let row = 0; row < rows; row++) {
          if (r() > (row === 0 ? 0.85 : 0.65)) continue;
          const lat = row === 0 ? SW() - 1 - r() * 1.5 : SW() + 4 + row * 9 + r() * 6;
          const p = track.sample(d + (r() - 0.5) * 6, side * lat);
          const n = track.nearest(p.x, p.z);
          if (Math.abs(n.lateral) < HW + 1.5) continue;
          const t = { x: p.x, y: world.groundY(p.x, p.z), z: p.z, yaw: r() * 6.28, hue: r() };
          if (usePalm) palms.push({ ...t, h: 8 + r() * 7, s: 0.9 + r() * 0.4, lean: (r() - 0.5) * 0.25 });
          else leafy.push({ ...t, h: kind === 'forest' ? 6 + r() * 8 : 3.5 + r() * 2.5, s: kind === 'forest' ? 3 + r() * 3 : 4 + r() * 2.5, trunkW: 1 + r() * 0.6 });
        }
      }
    }
  }
  treeInstances(scene, leafy, 'leafy', kind === 'forest' ? 0 : 1);
  treeInstances(scene, palms, 'palm');

  // --- tea estate rows on the hillside (ghat)
  if (T.tea) {
    const bushes = [];
    for (let d = 40; d < L; d += 22) {
      if (r() < 0.4) continue;
      const side = r() < 0.5 ? 1 : -1;
      for (let row = 0; row < 6; row++) for (let i = 0; i < 6; i++) {
        const p = track.sample(d + i * 2.2, side * (SW() + 6 + row * 2.4));
        if (Math.abs(track.nearest(p.x, p.z).lateral) < SW() + 4) continue;
        bushes.push(p);
      }
    }
    if (bushes.length) {
      const im = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 6, 4), new THREE.MeshLambertMaterial({ color: 0x2e5a1c }), bushes.length);
      const m = new THREE.Matrix4();
      bushes.forEach((p, i) => im.setMatrixAt(i, m.makeScale(1.1, 0.7, 1.1).setPosition(p.x, world.groundY(p.x, p.z) + 0.5, p.z)));
      scene.add(im);
    }
  }

  // --- sea / backwater / lake with beach or promenade
  if (T.water) {
    const water = new THREE.MeshStandardMaterial({ color: T.water.kind === 'sea' ? 0x0b2a3a : 0x0a2430, roughness: 0.12, metalness: 0.2, envMapIntensity: 2.2 });
    const sand = new THREE.MeshLambertMaterial({ color: T.water.kind === 'sea' ? 0x8a7a5e : 0x5a5650 });
    const span = track.finishDist - track.startDist;
    // Water is flat (real water is) and below the lowest point of the whole route, so it can never rise over a road;
    // each row reaches out from the shore on the local water side and stops before any other stretch of road.
    const level = track.minY - 1.5;
    // road centre-line samples on a grid, for a cheap "is another stretch of road here?" test
    const GC = 20, roadGrid = new Map(), gk = (i, j) => i * 100003 + j;
    for (let i = 0; i < track.n; i += 2) {
      const k = gk(Math.floor(track.px[i] / GC), Math.floor(track.pz[i] / GC));
      let a = roadGrid.get(k); if (!a) roadGrid.set(k, a = []); a.push(i);
    }
    const R = SW() + 4, R2 = R * R, q = {};
    const otherRoad = (x, z, d) => {
      const ci = Math.floor(x / GC), cj = Math.floor(z / GC);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        for (const i of roadGrid.get(gk(ci + a, cj + b)) || []) {
          const dx = x - track.px[i], dz = z - track.pz[i];
          if (dx * dx + dz * dz < R2 && Math.abs(track.cum[i] - d) > 40) return true;
        }
      }
      return false;
    };
    const clear = (d, side, from, to, step) => {
      let len = from;
      for (; len < to; len += step) { track.sample(d, side * len, q); if (otherRoad(q.x, q.z, d)) break; }
      return Math.max(from, len - step);
    };
    for (const [f0, f1] of T.water.ranges) {
      const d0 = track.startDist + f0 * span - (f0 === 0 ? track.startDist : 0), d1 = Math.min(L, track.startDist + f1 * span + (f1 === 1 ? 80 : 0));
      const beach = T.water.beach;
      let pos = [], sandPos = [], prevSide = 0;
      const flush = () => { strip(pos, water); if (beach > 0) strip(sandPos, sand); pos = []; sandPos = []; };
      for (let d = d0; d <= d1; d += 8) {
        const side = ws(d) || prevSide || 1;
        if (prevSide && side !== prevSide) flush(); // road turned: start a new strip on the new water side
        prevSide = side;
        const shore = SW() + beach;
        const far = clear(d, side, shore, 2500, 25), sandEnd = clear(d, side, SW(), shore, 5);
        const sa = track.sample(d, side * SW()), a = track.sample(d, side * sandEnd), b = track.sample(d, side * far);
        pos.push([a.x, level, a.z, b.x, level, b.z]);
        sandPos.push([sa.x, sa.y - 0.15, sa.z, a.x, level + 0.25, a.z]); // beach slopes from the kerb down to the water
      }
      flush();
    }
    function strip(rows, mat) {
      if (rows.length < 2) return;
      const v = [];
      for (let i = 0; i < rows.length - 1; i++) {
        const [ax, ay, az, bx, by, bz] = rows[i], [cx, cy, cz, dx, dy, dz] = rows[i + 1];
        v.push(ax, ay, az, bx, by, bz, dx, dy, dz, ax, ay, az, dx, dy, dz, cx, cy, cz);
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); g.computeVertexNormals();
      const mesh = new THREE.Mesh(g, mat); mesh.material.side = THREE.DoubleSide; mesh.name = mat === water ? 'water' : 'sand'; scene.add(mesh);
    }
  }

  // --- elevated metro: viaduct, pillars, stations and a running train
  let train = null;
  if (T.metro) {
    const M = T.metro, side = M.side;
    const span = track.finishDist - track.startDist;
    const d0 = track.startDist + M.from * span, d1 = track.startDist + M.to * span;
    const lat = side * 12, y = 11.4;
    const concrete = new THREE.MeshStandardMaterial({ color: 0x8f8d88, roughness: 0.85, side: THREE.DoubleSide });
    const deck = [], piers = [], stripe = [];
    let prev = null;
    for (let d = d0; d <= d1; d += 6) {
      const p = track.sample(d, lat);
      if (prev) {
        const len = Math.hypot(p.x - prev.x, p.z - prev.z);
        const mx = (p.x + prev.x) / 2, mz = (p.z + prev.z) / 2, yaw = Math.atan2(p.x - prev.x, p.z - prev.z);
        const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(mx, (p.y + prev.y) / 2, mz);
        deck.push(new THREE.BoxGeometry(8, 1.2, len + 0.05).translate(0, y, 0).applyMatrix4(m));
        for (const sx of [-1, 1]) {
          deck.push(new THREE.BoxGeometry(0.35, 1.4, len + 0.05).translate(sx * 3.9, y + 1.3, 0).applyMatrix4(m));
          stripe.push(new THREE.BoxGeometry(0.06, 0.35, len + 0.05).translate(sx * 4.12, y + 0.1, 0).applyMatrix4(m));
        }
      }
      prev = p;
    }
    for (let d = d0 + 10; d < d1; d += 30) {
      const p = track.sample(d, lat);
      const m = new THREE.Matrix4().makeRotationY(p.yaw).setPosition(p.x, p.y, p.z);
      piers.push(new THREE.BoxGeometry(1.6, y - 0.6, 1.6).translate(0, (y - 0.6) / 2, 0).applyMatrix4(m));
      piers.push(new THREE.BoxGeometry(6, 0.9, 2).translate(0, y - 1, 0).applyMatrix4(m));
    }
    scene.add(new THREE.Mesh(mergeGeometries(deck.map((g) => g.toNonIndexed())), concrete));
    scene.add(new THREE.Mesh(mergeGeometries(piers), concrete));
    scene.add(new THREE.Mesh(mergeGeometries(stripe), new THREE.MeshBasicMaterial({ color: new THREE.Color(M.color).multiplyScalar(2.4) })));
    // stations
    for (const [name, f] of M.stations) {
      const d = track.startDist + f * span;
      const p = track.sample(d, lat);
      const g = new THREE.Group(); g.position.set(p.x, p.y, p.z); g.rotation.y = p.yaw;
      const body = new THREE.Mesh(new THREE.BoxGeometry(14, 6, 70), new THREE.MeshStandardMaterial({ color: 0xd8d4cc, roughness: 0.7 })); body.position.y = y + 3.2; g.add(body);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(16, 0.6, 74), new THREE.MeshStandardMaterial({ color: 0x5a5f66 })); roof.position.y = y + 6.6; g.add(roof);
      const glow = new THREE.Mesh(new THREE.BoxGeometry(14.2, 0.5, 70.2), new THREE.MeshBasicMaterial({ color: new THREE.Color(M.color).multiplyScalar(2.2) })); glow.position.y = y + 1.2; g.add(glow);
      const [c, x] = canvas(1024, 160);
      x.fillStyle = '#0c1f3a'; x.fillRect(0, 0, 1024, 160); x.fillStyle = M.color; x.fillRect(0, 0, 1024, 16);
      x.textAlign = 'center'; x.fillStyle = '#ffffff'; x.textBaseline = 'middle';
      x.font = '900 64px "Arial Black", Impact, sans-serif'; x.fillText(name, 512, 66);
      x.font = `700 34px ${FONTS[T.lang]}, Arial`; x.fillText(M.name, 512, 128);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(22, 3.4), new THREE.MeshBasicMaterial({ map: tex(c), color: new THREE.Color(1.3, 1.3, 1.3), side: THREE.DoubleSide }));
      sign.position.set(-side * 7.2, y + 4.4, 0); sign.rotation.y = Math.PI / 2; g.add(sign);
      scene.add(g);
    }
    // the line's real train shuttling along the viaduct (metro.js), its livery from the theme
    const tr = buildTrain({ ...M.train, font: FONTS[T.lang] }, M.train.cars);
    for (const m of tr.meshes) scene.add(m); // userData.dynamic: moved every frame, kept out of static chunking
    const mtx = new THREE.Matrix4(), qq = new THREE.Quaternion(), pv = new THREE.Vector3(), sv = new THREE.Vector3(1, 1, 1), yAxis = new THREE.Vector3(0, 1, 0), tmp = {};
    const cars = M.train.cars, trainLen = cars * tr.carLength, len = d1 - d0 - trainLen - 60;
    train = (t) => {
      const ph = (t * 16) % (2 * len); // ~58 km/h, reversing at the line's ends
      const dir = ph < len ? 1 : -1;
      const head = d0 + 30 + (dir > 0 ? trainLen + ph : 2 * len - ph);
      for (let i = 0; i < cars; i++) {
        const s = track.sample(head - dir * (i + 0.5) * tr.carLength, lat, tmp);
        qq.setFromAxisAngle(yAxis, s.yaw + (dir > 0 ? 0 : Math.PI));
        tr.place(i, mtx.compose(pv.set(s.x, s.y + y + 0.75, s.z), qq, sv));
      }
      tr.done();
    };
  }

  // --- tea stalls / kiosks on the footpath
  if (T.kiosks) {
    const body = [], fronts = [], fu = [], awn = [];
    const [c, x] = canvas(128, 128);
    x.fillStyle = '#fff1c8'; x.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 6; i++) { x.fillStyle = FLEX[i]; x.fillRect(8 + i * 20, 20, 14, 40); }
    x.fillStyle = '#5a3a1a'; x.fillRect(0, 90, 128, 38);
    for (let d = 80; d < L - 60; d += 70 + r() * 160) {
      const side = r() < 0.5 ? 1 : -1;
      if (ws(d) === side) continue;
      const p = track.sample(d, side * (SW() - 1.3));
      const nx = -side * p.tz, nz = side * p.tx;
      const m = new THREE.Matrix4().makeRotationY(Math.atan2(nx, nz)).setPosition(p.x, p.y + 0.17, p.z);
      body.push(new THREE.BoxGeometry(2.4, 2.2, 1.6).translate(0, 1.1, 0).applyMatrix4(m));
      awn.push(new THREE.BoxGeometry(3, 0.08, 2.2).translate(0, 2.45, 0.5).applyMatrix4(m));
      quad(fronts, fu, null, [p.x + nx * 0.82, p.y + 1.25, p.z + nz * 0.82], [nz, 0, -nx], up, 2.2, 1.6, 0, 0, 1, 1);
      reflections.push([p.x + nx * 6, p.z + nz * 6, p.tx, p.tz, 6, 2, [1, 0.9, 0.6], 0.3]);
    }
    if (body.length) {
      scene.add(new THREE.Mesh(mergeGeometries(body), new THREE.MeshLambertMaterial({ color: 0x2f6f3a })));
      scene.add(new THREE.Mesh(mergeGeometries(awn), new THREE.MeshLambertMaterial({ color: 0x1f5fbf })));
      scene.add(new THREE.Mesh(geo(fronts, fu), new THREE.MeshBasicMaterial({ map: tex(c), color: new THREE.Color(1.3, 1.25, 1.1) })));
    }
  }

  // --- hairpin chevrons + cat's-eye reflectors on the ghat
  if (T.hairpins) {
    const chev = [], cu = [];
    const [c, x] = canvas(128, 64);
    x.fillStyle = '#f4c20d'; x.fillRect(0, 0, 128, 64); x.fillStyle = '#111';
    for (let i = 0; i < 3; i++) { x.beginPath(); x.moveTo(14 + i * 38, 8); x.lineTo(40 + i * 38, 32); x.lineTo(14 + i * 38, 56); x.lineTo(26 + i * 38, 56); x.lineTo(52 + i * 38, 32); x.lineTo(26 + i * 38, 8); x.fill(); }
    for (let i = 10; i < track.n - 10; i += 6) {
      const k = track.curv[i];
      if (Math.abs(k) < 1 / 45) continue;
      const out = k > 0 ? -1 : 1; // outside of the bend
      const d = track.cum[i];
      const p = track.sample(d, out * (HW + 1.5));
      quad(chev, cu, null, [p.x, p.y + 1.4, p.z], out > 0 ? [p.tx, 0, p.tz] : [-p.tx, 0, -p.tz], up, 1.6, 0.8, 0, 0, 1, 1);
    }
    if (chev.length) scene.add(new THREE.Mesh(geo(chev, cu), new THREE.MeshBasicMaterial({ map: tex(c), color: new THREE.Color(1.4, 1.4, 1.4), side: THREE.DoubleSide })));
  }
  if (T.reflectors) {
    const pts = [];
    for (let d = 5; d < L; d += 10) for (const lat of [0, HW - 0.4, -(HW - 0.4)]) pts.push(track.sample(d, lat));
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(0.18, 0.05, 0.18), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.4, 0.6) }), pts.length);
    const m = new THREE.Matrix4();
    pts.forEach((p, i) => im.setMatrixAt(i, m.makeTranslation(p.x, p.y + 0.05, p.z)));
    scene.add(im);
  }

  // --- roadside hoardings
  if (T.hoardings) {
    const ads = boardAtlas(T, rng(77));
    const hp = [], hu = [], poles = [];
    for (let d = 200; d < L - 100; d += 380 + r() * 300) {
      const side = r() < 0.5 ? 1 : -1;
      if (ws(d) === side) continue;
      const p = track.sample(d, side * (SW() + 3));
      const m = ads.meta[Math.floor(r() * ads.meta.length)];
      const fwd = [-p.tx, 0, -p.tz]; // face oncoming drivers
      const right = [fwd[2], 0, -fwd[0]];
      quad(hp, hu, null, [p.x, p.y + 9, p.z], right, up, 14, 14 / 8 * 2.2, m.u0, m.v0, m.u1, m.v1);
      for (const s of [-4, 4]) poles.push(new THREE.CylinderGeometry(0.2, 0.2, 9, 6).translate(p.x + right[0] * s, p.y + 4.5, p.z + right[2] * s));
      reflections.push([track.sample(d).x, track.sample(d).z, p.tx, p.tz, 14, 3, rgb(m.color), 0.25]);
    }
    if (hp.length) {
      scene.add(new THREE.Mesh(geo(hp, hu), new THREE.MeshBasicMaterial({ map: ads.tex, color: new THREE.Color(1.3, 1.3, 1.3), side: THREE.DoubleSide })));
      scene.add(new THREE.Mesh(mergeGeometries(poles), new THREE.MeshLambertMaterial({ color: 0x333333 })));
    }
  }

  buildShared(scene, track, world, r, { skipPoles: (d, side) => T.metro && side === T.metro.side });
  const landmarks = buildLandmarks(scene, track, T, plans, world.groundY);
  const refl = buildReflections(scene, track, world, reflections);
  return {
    setWet: refl.setWet,
    update: (t) => { train?.(t); landmarks(t); },
  };
}
