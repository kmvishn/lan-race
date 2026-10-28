import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FONTS } from './themes.js';

// A modern 12 m low-entry city bus (Volvo 8400LE / Tata Starbus / Switch EiV12 class) built in code, so every city's
// fleet gets its real livery: the body is the side profile (raked windscreen, rounded roof) extruded across the width
// with rounded edges, textured from one atlas with the kerb (left) side, the off side, front and back. ~1.5k triangles.
export const BUS_L = 12, BUS_W = 2.55;
const Y0 = 0.35, YH = 3.15, FRONT_AXLE = BUS_L / 2 - 2.55, REAR_AXLE = -BUS_L / 2 + 3.4;
const S = 1024; // atlas: kerb side rows 0-300, off side 300-600, front 0-400 x 600-1000, back 400-800, roof 800-1024

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function tex(c) { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }
const colored = (g, c) => {
  g = g.index ? g.toNonIndexed() : g;
  const a = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < a.length; i += 3) { a[i] = c[0]; a[i + 1] = c[1]; a[i + 2] = c[2]; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k);
  return g;
};
const box = (sx, sy, sz, x, y, z, c) => colored(new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z), c);

// Livery atlas. L: { top, bottom, stripe, name, local, lang, routes, ac, window? }
function atlas(L) {
  const [c, x] = canvas(S, S), [e, y] = canvas(S, S);
  x.fillStyle = L.top; x.fillRect(0, 0, S, S);
  y.fillStyle = '#000'; y.fillRect(0, 0, S, S);
  const row = (h, oy, H = 300) => oy + H * (1 - (h - Y0) / (YH - Y0)); // body height (m) -> canvas row
  const col = (z, kerb) => (kerb ? (BUS_L / 2 - z) / BUS_L : (z + BUS_L / 2) / BUS_L) * S; // body z (m) -> column
  const route = L.routes[Math.floor(Math.random() * L.routes.length)];
  for (const [oy, kerb] of [[0, true], [300, false]]) {
    // lower body, stripe, window band with pillars (lit saloon at night), wheel arches, doors on the kerb side
    x.fillStyle = L.bottom; x.fillRect(0, row(1.3, oy), S, row(Y0, oy) - row(1.3, oy));
    x.fillStyle = L.stripe; x.fillRect(0, row(1.42, oy), S, row(1.3, oy) - row(1.42, oy));
    x.fillStyle = L.window || '#11161c'; x.fillRect(0, row(2.78, oy), S, row(1.58, oy) - row(2.78, oy));
    const glass = (z0, z1) => { const a = col(z0, kerb), b = col(z1, kerb); const l = Math.min(a, b), w = Math.abs(b - a);
      x.fillStyle = '#26303a'; x.fillRect(l + 3, row(2.72, oy), w - 6, row(1.64, oy) - row(2.72, oy));
      y.fillStyle = '#ffeccc'; y.fillRect(l + 5, row(2.68, oy), w - 10, row(1.7, oy) - row(2.68, oy));
      y.fillStyle = 'rgba(40,30,20,0.55)'; for (let p = l + 14; p < l + w - 20; p += 34) y.fillRect(p, row(2.25, oy), 16, row(1.7, oy) - row(2.25, oy)); };
    for (let z = -BUS_L / 2 + 0.35; z < BUS_L / 2 - 1.2; z += 1.42) glass(z, Math.min(z + 1.36, BUS_L / 2 - 1.1));
    for (const az of [FRONT_AXLE, REAR_AXLE]) { x.fillStyle = '#0c0d0f'; x.beginPath(); x.arc(col(az, kerb), row(Y0, oy), 0.66 / BUS_L * S, Math.PI, 0); x.fill(); }
    if (kerb) for (const [z0, z1] of [[BUS_L / 2 - 2.05, BUS_L / 2 - 0.85], [-0.4, 0.85]]) { // front door ahead of the axle, centre door
      const a = col(z1, true), b = col(z0, true);
      x.fillStyle = '#1a2129'; x.fillRect(a, row(2.8, oy), b - a, row(Y0 + 0.05, oy) - row(2.8, oy));
      x.fillStyle = '#9aa4ad'; x.fillRect((a + b) / 2 - 1, row(2.8, oy), 2, row(Y0 + 0.05, oy) - row(2.8, oy));
      y.fillStyle = '#d8e6ff'; y.fillRect(a + 4, row(2.7, oy), b - a - 8, row(1.2, oy) - row(2.7, oy));
    }
    // operator name, local-script name, route on a small LED board up front
    // each label scaled into its own slot along the lower body so the two never overlap
    const label = (text, font, z0, z1) => {
      const a0 = Math.min(col(z0, kerb), col(z1, kerb)), w = Math.abs(col(z1, kerb) - col(z0, kerb));
      x.font = font; const tw = x.measureText(text).width, k = Math.min(1, (w - 10) / tw);
      x.save(); x.translate(a0 + w / 2, row(0.82, oy)); x.scale(k, 1); x.textAlign = 'center'; x.fillText(text, 0, 0); x.restore();
    };
    x.textBaseline = 'middle'; x.fillStyle = L.text || '#ffffff';
    // slots clear of the doors (kerb side) and the wheel arches
    label(L.name, '900 46px "Arial Black", Impact, sans-serif', kerb ? -3.4 : 2.5, kerb ? -5.8 : -0.5);
    label(L.local, `700 30px ${FONTS[L.lang]}, Arial`, kerb ? -0.5 : -3.4, kerb ? -1.9 : -5.8);
    const lz = kerb ? col(BUS_L / 2 - 2.3, true) : col(BUS_L / 2 - 2.3, false) - 150;
    x.fillStyle = '#050505'; x.fillRect(lz, row(3.02, oy), 150, row(2.84, oy) - row(3.02, oy));
    y.fillStyle = '#ff9a1a'; y.font = '700 20px Arial'; y.textAlign = 'center'; y.textBaseline = 'middle'; y.fillText(route.split(' ')[0], lz + 75, row(2.93, oy));
  }
  // front: big raked windscreen, LED destination board, grille band, operator logo
  const fr = (h) => 600 + 400 * (1 - (h - Y0) / (YH - Y0));
  x.fillStyle = L.bottom; x.fillRect(0, fr(1.15), 400, fr(Y0) - fr(1.15));
  x.fillStyle = L.stripe; x.fillRect(0, fr(1.25), 400, fr(1.15) - fr(1.25));
  x.fillStyle = '#0f1419'; x.fillRect(14, fr(2.78), 372, fr(1.32) - fr(2.78));
  y.fillStyle = 'rgba(150,180,210,0.18)'; y.fillRect(14, fr(2.78), 372, fr(1.32) - fr(2.78));
  x.fillStyle = '#000'; x.fillRect(30, fr(3.08), 340, fr(2.82) - fr(3.08));
  y.fillStyle = '#ff9a1a'; y.font = '900 30px "Arial Black", Impact, sans-serif'; y.textAlign = 'center'; y.textBaseline = 'middle';
  const tw = y.measureText(route).width; y.save(); y.translate(200, (fr(3.08) + fr(2.82)) / 2); y.scale(Math.min(1, 320 / tw), 1); y.fillText(route, 0, 0); y.restore();
  x.fillStyle = '#1c1f23'; x.fillRect(120, fr(0.75), 160, fr(0.5) - fr(0.75));
  x.fillStyle = L.text || '#ffffff'; x.font = '900 34px "Arial Black", Impact, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(L.name.split(' ')[0], 200, fr(0.98));
  // back: small rear window, body colours, number board
  x.fillStyle = L.bottom; x.fillRect(400, fr(1.15), 400, fr(Y0) - fr(1.15));
  x.fillStyle = '#11161c'; x.fillRect(450, fr(2.7), 300, fr(1.95) - fr(2.7));
  x.fillStyle = '#000'; x.fillRect(470, fr(3.05), 260, fr(2.82) - fr(3.05));
  y.fillStyle = '#ff9a1a'; y.font = '900 26px "Arial Black", Impact, sans-serif'; y.fillText(route.split(' ')[0], 600, (fr(3.05) + fr(2.82)) / 2);
  x.fillStyle = '#f2f2f2'; x.fillRect(550, fr(0.9), 100, fr(0.7) - fr(0.9));
  x.fillStyle = '#9da3a9'; x.fillRect(800, 600, 224, 400); // roof
  return { map: tex(c), emissive: tex(e) };
}

// Body: side profile (z, y) extruded across the width with rounded edges; UVs by facing direction into the atlas.
function body() {
  const s = new THREE.Shape(), hl = BUS_L / 2, r = 0.12;
  s.moveTo(-hl + r, Y0 + r); s.lineTo(hl - 0.1, Y0 + r); s.lineTo(hl - r, 0.75); s.lineTo(hl - r, 1.3);
  s.lineTo(hl - 0.3, 2.85); s.lineTo(hl - 0.5, YH - r); s.lineTo(-hl + 0.3, YH - r); s.lineTo(-hl + r, 2.95); s.lineTo(-hl + r, Y0 + r);
  const g = new THREE.ExtrudeGeometry(s, { depth: BUS_W - 2 * r, bevelEnabled: true, bevelThickness: r, bevelSize: r, bevelSegments: 3, curveSegments: 4 })
    .rotateY(-Math.PI / 2).translate(BUS_W / 2 - r, 0, 0);
  const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
  for (let k = 0; k < p.count; k++) {
    const X = p.getX(k), Y = p.getY(k), Z = p.getZ(k), nx = n.getX(k), ny = n.getY(k), nz = n.getZ(k);
    const vRow = (oy, H) => 1 - (oy + H * (1 - (Y - Y0) / (YH - Y0))) / S;
    if (Math.abs(nx) > 0.55) { const kerb = nx > 0; uv.setXY(k, kerb ? (hl - Z) / BUS_L : (Z + hl) / BUS_L, vRow(kerb ? 0 : 300, 300)); }
    else if (ny > 0.6 || ny < -0.6) uv.setXY(k, (800 + (X / BUS_W + 0.5) * 224) / S, 1 - (600 + ((hl - Z) / BUS_L) * 400) / S);
    else if (nz > 0) uv.setXY(k, ((X / BUS_W + 0.5) * 400) / S, vRow(600, 400));
    else uv.setXY(k, (400 + (0.5 - X / BUS_W) * 400) / S, vRow(600, 400));
  }
  return g.toNonIndexed();
}

const wheel = (x, z) => [colored(new THREE.CylinderGeometry(0.52, 0.52, 0.3, 14).rotateZ(Math.PI / 2).translate(x, 0.52, z), [0.05, 0.05, 0.05]),
  colored(new THREE.CylinderGeometry(0.28, 0.28, 0.32, 10).rotateZ(Math.PI / 2).translate(x * 1.01, 0.52, z), [0.55, 0.57, 0.6])];

// Traffic model in the shape traffic.js expects: textured body + vertex-coloured extras + lamp geometries.
export function cityBus(L, HEAD, TAIL) {
  const A = atlas(L);
  const mat = new THREE.MeshStandardMaterial({ map: A.map, emissiveMap: A.emissive, emissive: 0xffffff, emissiveIntensity: 1.2, roughness: 0.4, metalness: 0.15 });
  const extra = [];
  for (const z of [FRONT_AXLE, REAR_AXLE]) for (const sx of [-1, 1]) extra.push(...wheel(sx * 1.08, z));
  for (const sx of [-1, 1]) { // "rabbit ear" mirrors hanging ahead of the windscreen
    extra.push(box(0.06, 0.06, 0.55, sx * 1.15, 2.95, BUS_L / 2 - 0.05, [0.06, 0.06, 0.06]));
    extra.push(box(0.1, 0.38, 0.16, sx * 1.12, 2.7, BUS_L / 2 + 0.2, [0.06, 0.06, 0.06]));
  }
  extra.push(box(BUS_W - 0.2, 0.22, 0.12, 0, Y0 + 0.15, BUS_L / 2 + 0.02, [0.08, 0.08, 0.09])); // bumper
  if (L.ac) extra.push(box(1.9, 0.3, 3.8, 0, YH + 0.13, -1.2, [0.82, 0.84, 0.86])); // roof AC / battery pod
  const head = [], tail = [];
  for (const s of [-1, 1]) {
    head.push(box(0.42, 0.14, 0.05, s * 0.9, 0.95, BUS_L / 2 + 0.01, HEAD));
    tail.push(box(0.16, 0.5, 0.05, s * 1.05, 1.05, -BUS_L / 2 - 0.01, TAIL));
  }
  return { geo: body(), extra: mergeGeometries(extra), head: mergeGeometries(head), tail: mergeGeometries(tail), dims: { w: BUS_W, l: BUS_L }, mat };
}
