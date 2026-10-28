import * as THREE from 'three';

// Splits huge static meshes (road, kerbs, pavements, buildings, terrain, trees, wires...) into CELL-sized tiles so the
// renderer can skip everything off screen. Tiles share the original vertex buffers and only get their own index list,
// so memory barely grows. Moving objects (userData.dynamic, dynamic instance buffers, anything in `skip`) are left alone.
const CELL = 400;
const cellOf = (x, z) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;

export function chunkStatic(root, skip = new Set()) {
  const targets = [];
  root.traverse((o) => {
    if (skip.has(o) || o.userData.dynamic || !o.geometry?.attributes?.position) return;
    if (o.isInstancedMesh) { if (o.instanceMatrix.usage !== THREE.DynamicDrawUsage && o.count > 32) targets.push(o); return; }
    if ((o.isMesh || o.isLineSegments) && !Array.isArray(o.material) && !o.geometry.groups.length && !o.isSkinnedMesh) targets.push(o);
  });
  let tiles = 0;
  for (const o of targets) tiles += o.isInstancedMesh ? splitInstanced(o) : splitMesh(o);
  return tiles;
}

function splitMesh(o) {
  const g = o.geometry, pos = g.attributes.position, idx = g.index;
  const stride = o.isLineSegments ? 2 : 3, count = idx ? idx.count : pos.count;
  if (count / stride < 600) return 0;
  g.computeBoundingBox();
  o.updateMatrixWorld(true);
  const bb = g.boundingBox.clone().applyMatrix4(o.matrixWorld);
  if (Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) < CELL * 1.5) return 0;
  const e = o.matrixWorld.elements, cells = new Map();
  for (let k = 0; k < count; k += stride) {
    let x = 0, y = 0, z = 0;
    for (let j = 0; j < stride; j++) { const v = idx ? idx.getX(k + j) : k + j; x += pos.getX(v); y += pos.getY(v); z += pos.getZ(v); }
    x /= stride; y /= stride; z /= stride;
    const key = cellOf(e[0] * x + e[4] * y + e[8] * z + e[12], e[2] * x + e[6] * y + e[10] * z + e[14]);
    let list = cells.get(key); if (!list) cells.set(key, list = []);
    for (let j = 0; j < stride; j++) list.push(idx ? idx.getX(k + j) : k + j);
  }
  if (cells.size < 2) return 0;
  const parent = o.parent;
  for (const list of cells.values()) {
    const cg = new THREE.BufferGeometry();
    for (const name in g.attributes) cg.setAttribute(name, g.attributes[name]);
    cg.setIndex(new THREE.BufferAttribute(pos.count > 65535 ? new Uint32Array(list) : new Uint16Array(list), 1));
    const box = new THREE.Box3(), v = new THREE.Vector3();
    for (const i of list) box.expandByPoint(v.fromBufferAttribute(pos, i));
    cg.boundingBox = box;
    cg.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
    const tile = new (o.isLineSegments ? THREE.LineSegments : THREE.Mesh)(cg, o.material);
    tile.name = o.name; tile.renderOrder = o.renderOrder; tile.userData = o.userData;
    tile.position.copy(o.position); tile.quaternion.copy(o.quaternion); tile.scale.copy(o.scale);
    parent.add(tile);
  }
  parent.remove(o);
  return cells.size;
}

function splitInstanced(o) {
  o.updateMatrixWorld(true);
  const m = new THREE.Matrix4(), w = new THREE.Matrix4(), cells = new Map();
  for (let i = 0; i < o.count; i++) {
    o.getMatrixAt(i, m); w.multiplyMatrices(o.matrixWorld, m);
    const key = cellOf(w.elements[12], w.elements[14]);
    let list = cells.get(key); if (!list) cells.set(key, list = []);
    list.push(i);
  }
  if (cells.size < 2) return 0;
  const parent = o.parent, c = new THREE.Color();
  for (const list of cells.values()) {
    const tile = new THREE.InstancedMesh(o.geometry, o.material, list.length);
    list.forEach((src, i) => { o.getMatrixAt(src, m); tile.setMatrixAt(i, m); if (o.instanceColor) { o.getColorAt(src, c); tile.setColorAt(i, c); } });
    tile.name = o.name; tile.renderOrder = o.renderOrder; tile.userData = o.userData;
    tile.position.copy(o.position); tile.quaternion.copy(o.quaternion); tile.scale.copy(o.scale);
    tile.computeBoundingSphere();
    parent.add(tile);
  }
  parent.remove(o);
  return cells.size;
}

// Once the GPU has a copy, static scenery needs no vertex or pixel data in JS memory (well over 100 MB on long routes).
// Vertex buffers are dropped as they upload (bounding volumes are computed first, since culling needs them). Anything
// that moves or is updated later is skipped; traffic models, reused by every map, stay on the GPU (see markShared in
// traffic.js). A lost GPU context would need a reload.
const dropArray = function () { this.array = null; };
export function releaseOnUpload(root, skip = new Set()) {
  root.traverse((o) => {
    if (skip.has(o) || o.userData.dynamic || !o.geometry?.attributes) return;
    const g = o.geometry;
    if (!g.boundingSphere && g.attributes.position?.array) g.computeBoundingSphere();
    if (o.isInstancedMesh && o.instanceMatrix.usage !== THREE.DynamicDrawUsage) { // moving instances keep their buffers
      if (!o.boundingSphere) o.computeBoundingSphere();
      o.instanceMatrix.onUpload(dropArray);
      o.instanceColor?.onUpload(dropArray);
    }
    for (const a of [...Object.values(g.attributes), g.index]) {
      if (a && !a.isInterleavedBufferAttribute && a.usage !== THREE.DynamicDrawUsage) a.onUpload(dropArray);
    }
  });
}

// Texture images under root, once every texture sharing that image is on the GPU. Textures that are redrawn later
// mark themselves with userData.live.
export function releaseImages(root, renderer, skip = new Set()) {
  const bySource = new Map();
  const add = (t) => { if (!t?.isTexture) return; let l = bySource.get(t.source); if (!l) bySource.set(t.source, l = new Set()); l.add(t); };
  root.traverse((o) => {
    if (skip.has(o)) return;
    for (const m of [].concat(o.material || [])) {
      for (const k in m) add(m[k]);
      for (const k in m.uniforms || {}) add(m.uniforms[k].value);
    }
  });
  const onGpu = (t) => { const p = renderer.properties.get(t); return p.__webglTexture !== undefined && p.__version === t.version; };
  let n = 0;
  for (const [src, list] of bySource) {
    const ts = [...list];
    if (ts.some((t) => t.userData.live || t.isVideoTexture || t.isCompressedTexture || t.isDataTexture || !onGpu(t)) || !src.data) continue;
    src.data.close?.(); // ImageBitmap
    src.data = null;
    n++;
  }
  return n;
}

// Scenery never moves, so its transforms are computed once and the per-frame scene update skips those subtrees.
// Subtrees with userData.update (animated landmarks) keep updating; children added to root later update normally.
export function freezeStatic(root) {
  root.updateMatrixWorld(true);
  const freeze = (o) => {
    if (o.userData.update) return true;
    let live = false;
    for (const c of o.children) live = freeze(c) || live;
    o.matrixAutoUpdate = false;
    o.matrixWorldAutoUpdate = live;
    return live;
  };
  for (const c of root.children) freeze(c);
}
