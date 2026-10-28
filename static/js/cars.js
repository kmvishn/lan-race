import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Player car roster. Meshes are matched by node or material name so new models only need a config entry.
// Indian roster (Sketchfab CC models fetched by scripts/fetch-vehicles.py): real-world top speed (km/h), 0-100 time
// (0-60 for scooters/commuters via vAcc), kerb mass (kg) and length (m) used to scale the model. Meshes are matched by
// material name; wheels are found by node name.
const veh = (id, name, seg, spec) => ({ name, seg, url: `models/vehicles/${id}.glb`, auto: true, kind: 'car', grip: 1, vAcc: 100, ...spec });
export const MAT = {
  paint: /paint|body|fairing|tank|carros|exterior|panel/i, glass: /glass|window|windshield|windscreen|visor/i,
  brake: /tail|brake|rear.?l(igh)?t|stop.?lamp/i, head: /head.?l(igh)?t|head.?lamp|front.?l(igh)?t|lamp/i, skip: /tyre|tire|rubber|chrome|rim|interior|seat/i,
};
export const CARS = {
  swift: veh('swift', 'MARUTI SUZUKI SWIFT', 'BUDGET HATCHBACK', { top: 165, tAcc: 11.5, mass: 920, len: 3.86 }),
  dzire: veh('dzire', 'MARUTI SUZUKI DZIRE', 'COMPACT SEDAN', { top: 165, tAcc: 12.6, mass: 960, len: 3.995 }),
  baleno: veh('baleno', 'MARUTI SUZUKI BALENO', 'PREMIUM HATCHBACK', { top: 170, tAcc: 12.3, mass: 935, len: 3.99 }),
  city: veh('city', 'HONDA CITY', 'MIDSIZE SEDAN', { top: 190, tAcc: 10.5, mass: 1110, len: 4.58 }),
  creta: veh('creta', 'HYUNDAI CRETA', 'COMPACT SUV', { top: 190, tAcc: 8.9, mass: 1350, len: 4.33, grip: 0.95 }),
  thar: veh('thar', 'MAHINDRA THAR', 'OFF-ROADER', { top: 155, tAcc: 10.5, mass: 1750, len: 3.98, grip: 0.88 }),
  scorpio: veh('scorpio', 'MAHINDRA SCORPIO', 'SUV', { top: 165, tAcc: 11.5, mass: 1900, len: 4.46, grip: 0.9 }),
  innova: veh('innova', 'TOYOTA INNOVA CRYSTA', 'MPV', { top: 175, tAcc: 11.5, mass: 1750, len: 4.75, grip: 0.92 }),
  punch: veh('punch', 'TATA PUNCH', 'MICRO SUV', { top: 150, tAcc: 16.5, mass: 1030, len: 3.83, grip: 0.93 }),
  i20: veh('i20', 'HYUNDAI i20', 'PREMIUM HATCHBACK', { top: 180, tAcc: 10.5, mass: 1080, len: 3.995 }),
  seltos: veh('seltos', 'KIA SELTOS', 'COMPACT SUV', { top: 190, tAcc: 9.7, mass: 1350, len: 4.365, grip: 0.95 }),
  xuv3xo: veh('xuv3xo', 'MAHINDRA XUV 3XO', 'COMPACT SUV', { top: 180, tAcc: 9.5, mass: 1360, len: 3.99, grip: 0.95 }),
  ambassador: veh('ambassador', 'HINDUSTAN AMBASSADOR', 'CLASSIC', { top: 125, tAcc: 22, mass: 1160, len: 4.33, grip: 0.82, voice: 0.85 }),
  bmw3: veh('bmw3', 'BMW 3 SERIES', 'LUXURY SEDAN', { top: 235, tAcc: 6.2, mass: 1600, len: 4.71, grip: 1.05 }),
  a4: veh('a4', 'AUDI A4', 'LUXURY SEDAN', { top: 241, tAcc: 7.1, mass: 1580, len: 4.76, grip: 1.05 }),
  cclass: veh('cclass', 'MERCEDES-BENZ C-CLASS', 'LUXURY SEDAN', { top: 246, tAcc: 7.3, mass: 1650, len: 4.79, grip: 1.05 }),
  q7: veh('q7', 'AUDI Q7', 'LUXURY SUV', { top: 250, tAcc: 5.9, mass: 2150, len: 5.06, grip: 0.98, yaw: 180 }),
  activa: veh('activa', 'HONDA ACTIVA', 'SCOOTER', { kind: 'bike', ride: 'scooter', top: 85, tAcc: 8.6, vAcc: 60, mass: 106, len: 1.83, voice: 1.25, yaw: 180 }),
  scooter125: veh('scooter125', '125CC SCOOTER', 'SCOOTER', { kind: 'bike', ride: 'scooter', top: 90, tAcc: 7.8, vAcc: 60, mass: 104, len: 1.87, voice: 1.25, yaw: 180 }),
  pulsar: veh('pulsar', 'BAJAJ PULSAR 150', 'COMMUTER', { kind: 'bike', ride: 'naked', top: 115, tAcc: 4.8, vAcc: 60, mass: 148, len: 2.06, voice: 1.3 }),
  apache: veh('apache', 'TVS APACHE RTR 180', 'STREET', { kind: 'bike', ride: 'naked', top: 124, tAcc: 4.1, vAcc: 60, mass: 139, len: 2.08, voice: 1.35 }),
  classic350: veh('classic350', 'ROYAL ENFIELD CLASSIC 350', 'CRUISER', { kind: 'bike', ride: 'cruiser', top: 115, tAcc: 5.0, vAcc: 60, mass: 195, len: 2.15, voice: 0.85 }),
  duke390: veh('duke390', 'KTM 390 DUKE', 'NAKED SPORT', { kind: 'bike', ride: 'naked', top: 167, tAcc: 5.5, mass: 168, len: 2.0, grip: 1.08, voice: 1.4 }),
  fz: veh('fz', 'YAMAHA FZ', 'STREET', { kind: 'bike', ride: 'naked', top: 115, tAcc: 4.5, vAcc: 60, mass: 136, len: 1.99, voice: 1.3, yaw: 180 }),
  rx100: veh('rx100', 'YAMAHA RX100', 'CLASSIC 2-STROKE', { kind: 'bike', ride: 'naked', top: 100, tAcc: 7.5, vAcc: 60, mass: 103, len: 1.93, voice: 1.55 }),
  jupiter: veh('jupiter', 'TVS JUPITER', 'SCOOTER', { kind: 'bike', ride: 'scooter', top: 82, tAcc: 9.0, vAcc: 60, mass: 109, len: 1.85, voice: 1.25 }),
  policejeep: veh('policejeep', 'POLICE JEEP', 'POLICE', { top: 140, tAcc: 14, mass: 1700, len: 4.1, hidden: true }),
  ninja: veh('ninja', 'KAWASAKI NINJA 300', 'SPORT', { kind: 'bike', ride: 'sport', top: 180, tAcc: 6.5, mass: 179, len: 2.02, grip: 1.1, voice: 1.5, yaw: 180 }),
  ferrari: {
    name: 'FERRARI 458 SPIDER', url: 'models/ferrari.glb', power: 1.0, grip: 1.0, mass: 1500, legacy: true,
    stats: { speed: 0.78, accel: 0.8, handling: 0.88 },
    wheels: ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'],
    paint: (o) => o.name === 'body', glass: (o) => o.name === 'glass',
    brake: (o) => o.name === 'brakes', head: (o) => o.name === 'lights',
  },
  concept: {
    name: 'CONCEPT HYPERCAR', url: 'models/carconcept.glb', power: 1.12, grip: 0.95, mass: 1450, legacy: true,
    stats: { speed: 0.9, accel: 0.88, handling: 0.74 },
    wheels: ['WheelFrontL', 'WheelFrontR', 'WheelRearL', 'WheelRearR'],
    paint: (o) => /^Paint 1/.test(o.material?.name || ''), glass: (o) => o.material?.name === 'Glass',
    brake: (o) => o.material?.name === 'Brakelight', head: (o) => o.material?.name === 'Headlight',
  },
};
for (const c of Object.values(CARS)) if (c.auto) {
  c.stats = { speed: Math.min(1, c.top / 260), accel: Math.max(0.08, Math.min(1, 1.15 - c.tAcc * (c.vAcc === 60 ? 1.6 : 1) / 14)), handling: Math.min(1, c.grip * 0.8) };
  c.paint ||= (o) => MAT.paint.test(o.material?.name || '') && !MAT.skip.test(o.material?.name || '');
  c.glass ||= (o) => MAT.glass.test(o.material?.name || '');
  c.brake ||= (o) => MAT.brake.test(o.material?.name || '');
  c.head ||= (o) => !MAT.brake.test(o.material?.name || '') && MAT.head.test(o.material?.name || '');
}
// Selectable vehicles: the Indian roster once downloaded, otherwise the bundled cars. Filled by loadCarModels.
export let CAR_IDS = [];
export let POLICE_CAR = 'ferrari';
export let VEHICLE_CREDITS = {};
const physOpts = (c) => (c.auto ? { top: c.top, tAcc: c.tAcc, vAcc: c.vAcc, grip: c.grip, bike: c.kind === 'bike', ...(c.kind === 'bike' ? { hw: 0.42, hl: 1.0, half: 1.0, r: 0.42 } : {}) }
  : { power: c.power, grip: c.grip });
export const vehicleOpts = (id) => physOpts(CARS[id] || CARS[CAR_IDS[0]]);
export const vehicleMass = (id) => { const c = CARS[id] || {}; return (c.mass || 1500) + (c.kind === 'bike' ? 75 : 0); };

const protos = {};
let aoTex = null, beamTex = null;
const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x0b0e12, metalness: 0.3, roughness: 0.04, transparent: true, opacity: 0.72, envMapIntensity: 1.6 });
const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff3dc, emissiveIntensity: 4 });
const flameOuter = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 0.75, 0.18), transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false });
const flameInner = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 1.2, 4.2), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });

// Vehicle textures are GPU-compressed KTX2 (Basis), transcoded in the browser to whatever the GPU supports.
let ktx2 = null, gl = null;
export function initTextureDecoder(renderer) {
  gl = renderer;
  ktx2 = new KTX2Loader().setTranscoderPath('vendor/three/examples/jsm/libs/basis/').detectSupport(renderer);
}
export function gltfLoader() {
  const draco = new DRACOLoader();
  draco.setDecoderPath('vendor/three/examples/jsm/libs/draco/gltf/');
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  if (ktx2) loader.setKTX2Loader(ktx2);
  return loader;
}

// Rotates/offsets a loaded model so it faces +Z, sits on y=0 and is centred between its wheels.
export function normalizeVehicle(scene, wheelNames, scale = 1, targetLen = 0, yawDeg = 0) {
  const norm = new THREE.Group();
  norm.add(scene);
  scene.scale.multiplyScalar(scale);
  scene.rotation.y += (yawDeg * Math.PI) / 180;
  norm.updateMatrixWorld(true);
  if (targetLen) { // drop SketchUp edge lines and baked ground/shadow planes that some downloads include
    const lines = [];
    scene.traverse((o) => { if (o.isLine || o.isPoints) lines.push(o); });
    for (const o of lines) o.removeFromParent();
    const meshes = [];
    scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
    const size = meshes.map((o) => new THREE.Box3().setFromObject(o, true).getSize(new THREE.Vector3()));
    const hz = size.map((s) => Math.max(s.x, s.z)), med = [...hz].sort((a, b) => a - b)[hz.length >> 1] || 1;
    meshes.forEach((o, i) => {
      const named = /shadow|ground|floor/i.test(`${o.name} ${o.material?.name || ''}`);
      const big = Math.max(size[i].x, size[i].y, size[i].z), thin = Math.min(size[i].x, size[i].y, size[i].z);
      const box = big > med * 4 && o.geometry.attributes.position.count < 200; // studio cube around the model
      if (meshes.length > 1 && (named || box || (thin < big * 0.004 && big > med * 3))) o.removeFromParent(); // ground or backdrop
    });
    norm.updateMatrixWorld(true);
  }
  if (targetLen && !wheelNames.length) { // no wheel nodes: put the longer horizontal axis along +Z
    const b = new THREE.Box3().setFromObject(scene, true);
    if (b.max.x - b.min.x > b.max.z - b.min.z) { scene.rotation.y += Math.PI / 2; norm.updateMatrixWorld(true); }
  }
  const objs = wheelNames.map((n) => (typeof n === 'string' ? scene.getObjectByName(n) : n));
  const centre = (o) => new THREE.Box3().setFromObject(o, true).getCenter(new THREE.Vector3());
  const wheels = () => objs.map((o) => o && centre(o));
  let wp = wheels();
  const hasWheels = wp.length > 0 && wp.every(Boolean);
  if (hasWheels) { // first half of the list = front wheels
    const h = wp.length / 2, fwd = new THREE.Vector3();
    wp.forEach((p, i) => fwd.addScaledVector(p, i < h ? 1 : -1));
    scene.rotation.y += -Math.atan2(fwd.x, fwd.z);
    norm.updateMatrixWorld(true);
    wp = wheels();
  }
  if (targetLen) {
    const b0 = new THREE.Box3().setFromObject(scene, true);
    scene.scale.multiplyScalar(targetLen / Math.max(0.1, b0.max.z - b0.min.z));
    norm.updateMatrixWorld(true);
    wp = hasWheels ? wheels() : wp;
  }
  const box = new THREE.Box3().setFromObject(scene);
  let cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
  if (hasWheels) {
    const c = wp.reduce((a, v) => a.add(v), new THREE.Vector3()).multiplyScalar(1 / wp.length);
    cx = c.x; cz = c.z;
  }
  let groundY = box.min.y;
  if (hasWheels) {
    groundY = Infinity;
    for (const o of objs) groundY = Math.min(groundY, new THREE.Box3().setFromObject(o, true).min.y);
  }
  scene.position.x -= cx; scene.position.z -= cz; scene.position.y -= groundY;
  norm.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(scene);
  return { norm, dims: { w: b.max.x - b.min.x, h: b.max.y, minZ: b.min.z, maxZ: b.max.z, l: b.max.z - b.min.z } };
}

// Merges a car's meshes by material (body and each wheel separately) to cut draw calls ~3x.
function bakeCar(norm, cfg) {
  norm.updateMatrixWorld(true);
  const wheels = cfg.wheelObjs || cfg.wheels.map((n) => norm.getObjectByName(n));
  const groups = new Map();
  const meshes = [];
  norm.traverse((o) => { if (o.isMesh) meshes.push(o); });
  for (const o of meshes) {
    let container = norm;
    for (let p = o.parent; p; p = p.parent) if (wheels.includes(p)) { container = p; break; }
    const role = cfg.paint(o) ? 'paint' : cfg.glass(o) ? 'glass' : cfg.brake(o) ? 'brake' : cfg.head(o) ? 'head' : 'other';
    const g = o.geometry;
    const sig = Object.keys(g.attributes).sort().join() + (g.index ? '|i' : '|n') + (g.morphAttributes && Object.keys(g.morphAttributes).length ? '|m' : '');
    const key = container.uuid + role + o.material.uuid + sig;
    o.userData.role = role;
    if (!groups.has(key)) groups.set(key, { container, role, material: o.material, list: [] });
    groups.get(key).list.push(o);
  }
  const inv = new THREE.Matrix4(), m = new THREE.Matrix4();
  for (const { container, role, material, list } of groups.values()) {
    inv.copy(container.matrixWorld).invert();
    const geos = list.map((o) => o.geometry.clone().applyMatrix4(m.multiplyMatrices(inv, o.matrixWorld)));
    const merged = list.length > 1 ? mergeGeometries(geos) : geos[0];
    if (!merged) continue;
    for (const o of list) {
      for (const c of [...o.children]) o.parent.attach(c); // keep subtrees (e.g. wheels parented to a body mesh)
      o.removeFromParent();
    }
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = role; mesh.userData.role = role;
    container.add(mesh);
  }
}

// Finds wheel nodes by name in a downloaded model: 4 for cars (front pair first), 2 for bikes (front first).
// The longer horizontal axis is the vehicle length; cfg.flip swaps front/back when a model is authored backwards.
export function autoWheels(scene, cfg) {
  scene.updateMatrixWorld(true);
  const want = cfg.kind === 'bike' ? 2 : 4;
  const re = /wheel|tire|tyre|rueda|roue|rad\b/i, bad = /steer|cover|arch|well|fender|guard|cap|bolt|nut|brake|disc|caliper|spoke/i;
  const cands = [];
  scene.traverse((o) => { if (o !== scene && re.test(o.name) && !bad.test(o.name)) cands.push(o); });
  const isAnc = (a, b) => { for (let p = b.parent; p; p = p.parent) if (p === a) return true; return false; };
  let tops = cands.filter((o) => !cands.some((q) => q !== o && isAnc(q, o)));
  if (tops.length !== want) return null;
  const c = tops.map((o) => new THREE.Box3().setFromObject(o, true).getCenter(new THREE.Vector3()));
  const box = new THREE.Box3().setFromObject(scene, true);
  const axis = box.max.x - box.min.x > box.max.z - box.min.z ? 'x' : 'z';
  const order = tops.map((o, i) => i).sort((a, b) => c[b][axis] - c[a][axis]);
  if (cfg.flip) order.reverse();
  tops = order.map((i) => tops[i]);
  tops.forEach((o, i) => { o.name = `__wheel${i}`; });
  return tops;
}

// Vehicles load on demand: at boot only the player's car and the police car, others when someone picks them.
const loading = {};
let loader = null;
export const carLoaded = (id) => !!protos[id];
// Car prototypes live for the whole session, so once every texture of a model is on the GPU their pixel data can leave
// JS memory. (Textures in one model can share image data, hence waiting for all of them.)
function releaseTexturesWhenUploaded(root) {
  const ts = new Set();
  root.traverse((o) => { for (const m of [].concat(o.material || [])) for (const k in m) if (m[k]?.isTexture) ts.add(m[k]); });
  const onGpu = (t) => { const p = gl.properties.get(t); return p.__webglTexture !== undefined && p.__version === t.version; };
  const check = () => {
    if (![...ts].every(onGpu)) return;
    for (const t of ts) {
      t.onUpdate = null;
      for (const m of t.mipmaps || []) m.data = null; // KTX2 levels
      if (!t.isCompressedTexture && t.source.data) { t.source.data.close?.(); t.source.data = null; }
    }
  };
  for (const t of ts) t.onUpdate = () => queueMicrotask(check); // runs after three.js records the upload
}
export function ensureCar(id, onProgress) {
  return (loading[id] ||= (async () => {
    const cfg = CARS[id];
    const gltf = await (loader ||= gltfLoader()).loadAsync(cfg.url, (e) => { if (e.total) onProgress?.(e.loaded / e.total); });
    // Hide any kickstand/sidestand so bikes don't ride with the stand down.
    if (cfg.kind === 'bike') {
      const strays = [];
      gltf.scene.traverse((o) => { if (o !== gltf.scene && /kickstand|sidestand|side[_-]?stand/i.test(o.name)) strays.push(o); });
      for (const o of strays) o.removeFromParent();
    }
    if (cfg.auto) {
      const wheels = autoWheels(gltf.scene, cfg);
      cfg.wheelObjs = wheels || [];
      cfg.wheels = (wheels || []).map((o) => o.name);
      protos[id] = normalizeVehicle(gltf.scene, cfg.wheelObjs, 1, cfg.len, cfg.yaw || 0);
    } else protos[id] = normalizeVehicle(gltf.scene, cfg.wheels);
    bakeCar(protos[id].norm, cfg);
    releaseTexturesWhenUploaded(protos[id].norm);
    return id;
  })());
}

export async function loadCarModels(onProgress, want = []) {
  // downloaded vehicles are listed in their credits manifest (scripts/fetch-vehicles.py)
  const have = await fetch('models/vehicles/credits.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  VEHICLE_CREDITS = have;
  const indian = Object.keys(CARS).filter((id) => CARS[id].auto && have[id]);
  CAR_IDS = indian.filter((id) => !CARS[id].hidden);
  if (!CAR_IDS.length) CAR_IDS = Object.keys(CARS).filter((id) => CARS[id].legacy);
  POLICE_CAR = ['policejeep', 'scorpio'].find((id) => indian.includes(id)) || CAR_IDS[0];
  const first = [...new Set([...want.filter((id) => CAR_IDS.includes(id)), CAR_IDS[0], POLICE_CAR])];
  const prog = {};
  await Promise.all(first.map((id) => ensureCar(id, (f) => { prog[id] = f; onProgress?.(first.reduce((a, k) => a + (prog[k] || 0), 0) / first.length); })));
  aoTex = await new THREE.TextureLoader().loadAsync('models/ferrari_ao.png');
  const c = document.createElement('canvas'); c.width = 64; c.height = 256;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.25, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 256);
  const h = x.createLinearGradient(0, 0, 64, 0);
  h.addColorStop(0, 'rgba(0,0,0,1)'); h.addColorStop(0.3, 'rgba(0,0,0,0)'); h.addColorStop(0.7, 'rgba(0,0,0,0)'); h.addColorStop(1, 'rgba(0,0,0,1)');
  x.globalCompositeOperation = 'destination-out'; x.fillStyle = h; x.fillRect(0, 0, 64, 256);
  beamTex = new THREE.CanvasTexture(c);
}

function nameTag(name, color) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 96;
  const x = c.getContext('2d');
  x.font = 'italic 900 52px "Arial Black", Impact, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.lineWidth = 8; x.strokeStyle = 'rgba(0,0,0,0.85)'; x.strokeText(name, 256, 50);
  x.fillStyle = '#fff'; x.fillText(name, 256, 50);
  x.fillStyle = color; x.fillRect(156, 84, 200, 6);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
  s.scale.set(4.4, 0.82, 1);
  return s;
}

const _q = new THREE.Quaternion(), _x = new THREE.Vector3(1, 0, 0), _m = new THREE.Matrix4();

// Low-poly rider posed for the bike type, sized from the bike's dimensions. Helmet takes the player's colour.
const riderMats = {
  suit: new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.6, metalness: 0.05 }),
  pants: new THREE.MeshStandardMaterial({ color: 0x1a1c22, roughness: 0.7 }),
  pad: new THREE.MeshStandardMaterial({ color: 0xc23a2a, roughness: 0.55, metalness: 0.05 }),
  skin: new THREE.MeshStandardMaterial({ color: 0x8a5a3c, roughness: 0.7 }),
  visor: new THREE.MeshPhysicalMaterial({ color: 0x05070a, roughness: 0.03, metalness: 0.6, clearcoat: 1, clearcoatRoughness: 0.02 }),
  glove: new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.5 }),
  boot: new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.55, metalness: 0.1 }),
};
const POSE = { // torso forward lean (rad), seat height, seat z, bar height, bar z, foot z (fractions of length / metres)
  sport: { lean: 0.95, seatY: 0.8, seatZ: -0.14, barY: 0.86, barZ: 0.26, footY: 0.36, footZ: -0.12, knee: 0.3 },
  naked: { lean: 0.42, seatY: 0.8, seatZ: -0.12, barY: 1.0, barZ: 0.24, footY: 0.32, footZ: -0.05, knee: 0.28 },
  scooter: { lean: 0.12, seatY: 0.76, seatZ: -0.1, barY: 1.02, barZ: 0.2, footY: 0.3, footZ: 0.12, knee: 0.34 },
  cruiser: { lean: 0.05, seatY: 0.74, seatZ: -0.12, barY: 1.02, barZ: 0.22, footY: 0.34, footZ: 0.18, knee: 0.3 },
};
function buildRider(parent, d, ride = 'naked', color = 0xffffff) {
  const P = POSE[ride] || POSE.naked, L = d.l, zc = (d.minZ + d.maxZ) / 2;
  const g = new THREE.Group();
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const limb = (a, b, r, mat, taper = 1) => {
    const len = a.distanceTo(b);
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.01, len - 2 * r), 5, 10), mat);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize());
    if (taper !== 1) m.scale.z = taper;
    g.add(m); return m;
  };
  const dir = V(0, Math.cos(P.lean), Math.sin(P.lean));
  const hip = V(0, P.seatY + 0.12, zc + P.seatZ * L);
  const chest = hip.clone().addScaledVector(dir, 0.34);
  const neck = hip.clone().addScaledVector(dir, 0.58);
  // Pelvis and chest torso built separately so the rider has shoulders and a tapered waist.
  const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.18, 0.3), riderMats.pants);
  pelvis.position.copy(hip); g.add(pelvis);
  limb(hip, chest, 0.18, riderMats.suit, 0.72);
  limb(chest, neck, 0.16, riderMats.suit, 0.9);
  // Shoulder pads give the jacket a visible profile.
  for (const sx of [-1, 1]) {
    const pad = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), riderMats.suit);
    pad.position.copy(chest).add(V(sx * 0.19, 0.03, 0)); g.add(pad);
  }
  // Chest number panel just hints at a jacket graphic.
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.015), riderMats.pad);
  panel.position.copy(chest).add(dir.clone().multiplyScalar(0.17)).add(V(0, -0.02, 0));
  panel.quaternion.setFromUnitVectors(V(0, 0, 1), dir); g.add(panel);
  // Helmet: ellipsoid elongated along forward axis, with a chinstrap and brow visor.
  const helmetMat = new THREE.MeshPhysicalMaterial({ color, metalness: 0.3, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.03 });
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 20, 16), helmetMat);
  head.position.copy(neck).addScaledVector(dir, 0.17); head.position.z += 0.03;
  head.scale.set(0.92, 1.0, 1.08); g.add(head);
  const chin = new THREE.Mesh(new THREE.SphereGeometry(0.14, 14, 10, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.45), riderMats.suit);
  chin.position.copy(head.position).add(dir.clone().multiplyScalar(0.03)).add(V(0, -0.08, 0)); g.add(chin);
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.172, 16, 10, -0.95, 1.9, 0.85, 0.6), riderMats.visor);
  visor.position.copy(head.position); g.add(visor);
  const brow = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.03, 0.08), riderMats.suit);
  brow.position.copy(head.position).add(dir.clone().multiplyScalar(0.1)).add(V(0, 0.1, 0));
  brow.quaternion.setFromUnitVectors(V(0, 0, 1), dir); g.add(brow);
  for (const sx of [-1, 1]) {
    const sh = chest.clone().add(V(sx * 0.2, 0.04, 0));
    const grip = V(sx * 0.32, P.barY, zc + P.barZ * L);
    const elbow = sh.clone().lerp(grip, 0.5).add(V(sx * 0.07, -0.08, -0.02));
    limb(sh, elbow, 0.065, riderMats.suit); limb(elbow, grip, 0.052, riderMats.suit);
    const elbowPad = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), riderMats.pad);
    elbowPad.position.copy(elbow).add(V(sx * 0.03, 0.02, -0.02)); g.add(elbowPad);
    const glove = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.08, 0.11), riderMats.glove);
    glove.position.copy(grip); g.add(glove);
    const gauntlet = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.052, 0.09, 10), riderMats.glove);
    gauntlet.position.copy(grip).add(V(0, 0.045, -0.045)); g.add(gauntlet);
    const hp = hip.clone().add(V(sx * 0.12, 0, 0));
    const foot = V(sx * (ride === 'scooter' ? 0.16 : 0.2), P.footY, zc + P.footZ * L);
    const knee = V(sx * 0.2, P.seatY + 0.08, zc + (P.seatZ + P.knee) * L);
    limb(hp, knee, 0.095, riderMats.pants); limb(knee, foot, 0.07, riderMats.pants);
    const kneePad = new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 8), riderMats.pad);
    kneePad.position.copy(knee).add(V(sx * 0.02, 0.01, 0.03)); g.add(kneePad);
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.11, 0.3), riderMats.boot);
    boot.position.copy(foot).add(V(0, -0.01, 0.08)); g.add(boot);
    const toe = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.06), riderMats.boot);
    toe.position.copy(foot).add(V(0, -0.025, 0.23)); g.add(toe);
    const bootCollar = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.06, 0.1, 10), riderMats.boot);
    bootCollar.position.copy(foot).add(V(0, 0.05, 0)); g.add(bootCollar);
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  g.userData.helmet = helmetMat;
  parent.add(g);
  return g;
}

// One merged, vertex-coloured rider mesh for instanced traffic (white helmet takes the instance colour).
export function riderGeometry(d, ride) {
  const holder = new THREE.Group();
  const g = buildRider(holder, d, ride, 0xffffff);
  holder.updateMatrixWorld(true);
  const geos = [];
  g.traverse((o) => {
    if (!o.isMesh) return;
    const geo = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(o.matrixWorld);
    const c = o.material === g.userData.helmet ? new THREE.Color(1, 1, 1) : o.material.color.clone().multiplyScalar(o.material === riderMats.suit ? 1.6 : 1);
    const col = new Float32Array(geo.attributes.position.count * 3);
    for (let i = 0; i < col.length; i += 3) { col[i] = c.r; col[i + 1] = c.g; col[i + 2] = c.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'color'].includes(k)) geo.deleteAttribute(k);
    geos.push(geo);
  });
  g.userData.helmet.dispose();
  return mergeGeometries(geos);
}

export class CarVisual {
  constructor(carId, color, { police = false, name = null, beam = true } = {}) {
    const id = protos[carId] ? carId : protos[CAR_IDS[0]] ? CAR_IDS[0] : 'ferrari';
    const cfg = CARS[id], proto = protos[id];
    this.carId = id;
    this.root = new THREE.Group();
    const model = proto.norm.clone(true);
    this.root.add(model);
    this.root.position.y = 0.02;
    this.police = police;
    const d = proto.dims;
    this.dims = d;

    this.bodyMat = new THREE.MeshPhysicalMaterial({
      color: police ? 0x08090c : color, metalness: police ? 0.6 : 1.0, roughness: police ? 0.3 : 0.4,
      clearcoat: 1.0, clearcoatRoughness: 0.03,
    });
    this.brakeMat = new THREE.MeshStandardMaterial({ color: 0x2a0000, emissive: 0xff1508, emissiveIntensity: 1.5 });
    model.traverse((o) => {
      if (!o.isMesh) return;
      const role = o.userData.role;
      if (role === 'paint') o.material = this.bodyMat;
      else if (role === 'glass') o.material = glassMat;
      else if (role === 'brake') o.material = this.brakeMat;
      else if (role === 'head') o.material = headMat;
    });

    // Wheels spin about their own axle; front wheels get a steering pivot about the car's up axis.
    this.root.updateMatrixWorld(true);
    this.wheels = cfg.wheels.map((n, i) => {
      const w = model.getObjectByName(n);
      const box = new THREE.Box3().setFromObject(w, true);
      const radius = Math.max(0.25, (box.max.y - box.min.y) / 2);
      const axle = _x.clone().applyQuaternion(w.getWorldQuaternion(new THREE.Quaternion()));
      const entry = { obj: w, base: w.quaternion.clone(), sign: Math.sign(axle.x) || 1, radius };
      if (i < (cfg.kind === 'bike' ? 1 : 2)) {
        const parent = w.parent;
        const pivot = new THREE.Group();
        pivot.position.copy(w.position);
        parent.add(pivot);
        w.position.set(0, 0, 0);
        pivot.add(w);
        entry.pivot = pivot;
        entry.up = new THREE.Vector3(0, 1, 0).transformDirection(_m.copy(parent.matrixWorld).invert());
      }
      return entry;
    });
    this.spin = 0;

    this.bike = cfg.kind === 'bike';
    this.model = model;
    if (this.bike) this.rider = buildRider(model, d, cfg.ride, color);
    const ao = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(d.w, this.bike ? 0.9 : 0) * 1.16, d.l * 1.15),
      new THREE.MeshBasicMaterial({ map: aoTex, blending: THREE.MultiplyBlending, toneMapped: false, transparent: true, depthWrite: false }));
    ao.rotation.x = -Math.PI / 2; ao.position.set(0, 0.015, (d.minZ + d.maxZ) / 2); ao.renderOrder = 2;
    this.root.add(ao);

    this.flames = new THREE.Group();
    for (const sx of this.bike ? [0] : [-0.17, 0.17]) {
      const o = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.8, 10, 1, true), flameOuter);
      o.rotation.x = -Math.PI / 2; o.position.set(sx, 0.4, d.minZ - 0.4);
      const i = new THREE.Mesh(new THREE.ConeGeometry(0.065, 0.5, 8, 1, true), flameInner);
      i.rotation.x = -Math.PI / 2; i.position.set(sx, 0.4, d.minZ - 0.25);
      this.flames.add(o, i);
    }
    this.flames.visible = false;
    this.root.add(this.flames);

    if (beam) {
      const b = new THREE.Mesh(new THREE.PlaneGeometry(7.5, 24),
        new THREE.MeshBasicMaterial({ map: beamTex, color: 0xfff1d8, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false }));
      b.rotation.x = -Math.PI / 2; b.position.set(0, 0.04, d.maxZ + 12);
      this.root.add(b);
      this.beam = b;
    }

    if (police) {
      const bar = new THREE.Group();
      bar.position.set(0, d.h + 0.01, (d.minZ + d.maxZ) / 2 - 0.15);
      const base = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.1, 0.28), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4 }));
      this.redMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
      this.blueMat = new THREE.MeshBasicMaterial({ color: 0x0033ff });
      const red = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.24), this.redMat); red.position.set(-0.29, 0.09, 0);
      const blue = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.24), this.blueMat); blue.position.set(0.29, 0.09, 0);
      bar.add(base, red, blue);
      this.root.add(bar);
    }
    this.lightsOn = true;
    if (name) { this.tag = nameTag(name, color); this.tag.position.y = d.h + (this.bike ? 1.9 : 1.35); this.root.add(this.tag); }
  }

  // s: {x,z,yaw,fwd,steer,braking,nitro}
  update(dt, s, t) {
    const wheelie = this.bike ? (s.wheelie || 0) : 0;
    const halfL = ((this.dims?.l) || 2) * 0.5;
    this.root.position.set(s.x, (s.y || 0) + 0.02 + Math.sin(wheelie) * halfL, s.z);
    // bikes lean into turns (from physics, or estimated from steering for remote players)
    const lean = this.bike ? -(s.lean ?? Math.max(-0.7, Math.min(0.7, -(s.steer || 0) * Math.min(1, Math.abs(s.fwd || 0) / 18) * 0.7))) : 0;
    this.root.rotation.set(-(s.pitch || 0) - wheelie, s.yaw, lean, 'YXZ');
    this.spin += (s.fwd ?? 0) * dt;
    const steer = -(s.steer || 0) * 0.5;
    for (const w of this.wheels) {
      w.obj.quaternion.copy(w.base).multiply(_q.setFromAxisAngle(_x, w.sign * this.spin / w.radius));
      if (w.pivot) w.pivot.quaternion.setFromAxisAngle(w.up, steer);
    }
    this.brakeMat.emissiveIntensity = s.braking ? 9 : 1.6;
    this.flames.visible = !!s.nitro;
    if (s.nitro) this.flames.scale.set(1, 1, 0.75 + Math.random() * 0.5);
    if (this.police) {
      const phase = Math.floor(t * 8) % 4;
      const on = this.lightsOn;
      this.redMat.color.setRGB(on && phase < 2 ? 12 : 0.15, 0, 0);
      this.blueMat.color.setRGB(0, on ? (phase >= 2 ? 1.5 : 0.02) : 0.01, on && phase >= 2 ? 14 : 0.15);
    }
  }

  setColor(c) {
    this.bodyMat.color.set(c);
    this.rider?.userData.helmet.color.set(c);
  }

  dispose() {
    this.root.removeFromParent();
    this.bodyMat.dispose(); this.brakeMat.dispose();
    if (this.rider) { this.rider.traverse((o) => { o.geometry?.dispose(); }); this.rider.userData.helmet.dispose(); }
    if (this.tag) { this.tag.material.map.dispose(); this.tag.material.dispose(); }
  }
}
