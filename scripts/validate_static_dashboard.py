"""Offline static-mirror checks; no network, models, or native execution."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import struct
import zlib
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

CODING_IMAGE_RUN = 'o23-depthpro-coding-unlimited-first42-add34-20261030-store_tools_in_toolbox-standard-s0-scene0'
CODING_IMAGE_SHA = '47e3f03752703dcf72b2e4d4fd9dd1edfd68eb432b9c757101ebe6305831016d'
CODING_REVIEW_SHA = '07b22508821b5aa779cb9286b421e7c259bdd0f1ebb9ed5d384108115dd67e45'

def validate_png_structure(raw):
    """Decode the exact reviewed RGB PNG layout, with no ancillary metadata."""
    require(raw.startswith(b'\x89PNG\r\n\x1a\n'), 'Coding image is not PNG')
    offset=8; kinds=[]; compressed=bytearray()
    while offset<len(raw):
        require(offset+12<=len(raw), 'Truncated PNG chunk')
        size=struct.unpack('>I',raw[offset:offset+4])[0];kind=raw[offset+4:offset+8]
        require(offset+12+size<=len(raw), 'Truncated PNG payload')
        payload=raw[offset+8:offset+8+size];crc=struct.unpack('>I',raw[offset+8+size:offset+12+size])[0]
        require(zlib.crc32(kind+payload)&0xffffffff==crc, 'PNG CRC mismatch')
        require(kind in (b'IHDR',b'IDAT',b'IEND'), 'PNG metadata or unsupported chunk is not publishable')
        kinds.append(kind)
        if kind==b'IHDR':
            require(len(kinds)==1 and size==13, 'PNG header order/size differs')
            require(struct.unpack('>IIBBBBB',payload)==(695,550,8,2,0,0,0), 'PNG dimensions or pixel format differs')
        elif kind==b'IDAT':
            require(kinds[0]==b'IHDR' and b'IEND'not in kinds and size>0, 'PNG data order differs')
            compressed.extend(payload)
        else:require(size==0 and offset+12==len(raw), 'PNG end/trailing bytes differ')
        offset+=size+12
    require(kinds[:1]==[b'IHDR'] and kinds[-1:]==[b'IEND'] and b'IDAT'in kinds and kinds.count(b'IHDR')==kinds.count(b'IEND')==1, 'Incomplete PNG stream')
    decoder=zlib.decompressobj();expected=550*(1+695*3)
    try: pixels=decoder.decompress(bytes(compressed),expected+1)
    except zlib.error as error:raise ValueError('Invalid PNG pixel compression')from error
    require(decoder.eof and not decoder.unused_data and not decoder.unconsumed_tail and len(pixels)==expected, 'PNG pixel stream size or end differs')
    require(all(pixels[row*(1+695*3)]<=4 for row in range(550)), 'PNG row filter differs')

def validate_coding_image(root,row,artifact,raw):
    """Permit only the original reviewed x07 image and its exact code output."""
    require(row['run_id']==CODING_IMAGE_RUN and row['evidence_level']=='native_terminal', 'Unreviewed coding image run')
    protocol=row['protocol']
    require(protocol['profile']=='o23-depthpro-coding-unlimited-v1' and protocol['max_decisions']is None and protocol['native_control_cap']==20, 'Coding image protocol differs')
    require(artifact['kind']=='coding_output_image' and artifact['media_type']=='image/png' and artifact['path']=='coding-output-000.png', 'Coding image kind/type/path differs')
    require(artifact['sha256']==CODING_IMAGE_SHA and artifact['bytes']==246801 and digest(raw)==CODING_IMAGE_SHA and len(raw)==246801, 'Coding image original bytes differ')
    validate_png_structure(raw)
    codes=[a for a in row['artifacts']if a['kind']=='coding_execution']
    require(len(codes)==1 and codes[0]['path']=='coding-review.json' and codes[0]['media_type']=='application/json' and codes[0]['sha256']==CODING_REVIEW_SHA, 'Image code artifact binding differs')
    codepath='data/runs/'+row['run_id']+'/coding-review.json';require(codes[0].get('site_path')==codepath, 'Image code mirror differs')
    code_raw=safe_path(root,codepath).read_bytes();require(digest(code_raw)==CODING_REVIEW_SHA and len(code_raw)==codes[0]['bytes'], 'Original image code bytes differ')
    code=json.loads(code_raw);require(code['schema_version']=='l3-native-coding-review-v4' and code['run_id']==row['run_id'], 'Image code version/identity differs')
    images=code.get('image_outputs');require(isinstance(images,list)and len(images)==1, 'Image output declaration count differs')
    image=images[0]
    for key,value in dict(artifact_path='coding-output-000.png',media_type='image/png',sha256=CODING_IMAGE_SHA,bytes=246801,width=695,height=550,decision_index=21,call_id='call_9cd154c4ab5749fcad18dd5c0908d017',output_index=2,scratch_path='tray.png',scratch_sha256=CODING_IMAGE_SHA).items():
        require(image.get(key)==value, 'Image declaration binding differs: '+key)
    calls=[c for c in code['tool_calls']if c.get('call_id')==image['call_id']]
    require(len(calls)==1 and calls[0]['decision_index']==21 and calls[0]['execution_kind']=='shell_then_view_image', 'Image original tool call differs')
    require(calls[0]['output'][2]==dict(type='input_image',artifact_path=image['artifact_path'],sha256=CODING_IMAGE_SHA,bytes=246801,media_type='image/png',detail='high'), 'Image original output block differs')

def validate(root):
    root = Path(root).resolve()
    index = read(root/'data/index.json')
    receipt = read(root/'data/projection.json')
    require(index['schema_version'] in ('l3-index-v1', 'l3-index-v2'), 'Unknown public index')
    require(receipt['schema_version'] == 'l3-static-projection-v1', 'Unknown projection receipt')
    require(semantic_digest(index) == receipt['source_semantic_sha256'], 'Catalog semantics changed in projection')
    require(digest((root/'data/index.json').read_bytes()) == receipt['static_index_sha256'], 'Static index changed')
    require(len(index['runs']) == receipt['records'], 'Record count changed')
    seen = set(); mirrors = set(); native = 0; special = 0; mirror_bytes = 0; image_mirrors=set(); image_bytes=0
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
                if artifact['kind']=='coding_output_image':
                    validate_coding_image(root,row,artifact,raw);image_mirrors.add(path);image_bytes+=len(raw)
                else:
                    # Legacy JSON records may omit the media declaration; the original JSON parse remains mandatory.
                    require(artifact.get('media_type','application/json')=='application/json' and artifact['path'].endswith('.json'), 'Non-image evidence must be JSON')
                    json.loads(raw);mirror_bytes+=len(raw)
                mirrors.add(path)
    require(native == receipt['native_records'] and special == receipt['supplementary_records'], 'Evidence counts changed')
    for path in root.rglob('*'):
        require(not path.is_symlink(), 'Symlinks are not publishable')
    for name in ('index.html', 'app.js', 'style.css'):
        body = (root/name).read_text()
        # /api/v1/ is this repository's read-only Pages artifact. Other /api/
        # routes belonged to the retired dynamic site and remain disallowed.
        require('chatgpt.site' not in body and '/api/' not in body.replace('/api/v1/', '/static-v1/'),
                'Frontend still depends on abandoned site APIs')
    require('http-equiv="refresh"' not in (root/'index.html').read_text(), 'Entry still redirects')
    return dict(records=len(seen), native_records=native, supplementary_records=special,
                mirrored_json_files=len(mirrors-image_mirrors), mirrored_json_bytes=mirror_bytes, mirrored_image_files=len(image_mirrors), mirrored_image_bytes=image_bytes, video_downloads=0,
                source_catalog_sha256=receipt['source_catalog_sha256'], static_index_sha256=receipt['static_index_sha256'])

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', nargs='?', default='web')
    print(json.dumps(validate(parser.parse_args().directory), sort_keys=True))
