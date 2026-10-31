"""Mirror a trusted public catalog locally. Never fetch URLs or write to a service.

Pass the existing intake config only to locate original local accepted files.
All private source paths stay out of web/. Videos are never opened or copied.
"""
import argparse
import collections
import json
import os
from pathlib import Path
from validate_static_dashboard import canonical, digest, normalized, read, require, safe_path, semantic_digest, validate


def atomic(path, raw):
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_file() and path.read_bytes() == raw:
        return False
    temp = path.with_name(path.name + '.projection-tmp')
    with temp.open('wb') as stream:
        stream.write(raw); stream.flush(); os.fsync(stream.fileno())
    os.replace(temp, path)
    return True


def project(catalog, output, pipeline_config=None, artifact_roots=(), inventory_only=False):
    catalog = Path(catalog); output = Path(output).resolve()
    source_raw = catalog.read_bytes(); index = json.loads(source_raw)
    manifests = {}; artifacts = collections.defaultdict(list)
    def add_artifact(artifact, path):
        if artifact['kind'] != 'raw_video' and path.is_file():
            artifacts[(artifact['sha256'], artifact['bytes'])].append(path)
    def add_manifest(path):
        if not path.is_file(): return
        doc = read(path); rid = doc['run_id']
        manifests.setdefault(rid, []).append(path)
        for artifact in doc['artifacts']:
            add_artifact(artifact, path.parent/artifact['path'])
    if pipeline_config:
        config_file = Path(pipeline_config); config = read(config_file)
        base = Path(config['base_index']); base_raw = base.read_bytes()
        require(digest(base_raw) == config['base_index_sha256'], 'Pinned original base index changed')
        for row in json.loads(base_raw)['runs']:
            if row.get('manifest_path'): add_manifest(base.parent.parent/row['manifest_path'])
            for artifact in row['artifacts']:
                if artifact.get('site_path'): add_artifact(artifact, base.parent.parent/artifact['site_path'])
        for path in (config_file.parent/'accepted').glob('*/manifest.json'): add_manifest(path)
        for root in config.get('completed_roots', []):
            for path in Path(root).glob('*/accepted/manifest.json'): add_manifest(path)
    for path in (output/'data/runs').glob('*/manifest.json'): add_manifest(path)
    for directory in artifact_roots:
        directory = Path(directory)
        # Only the explicitly supplied shallow JSON directory, never videos or
        # model journals. Published artifact SHA determines eligibility.
        for path in directory.glob('*.json'):
            if path.is_file() and not path.is_symlink():
                raw = path.read_bytes(); artifacts[(digest(raw), len(raw))].append(path)
    work = []; missing = []; manifest_hashes = {}; native = 0; special = 0
    for row in index['runs']:
        rid = row['run_id']; prefix = 'data/runs/' + rid + '/'
        if row['evidence_level'] == 'native_terminal':
            expected = normalized(row, formal=True)
            matches = [path for path in manifests.get(rid, []) if read(path) == expected]
            if not matches: missing.append(dict(run_id=rid, kind='manifest')); continue
            original = matches[0]; raw = original.read_bytes(); target = prefix+'manifest.json'
            manifest_hashes[rid] = digest(raw); work.append((target, original, digest(raw), len(raw)))
            row['manifest_path'] = target; native += 1
        else:
            require(row.get('manifest_path') is None, 'Supplementary record gained a formal manifest')
            special += 1
        for artifact in row['artifacts']:
            if artifact['kind'] == 'raw_video': continue
            target = prefix + artifact['path']; destination = safe_path(output, target)
            candidates = [destination] if destination.is_file() else []
            candidates += artifacts.get((artifact['sha256'], artifact['bytes']), [])
            valid = None
            for path in candidates:
                if path.is_symlink() or path.stat().st_size != artifact['bytes']: continue
                if digest(path.read_bytes()) == artifact['sha256']:
                    valid = path; break
            if valid is None: missing.append(dict(run_id=rid, kind=artifact['kind'], path=artifact['path'], sha256=artifact['sha256'])); continue
            work.append((target, valid, artifact['sha256'], artifact['bytes']))
            artifact['site_path'] = target
    summary = dict(records=len(index['runs']), native_records=native, supplementary_records=special,
                   source_catalog_sha256=digest(source_raw), missing=missing,
                   mirrored_json_bytes=sum(size for target,_,_,size in work if target.endswith('.json')),
                   mirrored_image_bytes=sum(size for target,_,_,size in work if target.endswith('.png')), video_downloads=0)
    if inventory_only: return summary
    require(not missing, 'Original static inputs missing: ' + json.dumps(missing))
    copied = reused = 0
    for relative, source, expected, size in work:
        target = safe_path(output, relative)
        if target == source:
            reused += 1; continue
        raw = source.read_bytes()
        require(len(raw) == size and digest(raw) == expected, 'Original metadata changed while projecting')
        if atomic(target, raw): copied += 1
        else: reused += 1
    static_raw = canonical(index)
    receipt = dict(schema_version='l3-static-projection-v1', source_catalog_sha256=digest(source_raw),
                   source_semantic_sha256=semantic_digest(json.loads(source_raw)), static_index_sha256=digest(static_raw),
                   records=len(index['runs']), native_records=native, supplementary_records=special,
                   manifest_sha256=manifest_hashes, videos_retained_at_original_public_urls=True,
                   original_outcomes_groups_and_costs_unchanged=True)
    require(semantic_digest(index) == receipt['source_semantic_sha256'], 'Projection changed more than display paths')
    atomic(output/'data/projection.json', canonical(receipt))
    atomic(output/'data/index.json', static_raw)  # Commit the new readable snapshot last.
    result = validate(output)
    result.update(copied_files=copied, reused_files=reused)
    return result

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--catalog', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--pipeline-config')
    parser.add_argument('--artifact-root', action='append', default=[])
    parser.add_argument('--inventory-only', action='store_true')
    args = parser.parse_args()
    print(json.dumps(project(args.catalog, args.output, args.pipeline_config, args.artifact_root, args.inventory_only), sort_keys=True))
