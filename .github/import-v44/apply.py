import base64, hashlib, json, lzma, subprocess, sys
from pathlib import Path

BASE = 'e856aa5a0cd8cffc85e24a713cba5f6bec9a9378'
TREE = 'd078a04bf9394ac7a0cd7950998913f2a094fbc9'
ARCHIVE = '7e9c055b803ff273abaa7fbaf99fe8f50e73248650773a4f701a214702929761'
PATCH = '1276649efa1da00edf8b1f883d867ac4163f938de9abb9705e0143fffc3feec9'
DIST = '439cd92edd765f882eeae66e164f857355554bbc2d85948dceea123faf83e5e6'

def digest(value):
    return hashlib.sha256(value).hexdigest()

def git(*args):
    return subprocess.check_output(['git', *args], text=True).strip()

def decode(directory, destination):
    root = Path(directory)
    encoded = ''.join((root / f'part-{i:02d}.b64').read_text('ascii') for i in range(5))
    raw = base64.b64decode(encoded, validate=True)
    if digest(raw) != ARCHIVE:
        raise RuntimeError('Compressed source digest mismatch')
    decoder = lzma.LZMADecompressor(memlimit=256 * 1024 * 1024)
    patch = decoder.decompress(raw, max_length=2_000_001)
    if not decoder.eof or decoder.unused_data or len(patch) != 138996 or digest(patch) != PATCH:
        raise RuntimeError('Source patch length or digest mismatch')
    Path(destination).write_bytes(patch)
    print('All source transfer bytes verified.', flush=True)

def apply(patch_path, identity_path):
    patch = Path(patch_path).read_bytes()
    if digest(patch) != PATCH or git('rev-parse', 'HEAD') != BASE or git('status', '--porcelain'):
        raise RuntimeError('Unexpected source or non-pristine checkout')
    subprocess.run(['git', 'apply', '--check', patch_path], check=True)
    subprocess.run(['git', 'apply', patch_path], check=True)
    subprocess.run(['npm', 'run', 'build'], check=True)
    distribution = Path('dist/AureonTerminal.html').read_bytes()
    if len(distribution) != 1018119 or digest(distribution) != DIST:
        raise RuntimeError('Rebuilt standalone differs from tested source')
    subprocess.run(['npm', 'run', 'references'], check=True)
    subprocess.run(['npm', 'run', 'check'], check=True)
    git('add', '--all')
    if git('write-tree') != TREE:
        raise RuntimeError('Complete source tree differs from tested source')
    git('commit', '-m', 'feat: explicit trading calendars, causal session research and gap-aware charting')
    identity = {'head': git('rev-parse', 'HEAD'), 'base': BASE, 'tree': TREE, 'distributionSHA256': DIST, 'distributionBytes': len(distribution)}
    Path(identity_path).write_text(json.dumps(identity, indent=2) + '\n')
    print(json.dumps(identity), flush=True)

if __name__ == '__main__':
    if sys.argv[1] == 'decode':
        decode(sys.argv[2], sys.argv[3])
    elif sys.argv[1] == 'apply':
        apply(sys.argv[2], sys.argv[3])
    else:
        raise RuntimeError('Unknown import operation')
