import { readFile, writeFile } from "node:fs/promises";

// Use the local model's T-pose hierarchy; no artist animation is fabricated for the builtin pack.
export async function writePackageVrmaFixture(
  model,
  destination,
  unsupported = false,
  tracks = [{ bone: "head", axis: [0, 0, 1], amplitude: .4 }],
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
  // Match production's 60 FPS samples. Unity's quaternion continuity pass can
  // ease widely spaced rotation keys, which obscures a numeric blend check.
  const times = Array.from({ length: 181 }, (_, i) => i / 60),
    binary = Buffer.alloc(times.length * (4 + 16 * tracks.length));
  times.forEach((time, i) => {
    binary.writeFloatLE(time, i * 4);
    tracks.forEach((track, trackIndex) => {
    const initial = nodes[bones[track.bone].node].rotation ?? [0, 0, 0, 1];
    const phase = (time % 1.5) / .75;
    const angle = track.amplitude * (phase <= 1 ? phase : 2 - phase),
      sine = Math.sin(angle / 2),
      cosine = Math.cos(angle / 2);
    const [dx, dy, dz] = track.axis.map(v => v * sine);
    // Quaternion initial * local axis rotation.
    const [x, y, z, w] = initial,
      q = [
        x * cosine + w * dx + y * dz - z * dy,
        y * cosine + w * dy + z * dx - x * dz,
        z * cosine + w * dz + x * dy - y * dx,
        w * cosine - x * dx - y * dy - z * dz,
      ];
    q.forEach((value, component) =>
      binary.writeFloatLE(value, times.length * 4 + trackIndex * times.length * 16 + (i * 4 + component) * 4),
    );
    });
  });
  const scene = {
    asset: { version: "2.0", generator: "Katarune acceptance fixture" },
    extensionsUsed: ["VRMC_vrm_animation"],
    extensions: {
      VRMC_vrm_animation: {
        specVersion: "1.0",
        humanoid: { humanBones: bones },
      },
    },
    nodes,
    scenes: [{ nodes: [root] }],
    scene: 0,
    buffers: [{ byteLength: binary.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: times.length * 4 },
      ...tracks.map((_, index) => ({
        buffer: 0,
        byteOffset: times.length * 4 + index * times.length * 16,
        byteLength: times.length * 16,
      })),
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
      ...tracks.map((_, index) => ({ bufferView: index + 1, componentType: 5126, count: times.length, type: "VEC4" })),
    ],
    animations: [
      {
        name: "Head tilt acceptance fixture",
        samplers: tracks.map((_, index) => ({ input: 0, output: index + 1, interpolation: "LINEAR" })),
        // Humanoid scale channels remain invalid in VRMA, while standard
        // expression and gaze channels are now accepted by the player.
        channels: tracks.map((track, index) => ({ sampler: index, target: { node: bones[track.bone].node, path: unsupported && index === 0 ? "scale" : "rotation" } })),
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
