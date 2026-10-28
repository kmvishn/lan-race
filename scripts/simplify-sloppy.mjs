// Fallback simplification for models the regular simplifier can't reduce (every vertex split by UV / normal seams,
// so all edges look like borders): weld, then meshoptimizer's sloppy simplifier per primitive towards a triangle
// budget. Used by fetch-vehicles.py on uncompressed intermediate files.
//   node scripts/simplify-sloppy.mjs in.glb out.glb <triangle budget> [max error]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, prune, normals, compactPrimitive } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

const [input, output, budget, maxError = '0.02'] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
await MeshoptSimplifier.ready;
const doc = await io.read(input);
await doc.transform(weld());
const prims = doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives()).filter((p) => p.getMode() === 4 && p.getIndices());
const total = prims.reduce((a, p) => a + p.getIndices().getCount() / 3, 0), ratio = Math.min(1, +budget / total);
let after = 0;
for (const p of prims) {
  const idx = p.getIndices(), pos = p.getAttribute('POSITION'), n = idx.getCount();
  if (n <= 36 || ratio >= 0.95) { after += n / 3; continue; }
  const target = Math.max(12, Math.floor((n * ratio) / 3) * 3);
  const [out] = MeshoptSimplifier.simplifySloppy(new Uint32Array(idx.getArray()), new Float32Array(pos.getArray()), 3, null, Math.min(target, n), +maxError);
  if (out.length < 3) { after += n / 3; continue; }
  idx.setArray(pos.getCount() > 65535 ? out : new Uint16Array(out));
  compactPrimitive(p); // drop the vertices no triangle uses any more
  after += out.length / 3;
}
// the old per-vertex normals no longer match the rewired triangles (blotchy shading): recompute them
await doc.transform(normals({ overwrite: true }), prune());
await io.write(output, doc);
console.log(Math.round(after));
