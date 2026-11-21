#!/usr/bin/env python3
"""Convert the Sketchfab "Roblox Bacon Hair" GLB into the asset used by the site.

Changes made to the original (CC-BY-4.0 requires indicating changes):
  * KHR_materials_pbrSpecularGlossiness (no longer supported by three.js) is
    replaced by a plain metal/rough material that uses the original diffuse map.
  * The skin is baked into static geometry after re-posing the skeleton so
    the arms hang straight down (R6-style) instead of bent at the elbows.
    The Mixamo skeleton, skin weights and bundled animation are then removed.
    The seven body meshes are kept as rigid parts (Hair, Head, Torso, LeftArm,
    RightArm, LeftLeg, RightLeg) so they can be driven like an R6 rig.
  * Units are converted to studs (1 unit = 1 stud) and the avatar faces +Z.

Usage (needs numpy):
  python3 tools/convert_model.py original.glb /tmp/stage.glb
  npx @gltf-transform/cli prune /tmp/stage.glb assets/bacon-hair.glb
"""
import json
import struct
import sys

import numpy as np

COMPONENT = {5121: np.uint8, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
WIDTH = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
TO_STUDS = 100.0  # the Sketchfab export is in metres-ish * 0.01


def read_glb(path):
    data = open(path, 'rb').read()
    magic, _version, _length = struct.unpack('<4sII', data[:12])
    assert magic == b'glTF', 'not a GLB file'
    json_len, _ = struct.unpack('<II', data[12:20])
    doc = json.loads(data[20:20 + json_len])
    rest = data[20 + json_len:]
    bin_len, _ = struct.unpack('<II', rest[:8])
    return doc, bytearray(rest[8:8 + bin_len])


def write_glb(path, doc, binary):
    binary = bytes(binary) + b'\0' * ((4 - len(binary) % 4) % 4)
    doc['buffers'] = [{'byteLength': len(binary)}]
    js = json.dumps(doc, separators=(',', ':')).encode()
    js += b' ' * ((4 - len(js) % 4) % 4)
    total = 12 + 8 + len(js) + 8 + len(binary)
    out = struct.pack('<4sII', b'glTF', 2, total)
    out += struct.pack('<II', len(js), 0x4E4F534A) + js
    out += struct.pack('<II', len(binary), 0x004E4942) + binary
    open(path, 'wb').write(out)


def read_accessor(doc, binary, index):
    acc = doc['accessors'][index]
    view = doc['bufferViews'][acc['bufferView']]
    dtype = np.dtype(COMPONENT[acc['componentType']])
    n = WIDTH[acc['type']]
    item = dtype.itemsize * n
    stride = view.get('byteStride', item)
    start = view.get('byteOffset', 0) + acc.get('byteOffset', 0)
    out = np.empty((acc['count'], n), dtype)
    for i in range(acc['count']):
        out[i] = np.frombuffer(binary, dtype, n, start + i * stride)
    return out


def append_accessor(doc, binary, array, kind):
    array = np.ascontiguousarray(array, np.float32)
    while len(binary) % 4:
        binary.append(0)
    doc['bufferViews'].append({'buffer': 0, 'byteOffset': len(binary), 'byteLength': array.nbytes})
    binary.extend(array.tobytes())
    acc = {'bufferView': len(doc['bufferViews']) - 1, 'componentType': 5126,
           'count': len(array), 'type': kind}
    if kind == 'VEC3':
        acc['min'] = array.min(0).tolist()
        acc['max'] = array.max(0).tolist()
    doc['accessors'].append(acc)
    return len(doc['accessors']) - 1


def quat_matrix(q):
    x, y, z, w = q
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])


def local_matrix(node):
    if 'matrix' in node:
        return np.array(node['matrix'], float).reshape(4, 4).T
    m = np.eye(4)
    m[:3, :3] = quat_matrix(node.get('rotation', [0, 0, 0, 1])) * np.array(node.get('scale', [1, 1, 1]))
    m[:3, 3] = node.get('translation', [0, 0, 0])
    return m


def world_matrices(doc):
    world = {}

    def visit(i, parent):
        world[i] = parent @ local_matrix(doc['nodes'][i])
        for c in doc['nodes'][i].get('children', []):
            visit(c, world[i])

    for root in doc['scenes'][doc.get('scene', 0)]['nodes']:
        visit(root, np.eye(4))
    return world


def descendants(doc, i):
    out = [i]
    for c in doc['nodes'][i].get('children', []):
        out += descendants(doc, c)
    return out


def rotation_between(a, b):
    a = a / np.linalg.norm(a)
    b = b / np.linalg.norm(b)
    v = np.cross(a, b)
    c = float(np.dot(a, b))
    k = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + k + k @ k * (1 / (1 + c))


def straighten_arms(doc, world):
    """Rotate each forearm about its elbow so it hangs straight down."""
    by_name = {n.get('name', ''): i for i, n in enumerate(doc['nodes'])}

    def find(part):
        return next(i for name, i in by_name.items() if part in name)

    for side in ('Left', 'Right'):
        elbow = find(f'mixamorig:{side}ForeArm')
        hand = find(f'mixamorig:{side}Hand_')
        e = world[elbow][:3, 3]
        h = world[hand][:3, 3]
        r = np.eye(4)
        r[:3, :3] = rotation_between(h - e, np.array([0.0, -1.0, 0.0]))
        pivot = np.eye(4)
        pivot[:3, 3] = e
        about = pivot @ r @ np.linalg.inv(pivot)
        for i in descendants(doc, elbow):
            world[i] = about @ world[i]


def bake_skin(doc, binary, world):
    skin = doc['skins'][0]
    ibm = read_accessor(doc, binary, skin['inverseBindMatrices']).reshape(-1, 4, 4).transpose(0, 2, 1)
    joint_mats = np.stack([world[j] @ ibm[k] for k, j in enumerate(skin['joints'])])
    for mesh in doc['meshes']:
        for prim in mesh['primitives']:
            attrs = prim['attributes']
            pos = read_accessor(doc, binary, attrs['POSITION']).astype(float)
            nrm = read_accessor(doc, binary, attrs['NORMAL']).astype(float)
            joints = read_accessor(doc, binary, attrs['JOINTS_0']).astype(int)
            weights = read_accessor(doc, binary, attrs['WEIGHTS_0']).astype(float)
            weights /= weights.sum(1, keepdims=True)
            m = np.einsum('vk,vkij->vij', weights, joint_mats[joints])
            p = np.einsum('vij,vj->vi', m[:, :3, :3], pos) + m[:, :3, 3]
            n = np.einsum('vij,vj->vi', np.linalg.inv(m[:, :3, :3]).transpose(0, 2, 1), nrm)
            n /= np.linalg.norm(n, axis=1, keepdims=True)
            attrs['POSITION'] = append_accessor(doc, binary, p * TO_STUDS, 'VEC3')
            attrs['NORMAL'] = append_accessor(doc, binary, n, 'VEC3')
            for key in [k for k in attrs if k.startswith(('JOINTS_', 'WEIGHTS_')) or k in ('TEXCOORD_1', 'TEXCOORD_2')]:
                del attrs[key]


def classify(doc):
    """Name each mesh by where it sits (avatar faces +Z, so its left is +X)."""
    bounds = []
    for i, mesh in enumerate(doc['meshes']):
        acc = doc['accessors'][mesh['primitives'][0]['attributes']['POSITION']]
        bounds.append((i, acc['min'], acc['max']))
    feet = min(b[1][1] for b in bounds)
    torso = max(bounds, key=lambda b: (b[2][1] - b[1][1]) if 1.5 < b[1][1] - feet < 2.5 and b[2][1] - feet > 4 else -1)
    torso_cx = (torso[1][0] + torso[2][0]) / 2
    names = {}
    for i, mn, mx in bounds:
        side = 'Left' if (mn[0] + mx[0]) / 2 > torso_cx else 'Right'
        if i == torso[0]:
            names[i] = 'Torso'
        elif mx[1] - feet > 5.3:
            names[i] = 'Hair'
        elif mn[1] - feet > 3.5:
            names[i] = 'Head'
        elif mn[1] - feet < 0.5:
            names[i] = side + 'Leg'
        else:
            names[i] = side + 'Arm'
    assert sorted(names.values()) == sorted(
        ['Torso', 'Hair', 'Head', 'LeftArm', 'RightArm', 'LeftLeg', 'RightLeg']), names
    return names


def main(src, dst):
    doc, binary = read_glb(src)

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

    world = world_matrices(doc)
    straighten_arms(doc, world)
    bake_skin(doc, binary, world)
    doc.pop('skins', None)

    names = classify(doc)
    doc['nodes'] = [{'name': names[i], 'mesh': i} for i in range(len(doc['meshes']))]
    for i, mesh in enumerate(doc['meshes']):
        mesh['name'] = names[i]
    doc['scenes'] = [{'name': 'Avatar', 'nodes': list(range(len(doc['nodes'])))}]
    doc['scene'] = 0
    doc.setdefault('asset', {})['generator'] = 'convert_model.py (from Sketchfab export)'

    write_glb(dst, doc, binary)
    print('wrote', dst, names)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
