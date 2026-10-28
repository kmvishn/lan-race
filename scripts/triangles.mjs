// Triangles drawn by a GLB (instanced meshes counted per use). Used by fetch-vehicles.py on uncompressed files.
//   node scripts/triangles.mjs model.glb
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const root = (await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(process.argv[2])).getRoot();
const tris = (m) => m.listPrimitives().filter((p) => p.getMode() === 4)
  .reduce((a, p) => a + (p.getIndices() ? p.getIndices().getCount() : p.getAttribute('POSITION').getCount()) / 3, 0);
console.log(Math.round(root.listNodes().reduce((a, n) => a + (n.getMesh() ? tris(n.getMesh()) : 0), 0)));
