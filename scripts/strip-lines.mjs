// Removes line and point primitives (SketchUp edge lines and the like) from a GLB: the game never draws them, but
// they can be most of a download. node scripts/strip-lines.mjs in.glb out.glb
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(process.argv[2]);
let n = 0;
for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) if (p.getMode() < 4) { p.dispose(); n++; }
await doc.transform(prune());
await io.write(process.argv[3], doc);
console.log(n);
