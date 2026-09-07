import base64, hashlib, json, lzma, subprocess, sys
from pathlib import Path, PurePosixPath

BASE = 'f6baa8e0cfbc0f63fb13f0d40517ae03de05b2e0'
TREE = 'b75afe4b522dfcc56b16ac207b06718e3ef2100d'
ARCHIVE = '31c725337aec2d9c80269d2dcecd1442881e9374d8974f04bf659f858040620b'
DISTRIBUTION = 'ff66601f1d149d8c46e5ad3e45c3d850a25fb53ace8c351eb8f59de16835fd5b'

def digest(value):
    return hashlib.sha256(value).hexdigest()

def git(*args):
    return subprocess.check_output(['git', *args], text=True).strip()

def decode(directory, output):
    root = Path(directory)
    encoded = ''.join((root / f'part-{i:02d}.b64').read_text('ascii') for i in range(4))
    raw = base64.b64decode(encoded, validate=True)
    if digest(raw) != ARCHIVE:
        raise RuntimeError('Archive digest mismatch')
    stream = lzma.LZMADecompressor(memlimit=256 * 1024 * 1024)
    payload = stream.decompress(raw, max_length=2_000_001)
    if not stream.eof or stream.unused_data or len(payload) > 2_000_000:
        raise RuntimeError('Archive exceeds bound or contains trailing data')
    data = json.loads(payload)
    if data['base'] != BASE or data['tree'] != TREE or data['distribution'] != DISTRIBUTION:
        raise RuntimeError('Unexpected source identity')
    Path(output).write_bytes(payload)
    print('Compressed source archive verified.', flush=True)

def apply(payload):
    data = json.loads(Path(payload).read_bytes())
    if data['base'] != BASE or data['tree'] != TREE or git('rev-parse', 'HEAD') != BASE:
        raise RuntimeError('Unexpected checkout')
    seen = set()
    for item in data['files']:
        path = PurePosixPath(item['path'])
        if path.is_absolute() or not path.parts or any(p in ('..', '.git') for p in path.parts) or str(path) in seen or str(path).startswith('.github/workflows/'):
            raise RuntimeError('Unsafe, duplicated or disallowed source path')
        seen.add(str(path))
        dest = Path(path)
        if dest.is_symlink() or any(p.is_symlink() for p in dest.parents):
            raise RuntimeError('Symlink source path')
        before = dest.read_bytes() if dest.exists() else b''
        if digest(before) != item['before']:
            raise RuntimeError('Baseline file differs: ' + str(path))
        text = before.decode('utf-8')
        previous = 0
        for start, end, replacement in item['edits']:
            if type(start) is not int or type(end) is not int or start < previous or end < start or end > len(text) or not isinstance(replacement, str):
                raise RuntimeError('Invalid Unicode edit ranges')
            previous = end
        for start, end, replacement in reversed(item['edits']):
            text = text[:start] + replacement + text[end:]
        after = text.encode('utf-8')
        if digest(after) != item['after']:
            raise RuntimeError('Reconstructed file differs: ' + str(path))
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(after)
    subprocess.run(['npm', 'run', 'build'], check=True)
    if digest(Path('dist/AureonTerminal.html').read_bytes()) != DISTRIBUTION:
        raise RuntimeError('Standalone distribution differs')
    subprocess.run(['npm', 'run', 'references'], check=True)
    subprocess.run(['npm', 'run', 'check'], check=True)
    git('add', '--all')
    if git('write-tree') != TREE:
        raise RuntimeError('Resulting Git tree differs from verified source')
    git('commit', '-m', 'feat: durable event replay, persistent drawing recovery and realtime indicators')
    print('Verified source commit: ' + git('rev-parse', 'HEAD'), flush=True)

if __name__ == '__main__':
    if sys.argv[1] == 'decode':
        decode(sys.argv[2], sys.argv[3])
    elif sys.argv[1] == 'apply':
        apply(sys.argv[2])
    else:
        raise RuntimeError('Unknown operation')
