import base64, hashlib, json, lzma, os, subprocess, sys
from pathlib import Path, PurePosixPath

BASE = '01853284786388922cb475245e7c030b55f17e42'
DIGEST = '0bde9d1bd20cd2811bf827821c232a1e0d78219a9d4eb2e2d1ed80a05ddc1247'
TREES = ['5a87b39e73286fef55b34c5cd30003f51de982df', 'd1d6ba8c06a07912124cb1c9e434e0b523d642a2']
MESSAGES = ['docs: establish independent product language and remove retired references', 'feat: add collaborative drawing operations, causal scripting and shared local storage']

def run(*args):
    return subprocess.run(args, check=True, text=True, stdout=subprocess.PIPE).stdout.strip()

def digest(data):
    return hashlib.sha256(data).hexdigest()

def decode(directory, output):
    root = Path(directory)
    encoded = ''.join((root / f'part-{n:02d}.b64').read_text('ascii') for n in range(8))
    archive = base64.b64decode(encoded, validate=True)
    if digest(archive) != DIGEST:
        raise RuntimeError('Archive SHA256 mismatch')
    payload = lzma.decompress(archive, memlimit=256*1024*1024)
    if len(payload) > 2_000_000:
        raise RuntimeError('Archive size limit')
    data = json.loads(payload)
    if data['base'] != BASE or len(data['stages']) != 2:
        raise RuntimeError('Unexpected import baseline or stage count')
    Path(output).write_bytes(payload)
    print('Source archive SHA256 verified.', flush=True)

def apply(payload):
    data = json.loads(Path(payload).read_bytes())
    if data['base'] != BASE:
        raise RuntimeError('Wrong source baseline')
    for i, stage in enumerate(data['stages']):
        seen = set()
        for item in stage['files']:
            path = PurePosixPath(item['path'])
            if path.is_absolute() or '..' in path.parts or '.git' in path.parts or not path.parts or str(path) in seen:
                raise RuntimeError('Unsafe or duplicate path')
            seen.add(str(path))
            dest = Path(path)
            if dest.is_symlink():
                raise RuntimeError('Symlink path')
            before = dest.read_bytes() if dest.exists() else b''
            if digest(before) != item['before']:
                raise RuntimeError('Baseline mismatch: ' + str(path))
            text = before.decode('utf-8')
            end = 0
            for start, stop, replacement in item['edits']:
                if not isinstance(start, int) or not isinstance(stop, int) or start < end or stop < start or stop > len(text) or not isinstance(replacement, str):
                    raise RuntimeError('Invalid edit coordinates')
                end = stop
            for start, stop, replacement in reversed(item['edits']):
                text = text[:start] + replacement + text[stop:]
            after = text.encode('utf-8')
            if digest(after) != item['after']:
                raise RuntimeError('Reconstructed file mismatch: ' + str(path))
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(after)
        subprocess.run(['npm', 'run', 'build'], check=True)
        if digest(Path('dist/AureonTerminal.html').read_bytes()) != stage['distribution']:
            raise RuntimeError('Standalone build digest mismatch')
        subprocess.run(['npm', 'run', 'check'], check=True)
        if i:
            subprocess.run(['npm', 'run', 'references'], check=True)
        run('git', 'add', '--all')
        if run('git', 'write-tree') != TREES[i]:
            raise RuntimeError('Git tree differs from the locally verified stage')
        run('git', 'commit', '-m', MESSAGES[i])
        print(f'Stage {i + 1}: {run("git", "rev-parse", "HEAD")} tree {TREES[i]}', flush=True)
    print('Both source stages, generated distributions, and Git trees verified.', flush=True)

if __name__ == '__main__':
    if sys.argv[1] == 'decode':
        decode(sys.argv[2], sys.argv[3])
    elif sys.argv[1] == 'apply':
        apply(sys.argv[2])
    else:
        raise RuntimeError('Unknown import operation')
