import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Metro trains for the elevated lines, built in code so each city gets its real rolling stock look (see themes.js):
// stainless or painted car bodies, the line's livery band, window band, sliding doors and sloped driving cabs at
// both ends. One car is ~600 triangles; each car part is a single InstancedMesh, so a whole train is a few draw calls.
const CAR_L = 21, W = 2.9, H = 3.55, FLOOR = 1.1; // car length, body width, roof height, floor height above rail

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function tex(c) { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }

// Side of one car, as seen from outside: livery, 4 pairs of sliding doors, windows and the operator's name.
function sideTexture(L) {
  const [c, x] = canvas(1024, 192), [e, y] = canvas(1024, 192);
  const g = x.createLinearGradient(0, 0, 0, 192); g.addColorStop(0, L.body); g.addColorStop(1, L.bodyLow || L.body);
  x.fillStyle = g; x.fillRect(0, 0, 1024, 192);
  y.fillStyle = '#000'; y.fillRect(0, 0, 1024, 192);
  if (L.brushed) for (let i = 0; i < 192; i += 3) { x.fillStyle = `rgba(255,255,255,${0.04 + Math.random() * 0.05})`; x.fillRect(0, i, 1024, 1); }
  x.fillStyle = '#16191e'; x.fillRect(0, 34, 1024, 62); // window band
  const doors = [96, 352, 640, 896];
  for (let i = 0; i < 5; i++) {
    const wx = [8, 160, 420, 708, 960][i], ww = i === 0 || i === 4 ? 40 : 160;
    x.fillStyle = '#2b3440'; x.fillRect(wx, 40, ww, 50);
    y.fillStyle = '#fff2d6'; y.fillRect(wx + 3, 43, ww - 6, 44); // lit saloon at night
  }
  for (const dx of doors) {
    x.fillStyle = L.door || '#c9ced4'; x.fillRect(dx - 34, 28, 68, 140);
    x.fillStyle = '#20262d'; x.fillRect(dx - 30, 40, 26, 48); x.fillRect(dx + 4, 40, 26, 48);
    y.fillStyle = '#d9e6ff'; y.fillRect(dx - 28, 42, 22, 44); y.fillRect(dx + 6, 42, 22, 44);
    x.fillStyle = 'rgba(0,0,0,0.5)'; x.fillRect(dx - 1, 28, 2, 140);
  }
  for (const [col, top, h] of L.bands) { x.fillStyle = col; x.fillRect(0, top, 1024, h); for (const dx of doors) { x.fillStyle = col; x.fillRect(dx - 34, top, 68, h); } }
  x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(0, 186, 1024, 6);
  if (L.label) { x.fillStyle = L.labelColor || '#ffffff'; x.font = `700 22px ${L.font || 'Arial'}, Arial, sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(L.label, 512, 120); x.fillText(L.label, 224, 120); x.fillText(L.label, 768, 120); }
  return [tex(c), tex(e)];
}

// Driving cab front: windscreen, destination display and headlights.
function frontTexture(L) {
  const [c, x] = canvas(256, 256), [e, y] = canvas(256, 256);
  x.fillStyle = L.cab || L.body; x.fillRect(0, 0, 256, 256);
  y.fillStyle = '#000'; y.fillRect(0, 0, 256, 256);
  x.fillStyle = '#0d1116'; x.fillRect(20, 30, 216, 110); // windscreen
  x.fillStyle = '#000'; x.fillRect(60, 36, 136, 22); y.fillStyle = '#ffa31a'; y.font = '700 16px Arial'; y.textAlign = 'center'; y.textBaseline = 'middle'; y.fillText(L.dest || 'METRO', 128, 47);
  for (const [col, top, h] of L.cabBands || L.bands) { x.fillStyle = col; x.fillRect(0, top * 1.1 + 40, 256, h * 1.2); }
  for (const s of [40, 186]) { x.fillStyle = '#dfe6ee'; x.fillRect(s, 196, 30, 14); y.fillStyle = '#ffffff'; y.fillRect(s, 196, 30, 14); }
  return [tex(c), tex(e)];
}

// Car geometry: a body box mapped with the side texture, a rounded roof, the underframe with bogies, and (cab cars)
// a sloped nose. Built pointing +z, origin at rail level centre.
function carParts(cab) {
  const body = [], dark = [], front = [];
  const sideH = H - 0.35 - FLOOR;
  const b = new THREE.BoxGeometry(W, sideH, cab ? CAR_L - 1.6 : CAR_L).translate(0, FLOOR + sideH / 2, cab ? -0.8 : 0);
  // side faces (+x, -x) use the whole side texture (both read left to right); end/top/bottom faces a plain corner
  const uv = b.attributes.uv;
  for (let k = 0; k < uv.count; k++) if (Math.floor(k / 4) > 1) uv.setXY(k, 0.002, 0.995);
  body.push(b.toNonIndexed());
  const rs = new THREE.Shape(); rs.moveTo(-W / 2, 0); // half-ellipse cross-section, extruded along the car
  for (let k = 1; k <= 10; k++) { const a = Math.PI - (k / 10) * Math.PI; rs.lineTo((Math.cos(a) * W) / 2, Math.sin(a) * 0.35); }
  const rl = cab ? CAR_L - 1.6 : CAR_L;
  const roof = new THREE.ExtrudeGeometry(rs, { depth: rl, bevelEnabled: false }).translate(0, H - 0.35, -rl / 2 + (cab ? -0.8 : 0));
  const ruv = roof.attributes.uv; for (let k = 0; k < ruv.count; k++) ruv.setXY(k, 0.002, 0.995);
  body.push(roof.toNonIndexed());
  dark.push(new THREE.BoxGeometry(W - 0.4, 0.55, CAR_L - 1.2).translate(0, FLOOR - 0.3, 0).toNonIndexed());
  for (const bz of [-CAR_L / 2 + 3.2, CAR_L / 2 - 3.2]) {
    dark.push(new THREE.BoxGeometry(2.3, 0.55, 2.8).translate(0, 0.45, bz).toNonIndexed());
    for (const wz of [-0.95, 0.95]) for (const sx of [-1, 1]) dark.push(new THREE.CylinderGeometry(0.42, 0.42, 0.18, 10).rotateZ(Math.PI / 2).translate(sx * 0.78, 0.42, bz + wz).toNonIndexed());
  }
  if (cab) { // sloped nose: windscreen leaning back, mapped with the front texture
    const z0 = CAR_L / 2 - 1.6, s = new THREE.Shape();
    s.moveTo(0, FLOOR - 0.55); s.lineTo(1.25, FLOOR - 0.55); s.lineTo(1.6, FLOOR + 0.9); s.lineTo(0.75, H - 0.25); s.lineTo(0, H - 0.25);
    const n = new THREE.ExtrudeGeometry(s, { depth: W, bevelEnabled: false }).rotateY(-Math.PI / 2).translate(W / 2, 0, z0);
    const p = n.attributes.position, nuv = n.attributes.uv;
    n.computeVertexNormals();
    const nn = n.attributes.normal;
    for (let k = 0; k < p.count; k++) {
      if (Math.abs(nn.getX(k)) > 0.7) nuv.setXY(k, 0.002, 0.995); // side cheeks: body colour
      else nuv.setXY(k, (p.getX(k) + W / 2) / W, (p.getY(k) - (FLOOR - 0.55)) / (H - 0.25 - (FLOOR - 0.55)));
    }
    front.push(n.toNonIndexed());
  }
  return { body: mergeGeometries(body), dark: mergeGeometries(dark), front: front.length ? mergeGeometries(front) : null };
}

// A train: `cars` cars (cab cars at both ends, the rear one turned round). Returns { meshes, place(i, matrix) }.
export function buildTrain(L, cars) {
  const [side, sideE] = sideTexture(L), [fr, frE] = frontTexture(L);
  const mk = (map, emissiveMap, metal) => new THREE.MeshStandardMaterial({ map, emissiveMap, emissive: emissiveMap ? 0xffffff : 0x000000, emissiveIntensity: 0.7,
    metalness: metal ? 0.55 : 0.15, roughness: metal ? 0.35 : 0.5 });
  const bodyMat = mk(side, sideE, L.brushed), frontMat = mk(fr, frE, false), darkMat = new THREE.MeshStandardMaterial({ color: 0x1b1d21, roughness: 0.8 });
  const cab = carParts(true), mid = carParts(false);
  const inst = (geo, mat, n) => { const m = new THREE.InstancedMesh(geo, mat, n); m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false; m.userData.dynamic = true; return m; };
  const meshes = { cabBody: inst(cab.body, bodyMat, 2), cabDark: inst(cab.dark, darkMat, 2), cabFront: inst(cab.front, frontMat, 2),
    midBody: inst(mid.body, bodyMat, Math.max(1, cars - 2)), midDark: inst(mid.dark, darkMat, Math.max(1, cars - 2)) };
  meshes.midBody.count = meshes.midDark.count = Math.max(0, cars - 2);
  const flip = new THREE.Matrix4().makeRotationY(Math.PI), m2 = new THREE.Matrix4();
  return {
    meshes: Object.values(meshes), carLength: CAR_L + 0.6,
    // i = 0 is the leading car; matrices place a car centred on the rails, facing the direction of travel
    place(i, m) {
      if (i === 0 || i === cars - 1) {
        const k = i === 0 ? 0 : 1, mm = i === 0 ? m : m2.multiplyMatrices(m, flip);
        for (const name of ['cabBody', 'cabDark', 'cabFront']) meshes[name].setMatrixAt(k, mm);
      } else for (const name of ['midBody', 'midDark']) meshes[name].setMatrixAt(i - 1, m);
    },
    done() { for (const mesh of Object.values(meshes)) mesh.instanceMatrix.needsUpdate = true; },
  };
}
