#!/usr/bin/env python3
"""Convert the Sketchfab "Roblox Bacon Hair" GLB into the asset used by the site.

Changes made to the original (CC-BY-4.0 requires indicating changes):
  * KHR_materials_pbrSpecularGlossiness (no longer supported by three.js) is
    replaced by a plain metal/rough material that uses the original diffuse map.
  * The Mixamo skeleton, skin weights and the bundled animation are removed.
    The seven body meshes are kept as rigid parts (Hair, Head, Torso, LeftArm,
    RightArm, LeftLeg, RightLeg) so they can be driven like an R6 rig.
  * The node hierarchy is flattened and each part node is turned 180 degrees
    about Y so the avatar faces +Z (geometry itself is untouched).

Usage:
  python3 tools/convert_model.py original.glb /tmp/stage.glb
  npx @gltf-transform/cli prune /tmp/stage.glb assets/bacon-hair.glb
"""
import json
import struct
import sys


def read_glb(path):
    data = open(path, 'rb').read()
    magic, _version, _length = struct.unpack('<4sII', data[:12])
    assert magic == b'glTF', 'not a GLB file'
    json_len, _ = struct.unpack('<II', data[12:20])
    doc = json.loads(data[20:20 + json_len])
    rest = data[20 + json_len:]
    return doc, rest


def write_glb(path, doc, rest):
    js = json.dumps(doc, separators=(',', ':')).encode()
    js += b' ' * ((4 - len(js) % 4) % 4)
    header = struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(js) + len(rest))
    open(path, 'wb').write(header + struct.pack('<II', len(js), 0x4E4F534A) + js + rest)


def classify(doc):
    """Name each mesh by where it sits in the bind pose (all meshes share a frame)."""
    bounds = []
    for i, mesh in enumerate(doc['meshes']):
        acc = doc['accessors'][mesh['primitives'][0]['attributes']['POSITION']]
        bounds.append((i, acc['min'], acc['max']))
    torso = max(bounds, key=lambda b: (b[2][1] - b[1][1]) if 1.5 < b[1][1] < 2.5 and b[2][1] > 4 else -1)
    torso_cx = (torso[1][0] + torso[2][0]) / 2
    names = {}
    for i, mn, mx in bounds:
        cx = (mn[0] + mx[0]) / 2
        # The raw bind-pose geometry faces -Z (the skin rotated it 180 degrees),
        # so the character's left side is at -X here.
        side = 'Left' if cx < torso_cx else 'Right'
        if i == torso[0]:
            names[i] = 'Torso'
        elif mx[1] > 5.3:
            names[i] = 'Hair'
        elif mn[1] > 3.5:
            names[i] = 'Head'
        elif mn[1] < 0.5:
            names[i] = side + 'Leg'
        else:
            names[i] = side + 'Arm'
    assert sorted(names.values()) == sorted(
        ['Torso', 'Hair', 'Head', 'LeftArm', 'RightArm', 'LeftLeg', 'RightLeg']), names
    return names


def main(src, dst):
    doc, rest = read_glb(src)

    for mat in doc['materials']:
        sg = mat.get('extensions', {}).pop('KHR_materials_pbrSpecularGlossiness', None)
        if not mat.get('extensions'):
            mat.pop('extensions', None)
        if sg:
            mat['pbrMetallicRoughness'] = {
                'baseColorTexture': {'index': sg['diffuseTexture']['index']},
                'baseColorFactor': sg.get('diffuseFactor', [1, 1, 1, 1]),
                'metallicFactor': 0.0,
                'roughnessFactor': 0.8,
            }
        mat['name'] = 'Avatar'
    doc.pop('extensionsUsed', None)
    doc.pop('animations', None)
    doc.pop('skins', None)

    for mesh in doc['meshes']:
        for prim in mesh['primitives']:
            for key in [k for k in prim['attributes'] if k.startswith(('JOINTS_', 'WEIGHTS_')) or k in ('TEXCOORD_1', 'TEXCOORD_2')]:
                del prim['attributes'][key]

    names = classify(doc)
    # Turn the parts 180 degrees about Y so the avatar faces +Z, as it did when skinned.
    doc['nodes'] = [{'name': names[i], 'mesh': i, 'rotation': [0, 1, 0, 0]} for i in range(len(doc['meshes']))]
    for i, mesh in enumerate(doc['meshes']):
        mesh['name'] = names[i]
    doc['scenes'] = [{'name': 'Avatar', 'nodes': list(range(len(doc['nodes'])))}]
    doc['scene'] = 0
    doc.setdefault('asset', {})['generator'] = 'convert_model.py (from Sketchfab export)'

    write_glb(dst, doc, rest)
    print('wrote', dst, names)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
