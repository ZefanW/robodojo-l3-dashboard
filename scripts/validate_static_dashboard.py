"""Offline static-mirror checks; no network, models, or native execution."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
from urllib.parse import urlparse

SPECIAL = {
    'thunlp-cap20-medium-local13-20261013-imitate_sorting_sequence-standard-s0-scene0': 'user_accepted_supplementary',
    'thunlp-full-ik-imitate-retry01-20261014-imitate_sorting_sequence-standard-s0-scene0': 'user_accepted_supplementary',
    'l3-low-r5-mixed42-20261014-imitate_sorting_sequence-standard-s0-scene4': 'user_assigned_zero',
}
SPECIAL_SHA256 = {'thunlp-cap20-medium-local13-20261013-imitate_sorting_sequence-standard-s0-scene0': '52f2459c7859a636113738ff211f77b0b7c72df8b09ca7cc202e3f42e5ae146e', 'thunlp-full-ik-imitate-retry01-20261014-imitate_sorting_sequence-standard-s0-scene0': '1676fae9cf0c1e623792b4d23bf4aec8715bad49fb1f57acc2d2af27cffa8750', 'l3-low-r5-mixed42-20261014-imitate_sorting_sequence-standard-s0-scene4': '08a032caece11e40668c8c188ee5cdbb9c43dd80223b6078dbb71bfb797bca82'}  # Exact previously authorized public rows.

def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()

def digest(raw):
    return hashlib.sha256(raw).hexdigest()

def read(path):
    return json.loads(Path(path).read_bytes())

def require(value, message):
    if not value:
        raise ValueError(message)

def normalized(row, *, formal=False):
    value = json.loads(json.dumps(row))
    value.pop('manifest_path', None)
    if formal:
        value.pop('configuration_parameters', None)
    for artifact in value['artifacts']:
        artifact.pop('site_path', None)
    return value

def semantic_digest(index):
    value = json.loads(json.dumps(index))
    value['runs'] = [normalized(row) for row in value['runs']]
    return digest(canonical(value))

def safe_path(root, relative):
    require(isinstance(relative, str) and re.fullmatch(r'data/runs/[A-Za-z0-9._/-]+', relative), 'Unsafe static path')
    parts = PurePosixPath(relative).parts
    require(not any(part in ('.', '..') for part in relative.split('/')), 'Unsafe static path component')
    path = root.joinpath(*parts)
    require(not path.is_symlink() and path.resolve().is_relative_to(root.resolve()), 'Static path escapes output')
    require(all(not parent.is_symlink() for parent in path.parents if parent != root.parent), 'Symlinked static parent')
    return path

def public_url(value):
    require(isinstance(value, str), 'Missing public artifact URL')
    parsed = urlparse(value)
    require(parsed.scheme == 'https' and parsed.netloc and not parsed.username and not parsed.password
            and not parsed.fragment and parsed.query in ('', 'dl=1', 'raw=1'), 'Unsafe public URL')

def validate(root):
    root = Path(root).resolve()
    index = read(root/'data/index.json')
    receipt = read(root/'data/projection.json')
    require(index['schema_version'] in ('l3-index-v1', 'l3-index-v2'), 'Unknown public index')
    require(receipt['schema_version'] == 'l3-static-projection-v1', 'Unknown projection receipt')
    require(semantic_digest(index) == receipt['source_semantic_sha256'], 'Catalog semantics changed in projection')
    require(digest((root/'data/index.json').read_bytes()) == receipt['static_index_sha256'], 'Static index changed')
    require(len(index['runs']) == receipt['records'], 'Record count changed')
    seen = set(); mirrors = set(); native = 0; special = 0; mirror_bytes = 0
    for row in index['runs']:
        rid = row['run_id']
        require(isinstance(rid, str) and re.fullmatch(r'[A-Za-z0-9._-]+', rid) and rid not in seen, 'Duplicate/unsafe run ID')
        seen.add(rid)
        prefix = 'data/runs/' + rid + '/'
        if row['evidence_level'] == 'native_terminal':
            path = prefix + 'manifest.json'
            require(row['manifest_path'] == path, 'Manifest path mismatch')
            manifest_file = safe_path(root, path)
            original = read(manifest_file)
            require(original == normalized(row, formal=True), 'Formal manifest differs from the original accepted record')
            require(digest(manifest_file.read_bytes()) == receipt['manifest_sha256'][rid], 'Original manifest bytes changed')
            require(original['evidence_level'] == 'native_terminal', 'Formal evidence level changed')
            native += 1
        else:
            require(SPECIAL.get(rid) == row['evidence_level'], 'Unapproved supplementary record')
            require(row.get('manifest_path') is None and row.get('formal_episode_result') is False
                    and row.get('strict_public_validation_passed') is False, 'Supplementary record represented as formally validated')
            require(digest(canonical(normalized(row))) == SPECIAL_SHA256.get(rid), 'Authorized supplementary row changed')
            special += 1
        for artifact in row['artifacts']:
            public_url(artifact['url'])
            require(type(artifact['bytes']) is int and artifact['bytes'] >= 0
                    and re.fullmatch(r'[0-9a-f]{64}', artifact['sha256']), 'Invalid artifact identity')
            if artifact['kind'] == 'raw_video':
                require(not artifact.get('site_path'), 'Video must retain its original public URL')
                continue
            path = prefix + artifact['path']
            require(artifact.get('site_path') == path, 'Evidence path mismatch')
            file = safe_path(root, path)
            if path not in mirrors:
                raw = file.read_bytes()
                require(len(raw) == artifact['bytes'] and digest(raw) == artifact['sha256'], 'Evidence SHA/size mismatch: ' + path)
                json.loads(raw); mirrors.add(path); mirror_bytes += len(raw)
    require(native == receipt['native_records'] and special == receipt['supplementary_records'], 'Evidence counts changed')
    for path in root.rglob('*'):
        require(not path.is_symlink(), 'Symlinks are not publishable')
    for name in ('index.html', 'app.js', 'style.css'):
        body = (root/name).read_text()
        require('chatgpt.site' not in body and '/api/' not in body, 'Frontend still depends on abandoned site APIs')
    require('http-equiv="refresh"' not in (root/'index.html').read_text(), 'Entry still redirects')
    return dict(records=len(seen), native_records=native, supplementary_records=special,
                mirrored_json_files=len(mirrors), mirrored_json_bytes=mirror_bytes, video_downloads=0,
                source_catalog_sha256=receipt['source_catalog_sha256'], static_index_sha256=receipt['static_index_sha256'])

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', nargs='?', default='web')
    print(json.dumps(validate(parser.parse_args().directory), sort_keys=True))
