import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng, HW } from './track.js';
import { gltfLoader, normalizeVehicle, autoWheels, riderGeometry, riderParts, loadRider, recolorMaterials, sanitizeMaterials, MAT } from './cars.js';
import { collide } from './physics.js';
import { FONTS } from './themes.js';
import { cityBus } from './citybus.js';

const KENNEY_SCALE = 1.8; // kit is toy-scale (~2.5m sedans)
const KENNEY = ['sedan', 'taxi', 'suv', 'suv-luxury', 'van', 'truck', 'delivery', 'garbage-truck', 'ambulance', 'sedan-sports', 'hatchback-sports', 'firetruck'];
// Real-world masses (kg) drive collision outcomes.
export const MASS = {
  sedan: 1250, taxi: 1250, suv: 2000, 'suv-luxury': 2200, van: 2100, truck: 2200, delivery: 2500, 'garbage-truck': 9000, ambulance: 3000,
  'sedan-sports': 1350, 'hatchback-sports': 1100, firetruck: 12000, auto: 450, scooter: 220, bike: 200, bus: 12000, lorry: 10000,
};
const HEAD = [4, 3.8, 3.2], TAIL = [1.4, 0.03, 0.01];
const DELIVERY = [0xf27a1a, 0xe23744, 0x2fa84f, 0xf2c200, 0x1f6fd0];
const RIDER = [0x2b3a55, 0x6b1f1f, 0x1f4a2b, 0x444444, 0x8a6a2a, 0xdddddd];
const PAINT = [0xe8e8e8, 0xb9bcc2, 0x1a1c20, 0x7a1f1f, 0x1d2b4f, 0x55595f, 0xc9b28a, 0x2a5a3a];

const LOOP_LANES = [-6.75, -2.25, 2.25, 6.75], LOOP_SPEED = [15, 19, 23, 27];
const LOOP_SLOW = ['truck', 'delivery', 'garbage-truck', 'van', 'sedan', 'firetruck'];
const LOOP_FAST = ['sedan', 'sedan', 'taxi', 'taxi', 'suv', 'suv-luxury', 'van', 'sedan-sports', 'hatchback-sports', 'ambulance'];
// Driver model per vehicle class (Intelligent Driver Model): desired speed m/s (+/- spread), max accel, comfy braking,
// time headway, standstill gap, lateral grip for curve speed, slowdown factor per unit uphill grade, lane-change rate m/s.
const CLASS = {
  tw: { v: 13.5, vr: 0.25, a: 2.2, b: 3.5, T: 0.8, s0: 1.2, alat: 3.2, g: 3, lc: 1.8, wob: 0.22 },
  auto: { v: 11, vr: 0.15, a: 1.0, b: 2.5, T: 1.1, s0: 1.8, alat: 2.2, g: 9, lc: 1.0, wob: 0.12 },
  car: { v: 17, vr: 0.22, a: 1.8, b: 3.0, T: 1.3, s0: 2.0, alat: 3.2, g: 1.5, lc: 1.0, wob: 0.03 },
  heavy: { v: 13, vr: 0.1, a: 0.7, b: 2.0, T: 1.7, s0: 3.0, alat: 1.6, g: 14, lc: 0.7, wob: 0.02 },
};
const classOf = (type) => {
  const t = type.replace('real:', '');
  return t === 'scooter' || t === 'bike' || REAL[t]?.ride ? 'tw' : t === 'auto' ? 'auto'
    : /^(bus|lorry|garbage-truck|firetruck|viking|citybus|keralabus|ksrtc|tata|eicher|tractor)/.test(t) ? 'heavy' : 'car';
};
const isBusType = (type) => /bus|viking|ksrtc/.test(type);
// On-road vehicle mix per route (shares of vehicles) and vehicles per km per direction, from classified counts where
// published: Bengaluru intersection counts (>70% 2W, 15% car, 4% auto), Chennai arterial (58/26/12/4), Kochi mobility plan
// 2024 (~60% 2W, ~27% car) + RITES MG Road (14% auto, 11% bus), Hyderabad (50/16/16 auto/5 bus, 9% cycles folded into 2W),
// Kerala/Mysuru registration shares as proxies. Thamarassery ghat has no published counts: night-time mix with lorries,
// since multi-axle trucks may only use the ghat after 8 pm.
const MIX = {
  bengaluru: { tw: 0.68, car: 0.17, auto: 0.05, bus: 0.06, truck: 0.04, density: 15 },
  chennai: { tw: 0.56, car: 0.26, auto: 0.12, bus: 0.04, truck: 0.02, density: 13 },
  mysuru: { tw: 0.60, car: 0.22, auto: 0.08, bus: 0.05, truck: 0.05, density: 10 },
  kochi: { tw: 0.55, car: 0.27, auto: 0.10, bus: 0.07, truck: 0.01, density: 13 },
  trivandrum: { tw: 0.58, car: 0.25, auto: 0.08, bus: 0.06, truck: 0.03, density: 11 },
  kannur: { tw: 0.55, car: 0.25, auto: 0.08, bus: 0.06, truck: 0.06, density: 10 },
  hyderabad: { tw: 0.57, car: 0.17, auto: 0.17, bus: 0.06, truck: 0.03, density: 13 },
  wayanad: { tw: 0.18, car: 0.42, auto: 0.03, bus: 0.10, truck: 0.27, density: 8 },
};
const DT = 0.1, T0 = -12; // fixed sim step; every client replays the same deterministic sim from T0 on the race clock
function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const KIND_MODELS = { sedan: ['sedan'], suv: ['suv', 'suv-luxury'], hatch: ['hatchback-sports', 'sedan-sports'], van: ['van'], truck: ['truck', 'garbage-truck'], delivery: ['delivery'],
  auto: ['auto'], scooter: ['scooter'], bike: ['bike'], bus: ['bus'], lorry: ['lorry'] };

// Bus liveries: operator lettering, colours and real route boards per city.
const LIVERY = {
  // BMTC: Sarige ordinary in light blue/white (BS-VI) and the older dark blue/white, Vajra AC light blue (Volvo),
  // electric Astra buses in turquoise (JBM) or violet/white (Switch)
  bmtc: { top: '#f4f7fa', bottom: '#2f8fdc', stripe: '#1a5aa8', name: 'BMTC', local: 'ಬೆಂಗಳೂರು ಮಹಾನಗರ ಸಾರಿಗೆ ಸಂಸ್ಥೆ', lang: 'kn', routes: ['500D HEBBAL', '500DA KR PURAM', '500K KADUGODI', '290E MAJESTIC'] },
  'bmtc-blue': { top: '#eef2f6', bottom: '#1d3f9a', stripe: '#7fb6e8', name: 'BMTC', local: 'ಬೆಂಗಳೂರು ಮಹಾನಗರ ಸಾರಿಗೆ ಸಂಸ್ಥೆ', lang: 'kn', routes: ['500D HEBBAL', '500DA KR PURAM', '500K KADUGODI', '290E MAJESTIC'] },
  vajra: { top: '#5fb4ea', bottom: '#2c86cf', stripe: '#ffffff', name: 'VAJRA', local: 'ವಜ್ರ · BMTC', lang: 'kn', ac: true, routes: ['V-500D HEBBAL', 'V-500CA SILK BOARD', 'KIA-9 AIRPORT'] },
  'bmtc-ev': { top: '#f2f6f7', bottom: '#16b0a6', stripe: '#0d7f78', name: 'BMTC', local: 'ಎಲೆಕ್ಟ್ರಿಕ್ · ELECTRIC', lang: 'kn', ac: true, routes: ['500D HEBBAL', 'MF-1 METRO FEEDER', '500DA KR PURAM'] },
  'bmtc-ev2': { top: '#f4f2f8', bottom: '#6f3fa8', stripe: '#b39ad8', name: 'BMTC', local: 'ಎಲೆಕ್ಟ್ರಿಕ್ · ELECTRIC', lang: 'kn', ac: true, routes: ['500D HEBBAL', '290E MAJESTIC'] },
  // KSRTC Mysuru city: moving to sky blue/white from the older green and light red
  'ksrtc-ka': { top: '#f4f7fa', bottom: '#3fa4e0', stripe: '#1e6fb0', name: 'KSRTC', local: 'ನಗರ ಸಾರಿಗೆ · MYSURU', lang: 'kn', routes: ['201 CHAMUNDI HILLS', '150 CBS', '303 KRS DAM'] },
  'ksrtc-ka-old': { top: '#e8f0e4', bottom: '#2f8f3e', stripe: '#e05a5a', name: 'KSRTC', local: 'ನಗರ ಸಾರಿಗೆ · MYSURU', lang: 'kn', routes: ['201 CHAMUNDI HILLS', '150 CBS', '303 KRS DAM'] },
  'ksrtc-kl': { top: '#f2d23a', bottom: '#c41c1c', stripe: '#1a1a1a', name: 'KSRTC', local: 'കെ.എസ്.ആർ.ടി.സി', lang: 'ml', routes: ['FAST KOZHIKODE', 'KALPETTA', 'THALASSERY', 'VYTTILA', 'KOVALAM', 'EAST FORT'] },
  private: { top: '#ffffff', bottom: '#2a7de1', stripe: '#ff3d7f', name: 'SREE KRISHNA', local: 'ശ്രീ കൃഷ്ണ', lang: 'ml', routes: ['KANNUR', 'IRITTY', 'ALUVA', 'FORT KOCHI', 'VIZHINJAM'] },
  // MTC: ordinary brown and cream, deluxe red
  mtc: { top: '#efe2c0', bottom: '#6e3b1f', stripe: '#f2c200', name: 'MTC', local: 'மாநகர் போக்குவரத்துக் கழகம்', lang: 'ta', routes: ['23C BESANT NAGAR', '12B T.NAGAR', '5B BROADWAY'] },
  'mtc-deluxe': { top: '#f2ece6', bottom: '#b51f24', stripe: '#3a3a3a', name: 'MTC', local: 'மாநகர் போக்குவரத்துக் கழகம்', lang: 'ta', routes: ['23C BESANT NAGAR', '21G TAMBARAM', 'M70 ADYAR'] },
  tgsrtc: { top: '#f4f6f8', bottom: '#1e8a3a', stripe: '#d62828', name: 'TGSRTC', local: 'తెలంగాణ ఆర్టీసీ', lang: 'te', routes: ['1Z SECUNDERABAD', '8A AFZALGUNJ', '49M KOTI'] },
  'tgsrtc-ev': { top: '#eef6f0', bottom: '#2a9d5c', stripe: '#1f5fbf', name: 'TGSRTC', local: 'ఈ-మెట్రో · E-METRO', lang: 'te', ac: true, routes: ['1Z SECUNDERABAD', '127K KONDAPUR', '8A AFZALGUNJ'] },
};
const CITY_BUSES = { bengaluru: ['bmtc', 'bmtc', 'bmtc-blue', 'vajra', 'bmtc-ev', 'bmtc-ev2'], mysuru: ['ksrtc-ka', 'ksrtc-ka', 'ksrtc-ka-old'], chennai: ['mtc', 'mtc', 'mtc-deluxe'],
  hyderabad: ['tgsrtc', 'tgsrtc', 'tgsrtc-ev'],
  wayanad: ['ksrtc-kl'], kannur: ['ksrtc-kl', 'private', 'private'], kochi: ['ksrtc-kl', 'private'], trivandrum: ['ksrtc-kl', 'private'] };
// Destination boards that make sense on each route.
const CITY_ROUTES = {
  wayanad: { 'ksrtc-kl': ['FAST KOZHIKODE', 'KALPETTA', 'SULTHAN BATHERY', 'MANANTHAVADY', 'THAMARASSERY'] },
  kannur: { 'ksrtc-kl': ['FAST KOZHIKODE', 'THALASSERY', 'KANNUR', 'MANGALURU'], private: ['KANNUR', 'THALASSERY', 'IRITTY', 'THALIPARAMBA'] },
  kochi: { 'ksrtc-kl': ['VYTTILA', 'ALUVA', 'THRISSUR', 'EDAPPALLY'], private: ['FORT KOCHI', 'ALUVA', 'KAKKANAD', 'VYTTILA'] },
  trivandrum: { 'ksrtc-kl': ['KOVALAM', 'EAST FORT', 'VIZHINJAM', 'THAMPANOOR'], private: ['VIZHINJAM', 'KOVALAM', 'POOVAR'] },
};

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function tex(c) { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }
function colored(g, c) {
  g = g.index ? g.toNonIndexed() : g;
  g.deleteAttribute('uv');
  const n = g.attributes.position.count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set(c, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}
const box = (sx, sy, sz, x, y, z, c) => colored(new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z), c);
const wheel = (r, w, x, y, z, c = [0.05, 0.05, 0.05]) => colored(new THREE.CylinderGeometry(r, r, w, 12).rotateZ(Math.PI / 2).translate(x, y, z), c);
const ball = (r, x, y, z, c) => colored(new THREE.SphereGeometry(r, 10, 8).translate(x, y, z), c);

// Box whose six faces map to regions of a texture atlas: [right, left, top, bottom, front, back] as [u0,v0,u1,v1].
function atlasBox(sx, sy, sz, x, y, z, regions) {
  const g = new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z);
  const uv = g.attributes.uv;
  for (let k = 0; k < uv.count; k++) {
    const [u0, v0, u1, v1] = regions[Math.floor(k / 4)];
    uv.setXY(k, u0 + uv.getX(k) * (u1 - u0), v0 + uv.getY(k) * (v1 - v0));
  }
  return g.toNonIndexed();
}

function lightsGeo(d) {
  const y = Math.min(1.05, 0.3 * d.h + 0.25), head = [], tail = [];
  for (const s of [-1, 1]) {
    head.push(box(0.36, 0.13, 0.06, s * (d.w / 2 - 0.35), y, d.maxZ + 0.02, HEAD));
    tail.push(box(0.4, 0.12, 0.06, s * (d.w / 2 - 0.3), y, d.minZ - 0.02, TAIL));
  }
  return { head: mergeGeometries(head), tail: mergeGeometries(tail) };
}

function bake(gltf) {
  const wheelNames = ['wheel-front-left', 'wheel-front-right', 'wheel-back-left', 'wheel-back-right'];
  const { norm, dims } = normalizeVehicle(gltf.scene, wheelNames, KENNEY_SCALE);
  norm.updateMatrixWorld(true);
  const geos = [];
  let mat = null;
  norm.traverse((o) => {
    if (!o.isMesh) return;
    mat ||= o.material;
    const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    geos.push(g.index ? g.toNonIndexed() : g);
  });
  const l = lightsGeo(dims);
  return { geo: mergeGeometries(geos), mat, dims, head: l.head, tail: l.tail };
}

// Real Indian traffic (Sketchfab CC models, scripts/fetch-vehicles.py): length (m) to scale to, mass (kg), rider pose.
const REAL = {
  swift: { len: 3.86, mass: 920 }, dzire: { len: 3.995, mass: 960 }, baleno: { len: 3.99, mass: 935 }, city: { len: 4.58, mass: 1110 },
  creta: { len: 4.33, mass: 1350 }, scorpio: { len: 4.46, mass: 1900 }, innova: { len: 4.585, mass: 1700, yaw: 180 }, wagonr: { len: 3.66, mass: 850, yaw: 180 },
  bolero: { len: 3.995, mass: 1600 }, ertiga: { len: 4.4, mass: 1150 }, punch: { len: 3.83, mass: 1030 },
  seltos: { len: 4.365, mass: 1350 }, xuv3xo: { len: 3.99, mass: 1360 }, xuv700: { len: 4.7, mass: 1900 }, ambassador: { len: 4.33, mass: 1160 },
  eeco: { len: 3.68, mass: 940 }, fz: { len: 1.99, mass: 210, ride: 'naked', yaw: 180 }, rx100: { len: 1.93, mass: 180, ride: 'naked' },
  tataace: { len: 3.8, mass: 1600, vmax: 15 },
  eicher: { len: 7.0, mass: 9000 }, tractor: { len: 3.7, mass: 2500, vmax: 7 },
  activa: { len: 1.83, mass: 180, ride: 'scooter', yaw: 180 }, scooter125: { len: 1.87, mass: 180, ride: 'scooter', yaw: 180 }, olaev: { len: 1.86, mass: 190, ride: 'scooter' },
  deliveryev: { len: 1.8, mass: 200, ride: 'scooter' }, pulsar: { len: 2.06, mass: 220, ride: 'naked' }, apache: { len: 2.08, mass: 215, ride: 'naked' },
  auto: { len: 2.63, mass: 450, yaw: 180 }, viking: { len: 11.0, mass: 12000 }, citybus: { len: 11.0, mass: 12000, yaw: 180 }, keralabus: { len: 9.5, mass: 11000, ownLivery: true, yaw: 180 }, keralabus2: { len: 10.5, mass: 11500, ownLivery: true }, ksrtc: { len: 11.0, mass: 12000, ownLivery: true },
  tatatruck: { len: 7.5, mass: 10000, yaw: 180 }, tatalorry: { len: 7.4, mass: 10000 },
  fortuner: { len: 4.795, mass: 2135, recolor: { BrakeRotors1: 0x141414 } }, camry: { len: 4.885, mass: 1665 }, landcruiser: { len: 4.95, mass: 2700 },
  eclass: { len: 4.88, mass: 1800, flip: true }, bmw7: { len: 5.08, mass: 1900 }, x5: { len: 4.85, mass: 2185 }, a6: { len: 4.94, mass: 1700 },
};
// Shares of new sales (FY25-26, SIAM data) decide which real models appear.
const CAR_SHARE = { dzire: 4.9, swift: 4.0, wagonr: 3.9, baleno: 3.7, creta: 4.4, scorpio: 3.9, ertiga: 4.3, punch: 4.0, seltos: 2.6,
  xuv3xo: 2.0, xuv700: 2.0, city: 1.6, bolero: 2.5, eeco: 2.2, ambassador: 0.3,
  innova: 1.5, fortuner: 1.1, camry: 0.3, landcruiser: 0.15, eclass: 0.35, bmw7: 0.12, x5: 0.2, a6: 0.25 }; // luxury: well under 2% of sales
const TW_SHARE = { activa: 26, scooter125: 8, pulsar: 18, apache: 8, fz: 6, rx100: 1, olaev: 6, deliveryev: 6 };
// Goods vehicles: mini trucks dominate city deliveries, heavy lorries the highways (and the ghat after 8 pm).
const TRUCK_SHARE = { tataace: 5, eicher: 2, tatatruck: 2, tatalorry: 2, tractor: 1 };
// Local flavour per route, multiplied onto the shares above.
const LOCAL = {
  bengaluru: { olaev: 2, deliveryev: 2, seltos: 1.5, xuv700: 1.5, ambassador: 0, tractor: 0, eclass: 1.8, bmw7: 1.8, x5: 1.8, a6: 1.8 },
  chennai: { tractor: 0, ambassador: 0.5 },
  mysuru: { tractor: 1, tataace: 1.5, bolero: 1.5, olaev: 0.6, deliveryev: 0.4 },
  wayanad: { bolero: 4, scorpio: 2, xuv700: 2, fortuner: 2, eeco: 1.5, tatatruck: 3, tatalorry: 3, eicher: 2, tataace: 1, deliveryev: 0, olaev: 0.3, ambassador: 1.5 },
  kannur: { tractor: 0, ambassador: 4, ertiga: 1.5, tatatruck: 1.5, tatalorry: 1.5, innova: 2.5, fortuner: 2 }, // Gulf money: Innovas and Fortuners everywhere
  kochi: { tractor: 0, ambassador: 3, ertiga: 1.5, olaev: 1.3, innova: 2.5, fortuner: 2, landcruiser: 2.5, eclass: 1.5, bmw7: 1.5 },
  trivandrum: { tractor: 0, ambassador: 4, ertiga: 1.5, innova: 2.5, fortuner: 2 },
  hyderabad: { tractor: 0, ambassador: 0, fortuner: 1.5, landcruiser: 1.5 },
};
// Indian car colour popularity: white dominates, then silver/grey.
const CAR_COLOURS = [[0xf2f2f0, 40], [0xb9bcc2, 18], [0x5d6168, 10], [0x9a1b1b, 8], [0x1d3a6e, 8], [0x16171a, 8], [0x6b4a32, 4], [0xd8c9a8, 4]];
const riderMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });

function bakeReal(gltf, cfg) {
  const wheels = autoWheels(gltf.scene, { kind: cfg.ride ? 'bike' : 'car', flip: cfg.flip });
  const { norm, dims } = normalizeVehicle(gltf.scene, wheels || [], 1, cfg.len, cfg.yaw || 0);
  sanitizeMaterials(norm);
  recolorMaterials(norm, cfg.recolor);
  norm.updateMatrixWorld(true);
  const groups = new Map();
  norm.traverse((o) => {
    if (!o.isMesh) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    g.morphAttributes = {};
    if (!groups.has(m.uuid)) { // merged geometry keeps one UV set: point every texture at it
      for (const k in m) if (m[k]?.isTexture) m[k].channel = 0;
      groups.set(m.uuid, { mat: m, geos: [] });
    }
    groups.get(m.uuid).geos.push(g);
  });
  const parts = [...groups.values()].map(({ mat, geos }) => ({ geo: mergeGeometries(geos), mat, paint: MAT.paint.test(mat.name || '') && !MAT.skip.test(mat.name || '') }));
  if (cfg.ride) { // the real rider (helmet takes the instance colour), or the low-poly one without the model
    const rp = riderParts(dims, cfg.ride);
    if (rp) for (const p of rp) parts.push({ geo: p.geo, mat: p.mat, paint: p.helmet });
    else parts.push({ geo: riderGeometry(dims, cfg.ride), mat: riderMat, paint: true });
  }
  const l = lightsGeo(dims);
  return { parts, dims, head: l.head, tail: l.tail, real: true, mass: cfg.mass };
}

// Full-detail versions (the player-car files) for close-up traffic, loaded in the background after a map is ready.
const nearCache = {};
// Traffic models are used by every map, so they stay on the GPU for the whole session (disposeCity skips anything
// marked shared) and their vertex/pixel data can leave JS memory once uploaded.
function markShared(m) {
  for (const g of [m.geo, m.head, m.tail, m.extra, ...(m.parts || []).map((p) => p.geo)]) if (g) g.userData.shared = true;
  for (const mat of [m.mat, ...(m.parts || []).map((p) => p.mat)]) {
    if (!mat) continue;
    mat.userData.shared = true;
    for (const k in mat) if (mat[k]?.isTexture) mat[k].userData.shared = true;
  }
  return m;
}

export function loadNearModel(id) {
  return (nearCache[id] ||= loadRider().then(() => gltfLoader().loadAsync(`models/vehicles/${id}.glb`)).then((g) => markShared(bakeReal(g, REAL[id]))).catch(() => null));
}

export async function loadTrafficModels(onProgress) {
  const loader = gltfLoader();
  const out = {};
  const have = await fetch('models/traffic/credits.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  await loadRider();
  const real = Object.keys(REAL).filter((id) => have[id]);
  let done = 0;
  const tick = () => onProgress?.(++done / (KENNEY.length + real.length));
  await Promise.all([
    ...KENNEY.map(async (t) => { out[t] = markShared(bake(await loader.loadAsync(`models/kenney/${t}.glb`))); tick(); }),
    ...real.map(async (id) => {
      try { out['real:' + id] = markShared(bakeReal(await loader.loadAsync(`models/traffic/${id}.glb`), REAL[id])); } catch (e) { console.warn('traffic model', id, e); }
      tick();
    }),
  ]);
  return out;
}

function lorryAtlas() {
  const [c, x] = canvas(512, 512);
  // side: painted wooden body
  const g = x.createLinearGradient(0, 0, 0, 256); g.addColorStop(0, '#d2442a'); g.addColorStop(1, '#8a3a1a');
  x.fillStyle = g; x.fillRect(0, 0, 512, 256);
  for (let i = 0; i < 8; i++) { x.fillStyle = 'rgba(40,20,10,0.5)'; x.fillRect(0, i * 32, 512, 3); }
  const cols = ['#f2c200', '#1f9a4a', '#1f6fd0', '#ffffff'];
  for (let i = 0; i < 16; i++) { x.fillStyle = cols[i % 4]; x.beginPath(); x.arc(16 + i * 32, 230, 9, 0, 7); x.fill(); }
  x.fillStyle = '#f2c200'; x.font = '900 40px "Arial Black", Impact, sans-serif'; x.textAlign = 'center'; x.fillText('NATIONAL PERMIT', 256, 130);
  // back: HORN OK PLEASE
  x.fillStyle = '#f2c200'; x.fillRect(0, 256, 256, 256);
  x.fillStyle = '#c4161c'; x.font = '900 46px "Arial Black", Impact, sans-serif'; x.fillText('HORN', 128, 330); x.fillText('OK', 128, 390);
  x.fillStyle = '#1f6fd0'; x.font = '900 40px "Arial Black", Impact, sans-serif'; x.fillText('PLEASE', 128, 450);
  x.strokeStyle = '#1a1a1a'; x.lineWidth = 8; x.strokeRect(8, 264, 240, 240);
  x.fillStyle = '#6a6a6a'; x.fillRect(256, 256, 256, 256); // tarp
  return { map: tex(c), R: { side: [0, 0.5, 1, 1], back: [0, 0, 0.5, 0.5], tarp: [0.5, 0, 1, 0.5] } };
}

// Procedural Indian vehicles (vertex-coloured; white parts take the per-vehicle instance colour).
function indianModels(T, mapId) {
  const W = [1, 1, 1], DARK = [0.06, 0.06, 0.07], GLASS = [0.08, 0.1, 0.13], SKIN = [0.5, 0.36, 0.26];
  const [roof, body, stripe] = T.autoColors || [[0.95, 0.76, 0.05], [0.07, 0.07, 0.07], [0.12, 0.48, 0.23]];
  const vmat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.15 });
  const M = {};
  M.auto = {
    geo: mergeGeometries([
      box(1.3, 0.55, 2.3, 0, 0.62, -0.15, body), box(0.9, 0.9, 0.45, 0, 0.95, 1.0, body), box(1.32, 0.08, 2.32, 0, 0.93, -0.15, stripe),
      box(1.38, 0.08, 2.0, 0, 1.78, -0.2, roof), box(1.38, 0.95, 0.08, 0, 1.3, -1.2, roof),
      box(0.05, 0.42, 1.1, 0.68, 1.55, -0.6, roof), box(0.05, 0.42, 1.1, -0.68, 1.55, -0.6, roof),
      box(0.06, 0.9, 0.06, 0.6, 1.3, 0.78, DARK), box(0.06, 0.9, 0.06, -0.6, 1.3, 0.78, DARK), box(1.0, 0.62, 0.04, 0, 1.38, 0.98, GLASS),
      box(0.4, 0.55, 0.3, 0, 1.2, 0.45, [0.25, 0.3, 0.45]), ball(0.13, 0, 1.62, 0.45, SKIN), box(1.0, 0.45, 0.5, 0, 1.1, -0.55, [0.35, 0.3, 0.28]),
      wheel(0.22, 0.16, 0, 0.22, 1.05), wheel(0.22, 0.16, 0.6, 0.22, -0.85), wheel(0.22, 0.16, -0.6, 0.22, -0.85),
    ]),
    head: box(0.2, 0.14, 0.05, 0, 1.08, 1.24, HEAD), tail: mergeGeometries([box(0.14, 0.1, 0.04, 0.5, 0.75, -1.28, TAIL), box(0.14, 0.1, 0.04, -0.5, 0.75, -1.28, TAIL)]),
    dims: { w: 1.4, l: 2.8 }, mat: vmat, tint: false,
  };
  const twoWheeler = (withBox) => ({
    geo: mergeGeometries([
      box(0.32, 0.4, 1.25, 0, 0.55, 0, [0.85, 0.87, 0.9]), box(0.48, 0.75, 0.14, 0, 0.72, 0.6, [0.85, 0.87, 0.9]), box(0.6, 0.05, 0.05, 0, 1.08, 0.58, DARK),
      box(0.3, 0.35, 0.55, 0, 0.88, -0.05, [0.12, 0.14, 0.2]), box(0.42, 0.58, 0.28, 0, 1.33, -0.08, W), ball(0.16, 0, 1.78, -0.04, withBox ? DARK : [0.6, 0.1, 0.1]),
      box(0.1, 0.42, 0.1, 0.22, 1.25, 0.25, W), box(0.1, 0.42, 0.1, -0.22, 1.25, 0.25, W),
      ...(withBox ? [box(0.52, 0.5, 0.46, 0, 1.24, -0.55, W)] : [box(0.3, 0.32, 0.25, 0, 1.12, -0.42, [0.12, 0.14, 0.2])]),
      wheel(0.22, 0.1, 0, 0.22, 0.55), wheel(0.22, 0.1, 0, 0.22, -0.55),
    ]),
    head: box(0.14, 0.1, 0.05, 0, 0.98, 0.69, HEAD), tail: box(0.12, 0.08, 0.04, 0, 0.78, -0.66, TAIL),
    dims: { w: 0.7, l: 1.8 }, mat: vmat, tint: true, palette: withBox ? DELIVERY : RIDER,
  });
  M.scooter = twoWheeler(true);
  M.bike = twoWheeler(false);
  // City bus with operator livery atlas; several liveries become separate types (bus, bus2, ...).
  const liveries = CITY_BUSES[mapId] || ['bmtc'];
  // repeated ids weight the mix (e.g. most BMTC buses are Sarige ordinary)
  liveries.forEach((id, k) => {
    M[k ? 'bus' + k : 'bus'] = { ...cityBus({ ...LIVERY[id], routes: CITY_ROUTES[mapId]?.[id] || LIVERY[id].routes }, HEAD, TAIL),
      tint: null, liveryOf: id, massKey: 'bus' };
  });
  // Painted goods lorry
  const LA = lorryAtlas();
  const lmat = new THREE.MeshStandardMaterial({ map: LA.map, roughness: 0.7 });
  M.lorry = {
    geo: atlasBox(2.5, 2.4, 5.4, 0, 2.15, -1.3, [LA.R.side, LA.R.side, LA.R.tarp, LA.R.tarp, LA.R.tarp, LA.R.back]),
    extra: mergeGeometries([box(2.3, 2.2, 1.9, 0, 1.75, 2.45, [0.95, 0.55, 0.1]), box(2.2, 0.8, 0.05, 0, 2.3, 3.41, GLASS), box(2.4, 0.4, 7.4, 0, 0.7, 0.2, [0.12, 0.12, 0.12]),
      wheel(0.5, 0.35, 1.05, 0.5, 2.6), wheel(0.5, 0.35, -1.05, 0.5, 2.6), wheel(0.5, 0.35, 1.05, 0.5, -2.4), wheel(0.5, 0.35, -1.05, 0.5, -2.4), wheel(0.5, 0.35, 1.05, 0.5, -3.5), wheel(0.5, 0.35, -1.05, 0.5, -3.5)]),
    head: mergeGeometries([box(0.3, 0.2, 0.05, 0.85, 1.1, 3.42, HEAD), box(0.3, 0.2, 0.05, -0.85, 1.1, 3.42, HEAD)]),
    tail: mergeGeometries([box(0.3, 0.2, 0.05, 1.0, 1.0, -4.02, TAIL), box(0.3, 0.2, 0.05, -1.0, 1.0, -4.02, TAIL)]),
    dims: { w: 2.5, l: 7.6 }, mat: lmat, tint: null,
  };
  return M;
}

// Soft dark blob for contact shadows under traffic (rounded rectangle, blurred edges).
function shadowTexture() {
  const [c, x] = canvas(64, 128);
  x.filter = 'blur(9px)';
  x.fillStyle = 'rgba(0,0,0,0.85)';
  x.beginPath(); x.roundRect(12, 14, 40, 100, 16); x.fill();
  return new THREE.CanvasTexture(c);
}

function beamTexture() {
  const [c, x] = canvas(64, 128);
  const g = x.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, 'rgba(255,255,255,0.8)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.beginPath(); x.moveTo(24, 0); x.lineTo(40, 0); x.lineTo(64, 128); x.lineTo(0, 128); x.fill();
  return new THREE.CanvasTexture(c);
}

export class Traffic {
  constructor(scene, track, models, T, mapId, groundY) {
    this.track = track;
    this.enabled = true;
    this.closed = track.closed;
    this.groundY = groundY || ((x, z) => track.nearest(x, z).y);
    const r = rng(4242);
    const L = track.length;
    this.cars = [];
    const plan = [];
    const all = { ...models, ...(T.traffic ? indianModels(T, mapId) : {}) };
    const busTypes = Object.keys(all).filter((k) => k === 'bus' || /^bus\d$/.test(k));
    if (track.closed || !T.traffic) {
      LOOP_LANES.forEach((lat, li) => {
        const count = Math.round((li === 0 ? 8 : li === 3 ? 5 : 7) * (L / 4600));
        const pool = li === 0 ? LOOP_SLOW : LOOP_FAST;
        for (let i = 0; i < count; i++) {
          let type = pool[Math.floor(r() * pool.length)];
          if (type === 'firetruck' && r() < 0.6) type = 'truck';
          plan.push({ type, home: lat, dir: 1, vDes: LOOP_SPEED[li], d0: 140 + ((i + r() * 0.5) / count) * (L - 300) });
        }
      });
    } else {
      const weights = { ...T.traffic };
      const four = HW >= 8, LAT = four ? { tw: 0.88 * HW, slow: 0.67 * HW, fast: 0.25 * HW } : { tw: 0.8 * HW, slow: 0.45 * HW, fast: 0.45 * HW };
      this.lanes = { four, ...LAT, between: 0.45 * HW, kerb: HW };
      const mix = MIX[mapId] || MIX.bengaluru;
      const pickW = (w) => { const ks = Object.keys(w).filter((k) => w[k] > 0); let x = r() * ks.reduce((a, k) => a + w[k], 0); for (const k of ks) { x -= w[k]; if (x <= 0) return k; } return ks[0]; };
      const carKinds = { sedan: weights.sedan ?? 4, suv: weights.suv ?? 2, hatch: weights.hatch ?? 3, van: weights.van ?? 1, delivery: weights.delivery ?? 0.5 };
      const loc = LOCAL[mapId] || {};
      const realOf = (share) => Object.fromEntries(Object.entries(share).map(([id, w]) => [id, w * (loc[id] ?? 1)])
        .filter(([id, w]) => w > 0 && all['real:' + id]).map(([id, w]) => ['real:' + id, w]));
      const realCars = realOf(CAR_SHARE), realTw = realOf(TW_SHARE), realTrucks = realOf(TRUCK_SHARE);
      // Malabar (Kannur, Wayanad) runs mostly private stage buses; elsewhere state transport (KSRTC/BMTC/MTC/TGSRTC).
      const busPool = { kannur: ['keralabus', 'keralabus', 'keralabus2', 'keralabus2', 'ksrtc'], wayanad: ['keralabus', 'keralabus2', 'ksrtc'] }[mapId]
        || (T.lang === 'ml' ? ['ksrtc', 'ksrtc', 'ksrtc', 'keralabus', 'keralabus2'] : ['viking', 'citybus']);
      const realBus = busPool.filter((id) => all['real:' + id]).map((id) => 'real:' + id);
      const has = (o) => Object.keys(o).length > 0;
      for (const dir of [1, -1]) {
        const lanes = { tw: [], between: [], slow: [], fast: [] };
        const total = Math.round((L / 1000) * mix.density);
        for (let i = 0; i < total; i++) {
          const cls = pickW({ tw: mix.tw, car: mix.car, auto: mix.auto, bus: busTypes.length || realBus.length ? mix.bus : 0, truck: mix.truck });
          let type, lane;
          if (cls === 'tw') { type = has(realTw) ? pickW(realTw) : r() < 0.55 ? 'bike' : 'scooter'; const q = r(); lane = q < 0.6 || !four ? 'tw' : q < 0.85 ? 'between' : 'fast'; }
          else if (cls === 'auto') { type = all['real:auto'] ? 'real:auto' : 'auto'; lane = 'slow'; }
          else if (cls === 'bus') { // the city's own liveried fleet, with older generic buses as a minority (Kerala: real models)
            const own = busTypes.length && (!realBus.length || (T.lang !== 'ml' && r() < (mapId === 'bengaluru' ? 0.9 : 0.75)));
            type = own ? busTypes[Math.floor(r() * busTypes.length)] : realBus[Math.floor(r() * realBus.length)]; lane = 'slow'; }
          else if (cls === 'truck') { type = has(realTrucks) ? pickW(realTrucks) : r() < 0.75 ? 'lorry' : 'truck'; lane = 'slow'; }
          else if (has(realCars)) { type = pickW(realCars); lane = r() < 0.65 ? 'fast' : 'slow'; }
          else { const k = pickW(carKinds); const opts = KIND_MODELS[k]; type = opts[Math.floor(r() * opts.length)]; lane = r() < 0.65 ? 'fast' : 'slow'; }
          if (!all[type]) continue;
          lanes[lane].push(type);
        }
        for (const lane in lanes) {
          const list = lanes[lane], n = list.length, home = lane === 'between' ? this.lanes.between : LAT[lane];
          list.forEach((type, i) => plan.push({ type, home, dir, d0: ((i + 0.15 + r() * 0.5) / n) * (L + 80) - 40 }));
        }
      }
    }
    const byType = {};
    for (const p of plan) if (all[p.type]) (byType[p.type] ||= []).push(p);
    const headMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    const tailMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    const extraMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });
    this.meshes = [];
    this.types = [];
    this.byType = {};
    this.scene = scene;
    const busCols = (CITY_BUSES[mapId] || ['bmtc']).filter((id) => id !== 'private').map((id) => LIVERY[id].bottom);
    const pickCol = (list) => { let x = r() * list.reduce((a, q) => a + q[1], 0); for (const [c, w] of list) { x -= w; if (x <= 0) return c; } return list[0][0]; };
    let total = 0;
    for (const type in byType) {
      const list = byType[type], m = all[type], n = list.length;
      // Only vehicles near the camera are drawn: instance slots are refilled every frame (see update).
      // Every part of a type shares ONE matrix (and colour) buffer, so a type costs one GPU upload per frame, not one per part.
      const buf = (size) => new THREE.InstancedBufferAttribute(new Float32Array(n * size), size).setUsage(THREE.DynamicDrawUsage);
      const ty = { meshes: [], tinted: [], head: null, tail: null, n: 0, nl: 0, mat: buf(16), col: buf(3), lmat: buf(16), lcol: buf(3), cap: n, type, near: null };
      const mk = (geo, material, tinted, lamp = false) => {
        const im = new THREE.InstancedMesh(geo, material, n);
        im.instanceMatrix = lamp ? ty.lmat : ty.mat;
        if (tinted) im.instanceColor = lamp ? ty.lcol : ty.col;
        im.frustumCulled = false; im.count = 0; im.visible = false;
        scene.add(im); this.meshes.push(im);
        return im;
      };
      if (m.real) {
        const own = REAL[type.slice(5)]?.ownLivery;
        for (const part of m.parts) { const tint = part.paint && !own; const im = mk(part.geo, part.mat, tint); ty.meshes.push(im); if (tint) ty.tinted.push(im); }
      } else {
        let mat = m.mat;
        if (m.tint === undefined) { // Kenney cars: glossy clear-coated paint, varied colours
          mat = new THREE.MeshPhysicalMaterial({ map: m.mat.map, roughness: 0.35, metalness: 0.4, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.1 });
        }
        const body = mk(m.geo, mat, m.tint !== null);
        ty.meshes.push(body); if (m.tint !== null) ty.tinted.push(body);
        if (m.extra) ty.meshes.push(mk(m.extra, extraMat));
      }
      // head/tail lamps are cheap and stay visible much further than the bodies, so traffic never pops in the dark
      ty.head = mk(m.head, headMat, false, true);
      ty.tail = mk(m.tail, tailMat, true, true);
      ty.nl = 0;
      this.types.push(ty);
      this.byType[type] = ty;
      const isBus = isBusType(type), isTw = m.real ? !!REAL[type.slice(5)]?.ride : m.tint === true;
      list.forEach((p, i) => {
        const col = new THREE.Color();
        if (m.real) col.set(isBus ? busCols[Math.floor(r() * busCols.length)] : isTw ? RIDER[Math.floor(r() * RIDER.length)] : pickCol(CAR_COLOURS));
        else if (m.tint === undefined) col.set(pickCol(CAR_COLOURS)).lerp(new THREE.Color(1, 1, 1), 0.2);
        else if (m.tint) col.set(m.palette[Math.floor(r() * m.palette.length)]);
        else col.setRGB(1, 1, 1);
        const dims = m.dims;
        this.cars.push({
          ...p, ty, col, gi: total + i, half: dims.l / 2, r: Math.min(1.3, (dims.w / 2) * 0.95), mass: m.mass || MASS[m.massKey || type] || 1500,
          x: 0, y: 0, z: 0, yaw: 0, vx: 0, vz: 0, yawRate: 0, on: true, ph: r() * 6.28, ph2: r() * 6.28, knocked: null, w: Math.max(dims.w, isTw ? 0.7 : 0),
        });
      });
      total += n;
    }
    this.cars.sort((a, b) => a.gi - b.gi);
    this.initSim(track, scene, busTypes.length > 0 && !!T.traffic && !track.closed && HW >= 8); // no stops on narrow ghats
    // headlight beams on the road
    this.beams = new THREE.InstancedMesh(new THREE.PlaneGeometry(4, 16).rotateX(-Math.PI / 2).translate(0, 0.06, 10),
      new THREE.MeshBasicMaterial({ map: beamTexture(), color: 0xfff1d8, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false }), this.cars.length);
    this.beams.frustumCulled = false; this.beams.count = 0; this.beams.instanceMatrix.setUsage(THREE.DynamicDrawUsage); // refilled every frame
    scene.add(this.beams); this.meshes.push(this.beams);
    // contact shadows: one instanced draw for every visible vehicle, so traffic sits on the road instead of floating
    this.shadows = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false, opacity: 0.75, polygonOffset: true, polygonOffsetFactor: -2 }), this.cars.length);
    this.shadows.frustumCulled = false; this.shadows.count = 0; this.shadows.renderOrder = 1; this.shadows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.shadows); this.meshes.push(this.shadows);
    this._ss = new THREE.Vector3(); this._sq = new THREE.Quaternion(); this._yAxis = new THREE.Vector3(0, 1, 0);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._p = new THREE.Vector3(); this._e = new THREE.Euler(0, 0, 0, 'YXZ');
    this._s = new THREE.Vector3(1, 1, 1); this._z = new THREE.Vector3(0, 0, 0);
    this._tmp = {}; this._c = new THREE.Color();
    this.onKnock = null;
    this.drawDist = 520;
  }

  // Full-detail model for close-up vehicles of a type (same lamps, slots and colours as the light version).
  attachNear(type, m) {
    const ty = this.byType[type];
    if (!ty || ty.near) return [];
    const buf = (size) => new THREE.InstancedBufferAttribute(new Float32Array(ty.cap * size), size).setUsage(THREE.DynamicDrawUsage);
    const lod = ty.near = { meshes: [], tinted: [], n: 0, mat: buf(16), col: buf(3) };
    const own = REAL[type.slice(5)]?.ownLivery;
    for (const part of m.parts) {
      const im = new THREE.InstancedMesh(part.geo, part.mat, ty.cap);
      im.instanceMatrix = lod.mat;
      if (part.paint && !own) { im.instanceColor = lod.col; lod.tinted.push(im); }
      im.frustumCulled = false; im.count = 0; im.visible = false;
      this.scene.add(im); this.meshes.push(im); lod.meshes.push(im);
    }
    return lod.meshes;
  }

  // ---------- driving sim ----------
  initSim(track, scene, busStops) {
    const L = this.Lq = Math.round(track.length), S = 4, n = Math.floor(L / S) + 2;
    // Curve speed (sqrt of radius, i.e. for 1 m/s^2 lateral grip) with braking ahead of bends, and grade; quantized so
    // every client computes identical numbers.
    const vc = new Float32Array(n), gr = new Float32Array(n), fwd = new Float32Array(n), rev = new Float32Array(n);
    const a = {}, b = {}, c = {};
    for (let k = 0; k < n; k++) {
      const d = k * S;
      track.sample(this.closed ? (d - 6 + L) % L : Math.max(0, d - 6), 0, a);
      track.sample(this.closed ? (d + 6) % L : Math.min(track.length, d + 6), 0, b);
      track.sample(Math.min(d, track.length), 0, c);
      let dy = b.yaw - a.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
      const R = Math.min(1600, 12 / Math.max(1e-4, Math.abs(dy)));
      vc[k] = Math.round(Math.sqrt(R) * 4) / 4;
      gr[k] = Math.round((c.grade || 0) * 200) / 200;
    }
    const brake = 2 * S; // v^2 headroom per sample at 1 m/s^2
    for (let pass = 0; pass < (this.closed ? 2 : 1); pass++) {
      for (let k = n - 1; k >= 0; k--) { const nx = k + 1 < n ? fwd[k + 1] : this.closed ? fwd[0] : 40; fwd[k] = Math.min(vc[k], Math.sqrt(nx * nx + brake)); }
      for (let k = 0; k < n; k++) { const pv = k > 0 ? rev[k - 1] : this.closed ? rev[n - 1] : 40; rev[k] = Math.min(vc[k], Math.sqrt(pv * pv + brake)); }
    }
    if (!this.closed) for (let k = 0; k < n; k++) { fwd[k] = fwd[k] || vc[k]; rev[k] = rev[k] || vc[k]; }
    this.prof = { S, n, fwd, rev, gr };

    // Bus stops (kerb side, both directions) with simple shelters.
    this.stops = [];
    if (busStops) {
      const geo = mergeGeometries([new THREE.BoxGeometry(4.2, 0.12, 2).translate(0.4, 2.7, 0), new THREE.BoxGeometry(0.06, 1.9, 4.2).translate(1.35, 1.25, 0),
        new THREE.BoxGeometry(0.1, 2.7, 0.1).translate(-0.5, 1.35, 1.9), new THREE.BoxGeometry(0.1, 2.7, 0.1).translate(-0.5, 1.35, -1.9), new THREE.BoxGeometry(0.5, 0.45, 3.4).translate(1.0, 0.45, 0)]);
      const sh = [], ss = {};
      for (let u = 380; u < L - 250; u += 720) this.stops.push(u);
      for (const dir of [1, -1]) for (const u of this.stops) {
        const uu = u + (dir < 0 ? 260 : 0); if (uu > L - 150) continue;
        track.sample(dir > 0 ? uu : L - uu, dir * (HW + 3.2), ss);
        sh.push(new THREE.Matrix4().compose(new THREE.Vector3(ss.x, ss.y, ss.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ss.yaw + (dir > 0 ? 0 : Math.PI)), new THREE.Vector3(1, 1, 1)));
      }
      if (sh.length) {
        const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0x2c5f8a, roughness: 0.6, metalness: 0.3 }), sh.length);
        sh.forEach((m, i) => im.setMatrixAt(i, m));
        scene.add(im); this.meshes.push(im);
      }
    }
    this.groups = this.closed ? [[]] : [[], []];
    for (const c of this.cars) {
      const K = CLASS[classOf(c.type)];
      const rr = mulberry(c.gi * 7919 + 31);
      c.K = K; c.cls = classOf(c.type);
      c.vDes = (c.vDes || K.v) * (1 - K.vr + 2 * K.vr * rr());
      const cap = REAL[c.type.replace('real:', '')]?.vmax;
      if (cap) c.vDes = Math.min(c.vDes, cap * (0.9 + 0.2 * rr()));
      c.bus = isBusType(c.type);
      (this.groups[c.dir > 0 ? 0 : 1] ||= []).push(c);
    }
    this.ts = undefined;
  }

  resetSim() {
    for (const c of this.cars) {
      c.u = c.d0; c.m = c.mt = c.home; c.mv = 0; c.v = c.vDes * 0.7; c.acc = 0; c.uP = c.u; c.mP = c.m;
      c.active = true; c.stopIdx = 0; c.stopping = 0; c.dwell = 0; c.lcT = c.gi % 10; c.rnd = mulberry(c.gi * 7919 + 17);
    }
    for (const g of this.groups) g.sort((a, b) => a.u - b.u);
    this.ts = T0;
  }

  // Nearest vehicle ahead (dir=1) or behind (dir=-1) of car index i whose body overlaps lateral position m.
  scan(g, i, m, w, dir, range) {
    const n = g.length, me = g[i], L = this.Lq;
    for (let k = 1; k < Math.min(n, 40); k++) {
      let j = i + k * dir;
      if (this.closed) j = (j + n) % n; else if (j < 0 || j >= n) return null;
      const o = g[j];
      if (!o.active) continue;
      let du = (o.u - me.u) * dir;
      if (this.closed && du < 0) du += L;
      if (du > range) return null;
      if (Math.abs(o.m - m) < (o.w + w) / 2 + 0.35) return { c: o, gap: du - o.half - me.half };
    }
    return null;
  }

  step() {
    const P = this.prof, L = this.Lq, lanes = this.lanes;
    for (const g of this.groups) {
      const n = g.length;
      for (let i = 0; i < n; i++) {
        const c = g[i], K = c.K;
        c.uP = c.u; c.mP = c.m;
        if (!c.active) { // waiting to enter at the start of an open road
          const first = g.find((o) => o.active && Math.abs(o.m - c.home) < (o.w + c.w) / 2 + 0.35);
          if (!first || first.u > -40 + 14 + c.half) { c.active = true; c.u = c.uP = -45; c.v = Math.min(c.vDes, first ? first.v : c.vDes); c.m = c.mt = c.mP = c.home; c.stopIdx = 0; }
          continue;
        }
        // desired speed: driver, grade (heavy vehicles crawl uphill) and the curve profile ahead
        const d = c.dir > 0 ? c.u : L - c.u;
        const k = Math.max(0, Math.min(P.n - 1, Math.floor(d / P.S)));
        const grade = P.gr[k] * c.dir;
        let v0 = c.vDes / (1 + K.g * Math.max(0, grade) + (c.cls === 'heavy' ? K.g * 0.5 * Math.max(0, -grade) : 0));
        v0 = Math.max(1, Math.min(v0, (c.dir > 0 ? P.fwd[k] : P.rev[k]) * Math.sqrt(K.alat)));
        // leader (anything overlapping our lateral position), or the bus stop we are pulling into
        const ld = this.scan(g, i, c.m, c.w, 1, 160);
        let gap = ld ? ld.gap : 1e9, vl = ld ? ld.c.v : 0;
        const stopsFor = c.bus || c.cls === 'auto';
        if (stopsFor && this.stops.length && !this.closed) {
          const list = this.stops, off = (c.dir < 0 ? 260 : 0) + (c.bus ? 0 : 140);
          while (c.stopIdx < list.length && list[c.stopIdx] + off < c.u - 2) c.stopIdx++;
          const us = c.stopIdx < list.length ? list[c.stopIdx] + off : 1e9;
          if (!c.stopping && us - c.u < 150 && us - c.u > 20) c.stopping = c.bus || c.rnd() < 0.3 ? 1 : -1;
          if (c.stopping === 1) {
            c.mt = HW - c.w / 2 - 0.3;
            const sg = us - c.u - c.half;
            if (sg < gap) { gap = sg; vl = 0; }
            if (c.v < 0.3 && sg < 4) {
              c.dwell += DT;
              if (c.dwell > (c.bus ? 12 : 5) + c.rnd() * 6) { c.stopIdx++; c.stopping = 0; c.dwell = 0; c.mt = c.home; }
            }
          } else if (c.stopping === -1 && us - c.u < 0) { c.stopping = 0; c.stopIdx++; }
        }
        // Intelligent Driver Model
        const v = c.v, r = v / v0, r2 = r * r;
        let acc = K.a * (1 - r2 * r2);
        if (gap < 1e8) {
          const sStar = K.s0 + Math.max(0, v * K.T + (v * (v - vl)) / (2 * Math.sqrt(K.a * K.b)));
          const q = sStar / Math.max(0.2, gap);
          acc -= K.a * q * q;
        }
        acc = Math.max(-8, Math.min(K.a, acc));
        c.acc = acc;
        c.v = Math.max(0, v + acc * DT);
        c.u += c.v * DT;
        // lane changes (MOBIL-lite): every second, overtake a slow leader or drift back to the home lane
        if (--c.lcT <= 0) {
          c.lcT = 10;
          if (!c.stopping && Math.abs(c.m - c.mt) < 0.2) this.laneChange(g, i, c, ld, v0, lanes);
        }
        const dm = c.mt - c.m;
        c.mv = Math.max(-K.lc, Math.min(K.lc, dm * 1.2));
        c.m += c.mv * DT;
        if (this.closed) { if (c.u >= L) { c.u -= L; c.uP -= L; } }
        else if (c.u > L + 45) { c.active = false; c.u = c.uP = -1e6; }
      }
      // keep sorted by position (nearly sorted already: insertion sort)
      for (let i = 1; i < n; i++) {
        const c = g[i]; let j = i - 1;
        while (j >= 0 && g[j].u > c.u) { g[j + 1] = g[j]; j--; }
        g[j + 1] = c;
      }
    }
    this.ts += DT;
  }

  laneChange(g, i, c, ld, v0, lanes) {
    let cands;
    if (!lanes) cands = LOOP_LANES;
    else if (c.cls === 'tw') cands = lanes.four ? [lanes.tw, lanes.between, lanes.fast] : [lanes.tw, 0.3 * HW];
    else if (!lanes.four) return;
    else cands = [lanes.slow, lanes.fast];
    const blocked = ld && ld.gap < 35 && ld.c.v < v0 * 0.8;
    const safe = (m) => {
      const a = this.scan(g, i, m, c.w, 1, 150), b = this.scan(g, i, m, c.w, -1, 80);
      if (b && b.gap < Math.max(6, b.c.v * 0.9 + (b.c.v - c.v) * 1.5)) return -1;
      if (a && a.gap < Math.max(10, c.v * 1.0)) return -1;
      return a ? Math.min(a.c.v + a.gap * 0.05, v0) : v0;
    };
    if (blocked) {
      let best = ld.c.v + 1.5, pick = null;
      for (const m of cands) {
        if (Math.abs(m - c.mt) < 0.3) continue;
        const q = safe(m);
        if (q > best) { best = q; pick = m; }
      }
      if (pick !== null) c.mt = pick;
    } else if (Math.abs(c.mt - c.home) > 0.3 && c.rnd() < 0.5) {
      const a = this.scan(g, i, c.home, c.w, 1, 150);
      if ((!a || a.gap > 40 || a.c.v > c.v) && safe(c.home) > 0) c.mt = c.home;
    }
  }

  setEnabled(on) {
    this.enabled = on;
    for (const m of this.meshes) m.visible = on;
  }

  // Mass-based collision with a dynamic body (player car, cop). Light vehicles get launched.
  collideBody(body, mass, e = 0.25) {
    if (!this.enabled) return { impact: 0 };
    let best = { impact: 0 };
    for (const c of this.cars) {
      if (!c.on) continue;
      const heavy = c.mass >= 5000;
      const vx0 = c.vx, vz0 = c.vz;
      const imp = collide(body, c, 1 / mass, heavy ? 0 : 1 / c.mass, e);
      if (imp <= 0) continue;
      if (c.knocked) { const k = c.knocked; k.x = c.x; k.z = c.z; k.vx = c.vx; k.vz = c.vz; k.vy = Math.max(k.vy, Math.min(4, imp * 0.15)); k.rest = 0; }
      if (imp > best.impact) best = { impact: imp, car: c };
      if (!heavy && imp > 2.5) this.knock(c, imp, vx0, vz0, true);
    }
    return best;
  }

  knock(c, imp, vx0, vz0, local, preset = null) {
    const light = c.mass < 700;
    const k = preset || {
      x: c.x, y: c.y, z: c.z, vx: c.vx, vz: c.vz,
      vy: light ? Math.min(10, 1.5 + imp * 0.35) : Math.min(2.5, imp * 0.06),
      yaw: c.yaw, pitch: 0, roll: 0,
      wy: (Math.random() - 0.5) * imp * (light ? 0.6 : 0.15), wp: light ? (Math.random() - 0.5) * imp * 0.5 : 0, wr: light ? (Math.random() - 0.5) * imp * 0.6 : (Math.random() - 0.5) * 0.4,
    };
    k.t = 0; k.rest = 0;
    c.knocked = k;
    if (local && this.onKnock) this.onKnock(c.gi, k, imp);
  }

  applyRemoteKnock(gi, k) {
    const c = this.cars[gi];
    if (c) this.knock(c, 0, 0, 0, false, { ...k });
  }

  // t: seconds on the shared race clock
  update(t, dt = 0.016, camX = 0, camZ = 0) {
    if (!this.enabled) return;
    // Race clock (small t): replay deterministically from T0 so all players see the same traffic. Menu: free-run.
    const raceClock = t < 7200;
    // small backward clock corrections just wait; only a real jump (new race, long pause) replays from T0
    if (this.ts === undefined || (raceClock && (t < this.ts - 3 || t > this.ts + 30)) || (!raceClock && Math.abs(t - this.ts) > 30)) {
      this.resetSim();
      if (!raceClock) this.ts = t;
    }
    let guard = 0;
    while (this.ts < t && guard++ < 40000) this.step();
    const alpha = Math.max(0, Math.min(1, 1 - (this.ts - t) / DT));
    const s = this._tmp, L = this.track.length, E = this._e, col = this._c, Lq = this.Lq;
    const R2 = this.drawDist * this.drawDist;
    let nBeam = 0;
    for (const ty of this.types) { ty.n = ty.nl = 0; if (ty.near) ty.near.n = 0; }
    const NEAR2 = 45 * 45;
    const LIGHTS2 = Math.max(R2, 1500 * 1500);
    for (const c of this.cars) {
      let pitch = 0, roll = 0, brake = 1;
      if (c.knocked) {
        const k = c.knocked;
        k.t += dt;
        k.vy -= 9.81 * dt;
        k.x += k.vx * dt; k.y += k.vy * dt; k.z += k.vz * dt;
        k.yaw += k.wy * dt; k.pitch += k.wp * dt; k.roll += k.wr * dt;
        const gy = this.groundY(k.x, k.z) + 0.02;
        if (k.y <= gy) {
          k.y = gy;
          if (k.vy < -2.5) { k.vy *= -0.32; k.wp *= 0.6; k.wr *= 0.6; } else k.vy = 0;
          const f = Math.exp(-dt * 2.2);
          k.vx *= f; k.vz *= f; k.wy *= f; k.wp *= f * f; k.wr *= f * f;
          if (Math.abs(k.wp) < 0.5) k.pitch += (Math.round(k.pitch / Math.PI) * Math.PI - k.pitch) * Math.min(1, dt * 3);
          if (Math.abs(k.wr) < 0.5) k.roll += (Math.round(k.roll / Math.PI) * Math.PI - k.roll) * Math.min(1, dt * 3);
          if (Math.hypot(k.vx, k.vz) < 0.6) k.rest += dt;
        }
        c.x = k.x; c.z = k.z; c.y = k.y; c.yaw = k.yaw; c.vx = k.vx; c.vz = k.vz;
        pitch = k.pitch; roll = k.roll;
        const far = Math.hypot(k.x - camX, k.z - camZ) > 90;
        if ((k.rest > 6 && far) || k.t > 25) c.knocked = null;
        c.on = true;
      } else {
        let du = c.u - c.uP;
        if (this.closed && du < -Lq / 2) du += Lq;
        const u = c.uP + du * alpha, m = c.mP + (c.m - c.mP) * alpha;
        const d = this.closed ? ((u % L) + L) % L : c.dir > 0 ? u : L - u;
        c.on = c.active && (this.closed || (d > 0 && d < L));
        brake = c.acc < -0.6 || c.v < 0.3 ? 4 : 1;
        const lat = m * c.dir + c.K.wob * Math.sin(t * 0.7 + c.ph2) * Math.min(1, c.v / 5);
        this.track.sample(d, lat, s);
        c.x = s.x; c.z = s.z; c.y = s.y;
        const steer = Math.atan2(c.mv, Math.max(2, c.v));
        c.yaw = (c.dir > 0 ? s.yaw : s.yaw + Math.PI) + steer;
        c.vx = Math.sin(c.yaw) * c.v; c.vz = Math.cos(c.yaw) * c.v; c.dist = s.dist;
        pitch = -Math.atan(s.grade * c.dir);
        if (c.cls === 'tw') roll = Math.max(-0.35, Math.min(0.35, -steer * 2.5));
        if (!c.on) { c.x = c.z = 1e6; }
      }
      if (!c.on) continue;
      const dx = c.x - camX, dz = c.z - camZ, d2 = dx * dx + dz * dz;
      if (d2 > LIGHTS2) continue;
      E.set(pitch, c.yaw, roll);
      this._q.setFromEuler(E);
      this._p.set(c.x, c.y + 0.02, c.z);
      this._m.compose(this._p, this._q, this._s);
      const ty = c.ty, ls = ty.nl++;
      this._m.toArray(ty.lmat.array, ls * 16);
      col.setRGB(brake, brake, brake).toArray(ty.lcol.array, ls * 3);
      if (d2 > R2) continue;
      const lod = ty.near && d2 < NEAR2 ? ty.near : ty; // close-up vehicles use the full-detail model
      const slot = lod.n++;
      this._m.toArray(lod.mat.array, slot * 16);
      c.col.toArray(lod.col.array, slot * 3);
      if (!c.knocked) {
        this.beams.setMatrixAt(nBeam, this._m);
        this._sq.setFromEuler(E.set(pitch, c.yaw, 0)); // follow the road grade
        this._p.y = c.y + 0.04;
        this.shadows.setMatrixAt(nBeam++, this._m.compose(this._p, this._sq, this._ss.set(c.w * 1.25 + 0.3, 1, c.half * 2.15)));
      }
    }
    const upload = (a, n) => { if (n) { a.addUpdateRange(0, n * a.itemSize); a.needsUpdate = true; } };
    for (const ty of this.types) {
      for (const lod of ty.near ? [ty, ty.near] : [ty]) {
        for (const im of lod.meshes) { im.count = lod.n; im.visible = lod.n > 0; }
        upload(lod.mat, lod.n); upload(lod.col, lod.tinted.length ? lod.n : 0);
      }
      ty.head.count = ty.tail.count = ty.nl; ty.head.visible = ty.tail.visible = ty.nl > 0;
      upload(ty.lmat, ty.nl); upload(ty.lcol, ty.nl);
    }
    this.beams.count = nBeam; this.beams.visible = nBeam > 0; upload(this.beams.instanceMatrix, nBeam);
    this.shadows.count = nBeam; this.shadows.visible = nBeam > 0; upload(this.shadows.instanceMatrix, nBeam);
  }
}
