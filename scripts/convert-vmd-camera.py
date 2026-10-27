"""Run with Blender --background --factory-startup --python this.py -- INPUT OUTPUT.

Requires the MMD Tools Blender extension. Writes standard GLB camera animation;
the printed camera configuration can be placed in a character package manifest.
"""
import argparse
import json
import math
import struct
import sys
from pathlib import Path

import bpy
from mathutils import Quaternion, Vector


def write_glb(output, samples):
    binary = bytearray()
    views, accessors = [], []

    def accessor(rows, width):
        flat = [v for row in rows for v in (row if isinstance(row, list) else [row])]
        start = len(binary)
        binary.extend(struct.pack('<' + 'f' * len(flat), *flat))
        view = len(views)
        views.append({'buffer': 0, 'byteOffset': start, 'byteLength': len(binary) - start})
        value = {'bufferView': view, 'componentType': 5126, 'count': len(rows), 'type': 'SCALAR' if width == 1 else f'VEC{width}'}
        if width == 1:
            value.update(min=[min(flat)], max=[max(flat)])
        accessors.append(value)
        return len(accessors) - 1

    times = accessor([s['at'] for s in samples], 1)
    positions = accessor([s['position'] for s in samples], 3)
    rotations = accessor([s['rotation'] for s in samples], 4)
    fovs = accessor([s['fov'] for s in samples], 1)
    sizes = accessor([s['size'] for s in samples], 1)
    projections = sorted({s['ortho'] for s in samples})
    nodes, cameras, shots = [], [], []
    samplers, channels = [], []

    def channel(output_accessor, target):
        channels.append({'sampler': len(samplers), 'target': target})
        samplers.append({'input': times, 'output': output_accessor, 'interpolation': 'LINEAR'})

    for ortho in projections:
        index = len(cameras)
        name = 'OrthographicCamera' if ortho else 'PerspectiveCamera'
        nodes.append({'name': name, 'camera': index})
        cameras.append({'type': 'orthographic', 'orthographic': {'xmag': samples[0]['size'] * 16 / 9, 'ymag': samples[0]['size'], 'znear': .01, 'zfar': 2000}} if ortho else
                       {'type': 'perspective', 'perspective': {'yfov': samples[0]['fov'], 'znear': .01, 'zfar': 2000}})
        channel(positions, {'node': index, 'path': 'translation'})
        channel(rotations, {'node': index, 'path': 'rotation'})
        path = f'/cameras/{index}/orthographic/ymag' if ortho else f'/cameras/{index}/perspective/yfov'
        channel(sizes if ortho else fovs, {'path': 'pointer', 'extensions': {'KHR_animation_pointer': {'pointer': path}}})
    previous = None
    for sample in samples:
        if sample['ortho'] != previous:
            shots.append({'at': sample['at'], 'node': 'OrthographicCamera' if sample['ortho'] else 'PerspectiveCamera'})
            previous = sample['ortho']
    document = {'asset': {'version': '2.0'}, 'scene': 0, 'scenes': [{'nodes': list(range(len(nodes)))}], 'nodes': nodes, 'cameras': cameras,
                'extensionsUsed': ['KHR_animation_pointer'], 'extensionsRequired': ['KHR_animation_pointer'],
                'animations': [{'name': 'Camera', 'samplers': samplers, 'channels': channels}],
                'buffers': [{'byteLength': len(binary)}], 'bufferViews': views, 'accessors': accessors}
    source = json.dumps(document, separators=(',', ':')).encode('utf-8')
    source += b' ' * (-len(source) % 4)
    binary += b'\0' * (-len(binary) % 4)
    result = struct.pack('<III', 0x46546c67, 2, 28 + len(source) + len(binary))
    result += struct.pack('<II', len(source), 0x4e4f534a) + source + struct.pack('<II', len(binary), 0x004e4942) + binary
    if len(result) > 16 * 1024 ** 2:
        raise ValueError('Camera GLB exceeds 16 MiB')
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(result)
    return shots if len(projections) > 1 else None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--fps', type=int, choices=[30, 60], default=60)
    parser.add_argument('--duration', type=float, help='Hold or trim the camera to this duration in seconds')
    parser.add_argument('--scale', type=float, default=.08, help='MMD units to metres, including any desired character scale')
    parser.add_argument('--floor', type=float, default=0, help='Reference foot height in Blender metres')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    if args.output.suffix.lower() != '.glb' or args.input.resolve() == args.output.resolve():
        raise ValueError('Use a separate .glb output file')
    if args.output.exists():
        raise ValueError('Output exists; choose a new path')
    if not math.isfinite(args.scale) or not 0 < args.scale <= 10 or not math.isfinite(args.floor):
        raise ValueError('Invalid scale or floor')
    data = args.input.read_bytes()
    if len(data) > 16 * 1024 ** 2 or not data.startswith(b'Vocaloid Motion Data'):
        raise ValueError('Invalid or oversized VMD')
    offset = 50
    for width in [111, 23]:
        count = struct.unpack_from('<I', data, offset)[0]
        offset += 4 + count * width
    count = struct.unpack_from('<I', data, offset)[0]
    offset += 4
    if not 0 < count <= 120001 or offset + count * 61 > len(data):
        raise ValueError('Missing or invalid VMD camera keys')
    frames = sorted(struct.unpack_from('<I', data, offset + i * 61)[0] for i in range(count))
    if len(set(frames)) != count:
        raise ValueError('VMD camera keys must be unique')
    duration = args.duration if args.duration is not None else frames[-1] / 30
    if not math.isfinite(duration) or not 0 < duration <= 3600 or math.ceil(duration * args.fps) + count > 120001:
        raise ValueError('Duration or sample count exceeds limits')
    cuts = {b / 30 for a, b in zip(frames, frames[1:]) if b == a + 1}
    bpy.ops.preferences.addon_enable(module='bl_ext.user_default.mmd_tools')
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    scene = bpy.context.scene
    scene.render.fps = 30
    scene.frame_set(0)
    camera = bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera'))
    scene.collection.objects.link(camera)
    camera.select_set(True)
    bpy.context.view_layer.objects.active = camera
    scene.camera = camera
    bpy.ops.mmd_tools.import_vmd(filepath=str(args.input.resolve()), scale=args.scale, margin=0)
    root = camera.parent
    basis = Quaternion((1, 0, 0), -math.pi / 2)
    samples = []
    f32 = lambda value: struct.unpack('<f', struct.pack('<f', value))[0]
    for i in range(math.ceil(duration * args.fps) + 1):
        seconds = min(duration, i / args.fps)
        frame = seconds * 30
        scene.frame_set(int(frame), subframe=frame - int(frame))
        evaluated = camera.evaluated_get(bpy.context.evaluated_depsgraph_get())
        p = evaluated.matrix_world.translation
        q = (basis @ evaluated.matrix_world.to_quaternion()).normalized()
        rotation = [q.x, q.y, q.z, q.w]
        if samples and sum(a * b for a, b in zip(samples[-1]['rotation'], rotation)) < 0:
            rotation = [-v for v in rotation]
        sample = {'at': f32(seconds), 'position': [p.x, p.z - args.floor, -p.y], 'rotation': rotation,
                  'fov': root.mmd_camera.angle, 'size': evaluated.data.ortho_scale / 2, 'ortho': not root.mmd_camera.is_perspective}
        if samples and any(abs(seconds - cut) < 1e-7 for cut in cuts):
            # Distinct adjacent float32 times preserve a hard cut at every runtime float timestamp.
            bits = struct.unpack('<I', struct.pack('<f', sample['at']))[0]
            before = struct.unpack('<f', struct.pack('<I', bits - 1))[0]
            if before > samples[-1]['at']:
                samples.append(dict(samples[-1], at=before))
        samples.append(sample)
    shots = write_glb(args.output, samples)
    configuration = {'kind': 'track', 'file': args.output.name}
    if shots:
        configuration['shots'] = shots
    print('CAMERA_GLB ' + json.dumps({'samples': len(samples), 'duration': duration, 'cuts': len([t for t in cuts if t <= duration]), 'camera': configuration}))


if __name__ == '__main__':
    main()
