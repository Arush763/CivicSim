import { Document, Logger, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, quantize } from '@gltf-transform/functions';
import type { SceneParts } from './build';
import type { MeshBuilder } from './geometry';
import { MATERIALS, type MaterialName } from './palette';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

/** One named node in the output; several nodes may share a material. */
export interface GlbNode {
  name: string;
  material: MaterialName;
  mesh: MeshBuilder;
}

/** Serialize scene parts to a binary glTF: one mesh + node per material. */
export function toGlb(parts: SceneParts, meta: Record<string, unknown>): Promise<Uint8Array> {
  return toGlbNodes([...parts].map(([material, mesh]) => ({ name: material, material, mesh })), meta);
}

/** Serialize named nodes to a binary glTF. Node names survive loading, so a client can find them. */
export async function toGlbNodes(nodes: GlbNode[], meta: Record<string, unknown>): Promise<Uint8Array> {
  const doc = new Document().setLogger(new Logger(Logger.Verbosity.WARN));
  const buffer = doc.createBuffer();
  const root = doc.createNode('tile').setExtras(meta);
  const scene = doc.createScene('scene').addChild(root);
  doc.getRoot().setDefaultScene(scene);

  const materials = new Map<MaterialName, ReturnType<Document['createMaterial']>>();
  const materialFor = (name: MaterialName) => {
    let m = materials.get(name);
    if (m) return m;
    const def = MATERIALS[name];
    m = doc
      .createMaterial(name)
      .setBaseColorFactor([...def.color, def.alpha ?? 1])
      .setRoughnessFactor(def.roughness ?? 0.9)
      .setMetallicFactor(def.metallic ?? 0)
      .setDoubleSided(name === 'highlight');
    if (def.emissive) m.setEmissiveFactor(def.emissive);
    if (def.alpha !== undefined && def.alpha < 1) m.setAlphaMode('BLEND');
    materials.set(name, m);
    return m;
  };

  for (const { name, material: matName, mesh: mb } of nodes) {
    if (mb.vertexCount === 0) continue;
    const material = materialFor(matName);

    const prim = doc
      .createPrimitive()
      .setMaterial(material)
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(mb.positions)).setBuffer(buffer))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(mb.normals)).setBuffer(buffer))
      .setIndices(
        doc
          .createAccessor()
          .setType('SCALAR')
          .setArray(mb.vertexCount > 65535 ? new Uint32Array(mb.indices) : new Uint16Array(mb.indices))
          .setBuffer(buffer),
      );
    if (mb.vertexColors) {
      prim.setAttribute('COLOR_0', doc.createAccessor().setType('VEC3').setArray(new Float32Array(mb.colors)).setBuffer(buffer));
    }
    root.addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim)));
  }

  // Quantization roughly halves size and decodes natively in three.js (no WASM decoder needed on Hermes).
  await doc.transform(dedup(), prune(), quantize({ quantizePosition: 14, quantizeNormal: 8, quantizeColor: 8 }));
  return io.writeBinary(doc);
}
