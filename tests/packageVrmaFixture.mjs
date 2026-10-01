import { readFile, writeFile } from "node:fs/promises";

// Use the local model's T-pose hierarchy; no artist animation is fabricated for the builtin pack.
export async function writePackageVrmaFixture(
  model,
  destination,
  unsupported = false,
) {
  const bytes = await readFile(model),
    json = JSON.parse(
      bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString(),
    );
  const bones = json.extensions.VRMC_vrm.humanoid.humanBones;
  const nodes = json.nodes.map((node) =>
    Object.fromEntries(
      Object.entries(node).filter(([key]) =>
        [
          "name",
          "translation",
          "rotation",
          "scale",
          "matrix",
          "children",
        ].includes(key),
      ),
    ),
  );
  const parents = new Map();
  nodes.forEach((node, index) =>
    node.children?.forEach((child) => parents.set(child, index)),
  );
  let root = bones.hips.node;
  while (parents.has(root)) root = parents.get(root);
  const times = [0, 0.75, 1.5, 2.25, 3],
    binary = Buffer.alloc(times.length * 20);
  const initial = nodes[bones.head.node].rotation ?? [0, 0, 0, 1];
  times.forEach((time, i) => {
    binary.writeFloatLE(time, i * 4);
    const angle = i % 2 ? 0.4 : 0,
      sine = Math.sin(angle / 2),
      cosine = Math.cos(angle / 2);
    // Quaternion initial * rotation about the local Z axis.
    const [x, y, z, w] = initial,
      q = [
        x * cosine + y * sine,
        y * cosine - x * sine,
        z * cosine + w * sine,
        w * cosine - z * sine,
      ];
    q.forEach((value, component) =>
      binary.writeFloatLE(value, times.length * 4 + (i * 4 + component) * 4),
    );
  });
  const scene = {
    asset: { version: "2.0", generator: "Katarune acceptance fixture" },
    extensionsUsed: ["VRMC_vrm_animation"],
    extensions: {
      VRMC_vrm_animation: {
        specVersion: "1.0",
        humanoid: { humanBones: bones },
        ...(unsupported ? { expressions: { preset: {} } } : {}),
      },
    },
    nodes,
    scenes: [{ nodes: [root] }],
    scene: 0,
    buffers: [{ byteLength: binary.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: times.length * 4 },
      {
        buffer: 0,
        byteOffset: times.length * 4,
        byteLength: times.length * 16,
      },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: times.length,
        type: "SCALAR",
        min: [0],
        max: [3],
      },
      { bufferView: 1, componentType: 5126, count: times.length, type: "VEC4" },
    ],
    animations: [
      {
        name: "Head tilt acceptance fixture",
        samplers: [{ input: 0, output: 1, interpolation: "LINEAR" }],
        channels: [
          { sampler: 0, target: { node: bones.head.node, path: "rotation" } },
        ],
      },
    ],
  };
  const raw = Buffer.from(JSON.stringify(scene)),
    padded = Buffer.alloc(Math.ceil(raw.length / 4) * 4, 32);
  raw.copy(padded);
  const header = Buffer.alloc(12),
    jsonHeader = Buffer.alloc(8),
    binaryHeader = Buffer.alloc(8);
  header.writeUInt32LE(0x46546c67);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + padded.length + binary.length, 8);
  jsonHeader.writeUInt32LE(padded.length);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  binaryHeader.writeUInt32LE(binary.length);
  binaryHeader.writeUInt32LE(0x004e4942, 4);
  await writeFile(
    destination,
    Buffer.concat([header, jsonHeader, padded, binaryHeader, binary]),
  );
}
