import * as THREE from 'three';
import { HW } from './track.js';
import { BUILD, canvasTex, labelSign, dome, std, basic } from './landmarks.js';

// Real landmarks along the route (OpenStreetMap + Wikidata) with roadside photo boards (Wikimedia Commons).
const SW = () => HW + 0.5 + 5; // sidewalk outer edge
const R = { church: 30, mosque: 30, heritage: 40, station: 50, stadium: 70, park: 35, campus: 45, hospital: 30, tower: 22, gopuram: 45, fort: 70, lighthouse: 25, mall: 80, techpark: 90, viewpoint: 20 };
const MAX_OFF = 160;

export function planPois(track, T, plans) {
  const out = [];
  for (const poi of T.pois || []) {
    if (plans.some((q) => Math.hypot(q.x - poi.x, q.z - poi.z) < (q.r || 40) + 90)) continue;
    const n = track.nearest(poi.x, poi.z);
    if (n.dist < track.startDist + 40 || n.dist > track.finishDist - 20) continue;
    let dx = poi.x - n.x, dz = poi.z - n.z;
    const off = Math.hypot(dx, dz) || 1;
    const r = R[poi.type] || 30;
    const want = Math.min(off, MAX_OFF, Math.max(SW() + r + 6, off));
    dx /= off; dz /= off;
    const x = n.x + dx * want, z = n.z + dz * want;
    const side = Math.sign(n.lateral) || 1;
    out.push({ ...poi, x, z, r, yaw: Math.atan2(-dx, -dz), d: n.dist, side });
  }
  return out;
}

const cream = () => std(0xeee4cc);
const box = (g, mat, w, h, d, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y + h / 2, z); g.add(m); return m; };
const cyl = (g, mat, r0, r1, h, x = 0, y = 0, z = 0, seg = 12) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, seg), mat); m.position.set(x, y + h / 2, z); g.add(m); return m; };
function gable(g, mat, w, h, d, y, z = 0) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(w / Math.SQRT2, w / Math.SQRT2, d, 4, 1), mat);
  m.rotation.set(Math.PI / 2, Math.PI / 4, 0); m.scale.set(1, 1, h / (w / 2)); m.position.set(0, y, z); g.add(m);
  return m;
}
function windows(cols, rows, lit = '#ffd890', wall = '#e8dcc0', arch = false) {
  const t = canvasTex(256, 256, (x, w, h) => {
    x.fillStyle = wall; x.fillRect(0, 0, w, h);
    const cw = w / cols, rh = h / rows;
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      x.fillStyle = Math.random() < 0.6 ? lit : '#2a2620';
      const X = i * cw + cw * 0.3, Y = j * rh + rh * 0.25, W = cw * 0.4, H = rh * 0.55;
      x.beginPath();
      if (arch) { x.moveTo(X, Y + H); x.lineTo(X, Y + W / 2); x.arc(X + W / 2, Y + W / 2, W / 2, Math.PI, 0); x.lineTo(X + W, Y + H); } else x.rect(X, Y, W, H);
      x.fill();
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return new THREE.MeshLambertMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.35 });
}

const POI_BUILD = {
  church(p) {
    const g = new THREE.Group(), white = windows(5, 2, '#ffd27a', '#f2efe6', true), roof = std(0x8a3324);
    box(g, white, 16, 13, 30, 0, 0, -6);
    gable(g, roof, 17, 5, 31, 13, -6);
    box(g, white, 8, 24, 8, 0, 0, 11);
    const sp = new THREE.Mesh(new THREE.ConeGeometry(4.6, 12, 4), std(0x5c6670)); sp.rotation.y = Math.PI / 4; sp.position.set(0, 30, 11); g.add(sp);
    const glow = basic(0xfff2c8, 3);
    box(g, glow, 0.5, 3.4, 0.5, 0, 36, 11); box(g, glow, 2.2, 0.5, 0.5, 0, 38, 11);
    return g;
  },
  mosque(p) {
    const g = new THREE.Group(), wall = windows(6, 2, '#bfffd0', '#f4f1ea', true), green = std(0x2f8f5a, { roughness: 0.5 });
    box(g, wall, 30, 11, 22);
    const d = dome(8, 9, green); d.position.y = 11; g.add(d);
    for (const sx of [-17, 17]) {
      cyl(g, cream(), 1.3, 1.6, 30, sx, 0, 9);
      const md = dome(1.6, 2.4, green); md.position.set(sx, 30, 9); g.add(md);
      cyl(g, basic(0x7dffb0, 2.5), 1.75, 1.75, 0.4, sx, 22, 9);
    }
    return g;
  },
  heritage(p) {
    const g = new THREE.Group(), wall = windows(10, 3, '#ffcf80', '#c9583a', true), stone = cream();
    box(g, wall, 54, 15, 22);
    for (let i = -5; i <= 5; i++) cyl(g, stone, 0.7, 0.7, 9, i * 4.6, 0, 12, 8);
    box(g, stone, 52, 1.2, 4, 0, 9, 12);
    box(g, wall, 12, 10, 12, 0, 15, 0);
    const d = dome(6, 7, stone); d.position.y = 25; g.add(d);
    for (const sx of [-24, 24]) { const dm = dome(2.4, 4, stone); dm.position.set(sx, 15, 8); g.add(dm); }
    return g;
  },
  station(p) {
    const g = new THREE.Group();
    box(g, windows(12, 1, '#fff2c0', '#e7d9b6'), 60, 8, 14, 0, 0, -10);
    const roof = new THREE.MeshLambertMaterial({ color: 0x8b8f96 });
    box(g, roof, 120, 0.5, 9, 0, 6.5, 4);
    for (let i = -7; i <= 7; i++) cyl(g, std(0x2e5aa8), 0.25, 0.25, 6.5, i * 8, 0, 4, 6);
    box(g, cream(), 120, 1, 9, 0, 0, 4);
    const t = canvasTex(1024, 192, (x, W, H) => {
      x.fillStyle = '#f7c900'; x.fillRect(0, 0, W, H); x.strokeStyle = '#111'; x.lineWidth = 10; x.strokeRect(5, 5, W - 10, H - 10);
      x.fillStyle = '#111'; x.textAlign = 'center'; x.textBaseline = 'middle';
      const name = p.name.replace(/\s*(railway|metro)?\s*station$/i, '').toUpperCase();
      x.font = '900 96px Arial, sans-serif'; const tw = x.measureText(name).width; x.save(); x.translate(W / 2, H / 2 + 6); x.scale(Math.min(1, (W - 60) / tw), 1); x.fillText(name, 0, 0); x.restore();
    });
    for (const sx of [-30, 30]) {
      const b = new THREE.Mesh(new THREE.PlaneGeometry(12, 2.25), new THREE.MeshBasicMaterial({ map: t, color: new THREE.Color(1.2, 1.2, 1.2) })); b.position.set(sx, 4.5, 8.6); g.add(b);
      for (const k of [-5, 5]) cyl(g, std(0x222222), 0.12, 0.12, 4.5, sx + k, 0, 8.5, 6);
    }
    return g;
  },
  stadium() {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(42, 46, 16, 40, 1, true), new THREE.MeshLambertMaterial({ color: 0xbfc3c9, side: THREE.DoubleSide }));
    ring.scale.z = 0.7; ring.position.y = 8; g.add(ring);
    const pitch = new THREE.Mesh(new THREE.CircleGeometry(40, 32), new THREE.MeshLambertMaterial({ color: 0x2f7a2f })); pitch.rotation.x = -Math.PI / 2; pitch.scale.y = 0.7; pitch.position.y = 0.3; g.add(pitch);
    for (const [x, z] of [[-44, -26], [44, -26], [-44, 26], [44, 26]]) {
      cyl(g, std(0x555555), 0.6, 0.9, 34, x, 0, z, 6);
      box(g, basic(0xffffff, 4), 6, 3, 0.6, x, 34, z).lookAt(0, 0, 0);
    }
    return g;
  },
  park() {
    const g = new THREE.Group(), leaf = new THREE.MeshLambertMaterial({ color: 0x2c5a24 }), trunk = std(0x4a3626);
    for (let i = 0; i < 22; i++) {
      const a = i * 2.4, r = 6 + (i * 37 % 26);
      const x = Math.cos(a) * r, z = Math.sin(a) * r - 6, h = 4 + (i % 4);
      cyl(g, trunk, 0.3, 0.4, h, x, 0, z, 5);
      const c = new THREE.Mesh(new THREE.IcosahedronGeometry(3 + (i % 3), 0), leaf); c.position.set(x, h + 2, z); g.add(c);
    }
    for (const sx of [-6, 6]) cyl(g, cream(), 0.6, 0.6, 6, sx, 0, 26, 8);
    box(g, std(0x2e6a3a), 14, 1.6, 1, 0, 6, 26);
    return g;
  },
  campus() {
    const g = new THREE.Group(), brick = windows(10, 4, '#fff0c0', '#9a4a32');
    box(g, brick, 46, 18, 20, 0, 0, -12);
    box(g, brick, 18, 14, 34, -30, 0, -4);
    box(g, brick, 18, 14, 34, 30, 0, -4);
    box(g, cream(), 8, 26, 8, 0, 0, -1);
    const c = new THREE.Mesh(new THREE.CircleGeometry(2.4, 24), basic(0xfff6d8, 2)); c.position.set(0, 22, 3.05); g.add(c);
    return g;
  },
  hospital() {
    const g = new THREE.Group();
    box(g, windows(8, 6, '#e8fbff', '#eef2f4'), 36, 26, 22);
    box(g, windows(6, 2, '#e8fbff', '#eef2f4'), 44, 6, 28);
    const red = basic(0xff2a2a, 3);
    box(g, red, 6, 1.8, 0.5, 0, 28, 11.3); box(g, red, 1.8, 6, 0.5, 0, 26, 11.3);
    return g;
  },
  tower() {
    const g = new THREE.Group();
    box(g, windows(6, 9, '#ffe3a8', '#d9d2c4'), 22, 30, 20);
    box(g, basic(0xffd27a, 2), 22.4, 0.6, 20.4, 0, 30, 0);
    return g;
  },
};

// Billboard with the real photo, name and attribution.
function photoBoard(p, track, groundY) {
  const s = track.sample(p.d, p.side * (SW() + 3.5));
  const W = 1024, H = 640;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; tex.userData.live = true; // redrawn when the photo arrives
  const strip = (img) => {
    x.fillStyle = '#10141c'; x.fillRect(0, 0, W, H);
    if (img) {
      const ph = H - 150, k = Math.max(W / img.width, ph / img.height), iw = img.width * k, ih = img.height * k;
      x.save(); x.beginPath(); x.rect(0, 0, W, ph); x.clip(); x.drawImage(img, (W - iw) / 2, (ph - ih) / 2, iw, ih); x.restore();
    }
    x.fillStyle = '#ffb400'; x.fillRect(0, H - 150, W, 8);
    x.fillStyle = '#fff'; x.textBaseline = 'middle';
    x.font = '900 60px Arial, sans-serif';
    const name = p.name.toUpperCase(), tw = x.measureText(name).width;
    x.save(); x.translate(28, H - 95); x.scale(Math.min(1, (W - 56) / tw), 1); x.fillText(name, 0, 0); x.restore();
    if (p.credit) { x.font = '28px Arial, sans-serif'; x.fillStyle = '#aab3c4'; x.fillText(('Photo: ' + p.credit).slice(0, 80), 28, H - 36); }
    tex.needsUpdate = true;
  };
  strip(null);
  if (p.file) { const img = new Image(); img.onload = () => strip(img); img.src = p.file; }
  const g = new THREE.Group();
  g.position.set(s.x, s.y, s.z);
  g.rotation.y = Math.atan2(-s.tx, -s.tz);
  const bw = 10, bh = bw * H / W;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(bw, bh), new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.15, 1.15, 1.15) }));
  face.position.y = 4 + bh / 2; g.add(face);
  const back = new THREE.Mesh(new THREE.BoxGeometry(bw + 0.4, bh + 0.4, 0.3), std(0x22252b)); back.position.set(0, 4 + bh / 2, -0.2); g.add(back);
  for (const sx of [-3, 3]) cyl(g, std(0x333333), 0.18, 0.18, 4 + (groundY(s.x, s.z) < s.y ? 3 : 0), sx, groundY(s.x, s.z) < s.y ? -3 : 0, -0.3, 6);
  return g;
}

export function buildPois(scene, track, T, pois, groundY) {
  for (const p of pois) {
    const make = POI_BUILD[p.type] || (BUILD[p.type] && ((q) => BUILD[q.type](T, { ...q, label: q.name.toUpperCase() })));
    if (make) {
      const obj = make(p);
      obj.position.set(p.x, groundY(p.x, p.z), p.z);
      obj.rotation.y = p.yaw;
      const box3 = new THREE.Box3().setFromObject(obj);
      if (!BUILD[p.type] || p.type === 'gopuram' || p.type === 'fort' || p.type === 'lighthouse') {
        const sign = labelSign(p.name.toUpperCase(), null, '#ffd27a', 26);
        sign.position.set(p.x, box3.max.y + 4, p.z); sign.rotation.y = p.yaw;
        scene.add(sign);
      }
      scene.add(obj);
    }
    scene.add(photoBoard(p, track, groundY));
  }
}
