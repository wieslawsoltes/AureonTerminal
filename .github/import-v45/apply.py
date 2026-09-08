import base64
import hashlib
import json
import lzma
import subprocess
import sys
from pathlib import Path

BASE = 'ff2561fde264d5baf23c3f6807b1b82163a1236a'
BASE_TREE = 'd078a04bf9394ac7a0cd7950998913f2a094fbc9'
TREE = '84b6fff99af8707217b2b03446228e4ca7857183'
ARCHIVE = '9700bdc64f233892c3595fa13cf247b4a5207feb372876f13cbd7a4980b522c6'
PATCH = '7c7667cc34c7c0dd6b74d78c70f30eb252bb3ed20d76b337ee1e68405fb0ba73'
DIST = '76f59f8f8fce8cbbbd183474c6e8688cfe41e9a1fc29b6d8bf1f64e774ef5a73'
PARTS = [
    'd39dcdfb0c5bf36a5a7334c1d18f6f27b856ac297061c52ba9bb26cd16e79a14',
    '04354812686cb6417f0523104971d933bf055a5adbd93f7d7d10df77224428e4',
    '41d324fb39a356d8119467838d52894465856e97cfe6ab8828fe72f19b6ed20c',
    'bbc43015b67bc5147b28127983dedcdfd5ca9626a67ae0b6ccebb3146aec0f20',
    '0d5620b59be5cad7bd140bf1e48a0e667bc9194bf6398af1c8576b6a761f8903',
]

def digest(data):
    return hashlib.sha256(data).hexdigest()

def git(*args):
    return subprocess.check_output(['git', *args], text=True).strip()

def decode(directory, output):
    chunks = []
    for i, expected in enumerate(PARTS):
        raw = (Path(directory) / f'part-{i:02d}.b64').read_bytes()
        if len(raw) > 12000 or digest(raw) != expected:
            raise RuntimeError('Source fragment does not match its fixed digest')
        chunks.append(raw)
    archive = base64.b64decode(b''.join(chunks), validate=True)
    if len(archive) != 41108 or digest(archive) != ARCHIVE:
        raise RuntimeError('Archive digest mismatch')
    stream = lzma.LZMADecompressor(memlimit=256 * 1024 * 1024)
    patch = stream.decompress(archive, max_length=2_000_001)
    if not stream.eof or stream.unused_data or len(patch) != 155273 or digest(patch) != PATCH:
        raise RuntimeError('Source patch identity mismatch or invalid stream')
    Path(output).write_bytes(patch)
    print('All five source fragments and the complete patch verified.', flush=True)

def apply(patch_file, receipt):
    patch = Path(patch_file).read_bytes()
    if len(patch) != 155273 or digest(patch) != PATCH:
        raise RuntimeError('Source patch changed')
    if git('rev-parse', 'HEAD') != BASE or git('rev-parse', 'HEAD^{tree}') != BASE_TREE:
        raise RuntimeError('Source baseline differs')
    if git('status', '--porcelain'):
        raise RuntimeError('Source checkout is not clean')
    subprocess.run(['git', 'apply', '--check', '--index', '--whitespace=error-all', patch_file], check=True)
    subprocess.run(['git', 'apply', '--index', '--whitespace=error-all', patch_file], check=True)
    subprocess.run(['npm', 'run', 'build'], check=True)
    distribution = Path('dist/AureonTerminal.html').read_bytes()
    if len(distribution) != 1087974 or digest(distribution) != DIST:
        raise RuntimeError('Generated distribution mismatch')
    subprocess.run(['npm', 'run', 'references'], check=True)
    subprocess.run(['npm', 'run', 'check'], check=True)
    git('add', '--all')
    if git('write-tree') != TREE:
        raise RuntimeError('Complete application source tree differs')
    git('diff', '--cached', '--check')
    git('commit', '-m', 'feat: incremental realtime scalar-series runtime and sequenced tail transport')
    identity = {'base': BASE, 'head': git('rev-parse', 'HEAD'), 'tree': TREE,
                'distributionSHA256': DIST, 'distributionBytes': len(distribution)}
    Path(receipt).write_text(json.dumps(identity, indent=2) + '\n')
    print(json.dumps(identity), flush=True)

if __name__ == '__main__':
    if sys.argv[1] == 'decode':
        decode(sys.argv[2], sys.argv[3])
    elif sys.argv[1] == 'apply':
        apply(sys.argv[2], sys.argv[3])
    else:
        raise RuntimeError('Unknown import operation')
