"""Build the public, read-only v1 API from the validated dashboard snapshot.

No network or private input: only web/data is read. Generated API files belong
to the Pages artifact, not the Git history. Every response identifies its source
snapshot so consumers can detect publication between two requests.
"""
import argparse
import collections
import copy
import json
from pathlib import Path
import re
import shutil
from urllib.parse import urlparse

from validate_static_dashboard import canonical, digest, read, require, safe_path, validate
from evaluation_scores import evaluate_groups

DEFAULT_SITE = 'https://zefanw.github.io/robodojo-l3-dashboard/'
VERSION = 'robodojo-api-v1'


def identifier(value):
    require(isinstance(value, str) and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]*', value),
            'Unsafe API identifier')
    return value


def build(root, site_url=DEFAULT_SITE, *, verify=True):
    root = Path(root).resolve()
    if verify:
        validate(root)
    parsed = urlparse(site_url)
    require(parsed.scheme == 'https' and parsed.netloc and not parsed.query
            and not parsed.fragment and not parsed.username and not parsed.password,
            'Expected a public HTTPS site URL')
    site_url = site_url.rstrip('/') + '/'
    api_url = site_url + 'api/v1/'
    source_raw = (root/'data/index.json').read_bytes()
    source = json.loads(source_raw)
    snapshot = digest(source_raw)
    rows = source['runs']
    by_id = {identifier(r['run_id']): r for r in rows}
    require(len(by_id) == len(rows), 'Duplicate result ID')
    groups = source['groups']
    require(len({identifier(g['group_id']) for g in groups}) == len(groups), 'Duplicate experiment ID')
    # The frozen plan ships with the builder, so alternate output roots and
    # isolated API fixtures use exactly the same agreed evaluation membership.
    plans_file = root/'evaluation-plans.json'
    if not plans_file.exists():
        plans_file = Path(__file__).resolve().parents[1]/'web/evaluation-plans.json'
    plans_raw = plans_file.read_bytes()
    plans_document = json.loads(plans_raw)
    evaluation_scores = evaluate_groups(source, plans_document)
    evaluation_plan_sha256 = digest(plans_raw)
    memberships = collections.defaultdict(list)
    experiment_rows = {}
    names = source.get('experiment_names', {})
    for group in groups:
        gid = identifier(group['group_id'])
        selected = set(group['run_ids'])
        preserved = set(group.get('preserved_unselected_run_ids', []))
        supplementary = set(group.get('supplementary_run_ids', []))
        require(not selected & preserved, 'Ambiguous selected/preserved membership')
        members = selected | preserved | supplementary
        require(members <= by_id.keys(), 'Experiment refers to an absent result')
        rounds = collections.defaultdict(list)
        for round_info in group.get('rounds', []):
            for rid in round_info['run_ids']:
                require(rid in selected, 'Round refers to an unselected result')
                rounds[rid].append(round_info['round'])
        for rid in sorted(members):
            memberships[rid].append(dict(experiment_id=gid, selection_id=group['selection_id'],
                selected=rid in selected, preserved_unselected=rid in preserved,
                supplementary=rid in supplementary, rounds=rounds[rid]))
        experiment_rows[gid] = sorted(members)

    def link(path):
        return api_url + path

    def envelope(**values):
        return dict(schema_version=VERSION, snapshot_id=snapshot, **values)

    summaries = {}
    for rid, row in sorted(by_id.items()):
        summaries[rid] = dict(run_id=rid, episode=row['episode'], model=row['model'],
            protocol=row['protocol'], outcome=row['outcome'], evidence_level=row['evidence_level'],
            formal_episode_result=row.get('formal_episode_result', row['evidence_level'] == 'native_terminal'),
            memberships=memberships[rid], created_at=row.get('created_at'),
            url=link('results/'+rid+'.json'))
    experiments = []
    for group in groups:
        gid = group['group_id']
        experiments.append(dict(experiment_id=gid, selection_id=group['selection_id'],
            name=names.get(gid, group.get('selection_title', group['selection_id'])),
            model=group['model'], protocol=group['protocol'], metrics=group.get('metrics'),
            evaluation_scores=evaluation_scores[gid],
            result_count=len(experiment_rows[gid]), selected_count=len(group['run_ids']),
            round_count=len(group.get('rounds', [])),
            url=link('experiments/'+gid+'.json'),
            results_url=link('experiments/'+gid+'/results.json')))
    experiments.sort(key=lambda x: (x['selection_id'], x['experiment_id']))

    target = root/'api/v1'
    staging = root/'api/.v1-building'
    require(not target.is_symlink() and not staging.is_symlink() and not (root/'api').is_symlink(),
            'API output must not be symlinked')
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True)
    generated = []

    def emit(path, value):
        file = staging/path
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(canonical(value) + b'\n')
        generated.append(path)

    try:
        emit('experiments.json', envelope(count=len(experiments), experiments=experiments))
        emit('evaluations.json', envelope(evaluation_plan_sha256=evaluation_plan_sha256,
            plan_version=plans_document['plan_version'], score_scale='0..1',
            aggregation=plans_document['aggregation'], plans=plans_document['plans'],
            experiments=[dict(experiment_id=e['experiment_id'], selection_id=e['selection_id'],
                              name=e['name'], evaluation_scores=e['evaluation_scores']) for e in experiments]))
        emit('results.json', envelope(count=len(summaries), results=list(summaries.values())))
        for group in groups:
            gid = group['group_id']
            emit('experiments/'+gid+'.json', envelope(experiment_id=gid,
                name=names.get(gid, group.get('selection_title', group['selection_id'])),
                experiment=group, evaluation_scores=evaluation_scores[gid],
                results_url=link('experiments/'+gid+'/results.json')))
            emit('experiments/'+gid+'/results.json', envelope(experiment_id=gid,
                selection_id=group['selection_id'], count=len(experiment_rows[gid]),
                results=[summaries[rid] for rid in experiment_rows[gid]]))

        tasks = collections.defaultdict(list)
        evidence_bytes = 0
        for rid, original in sorted(by_id.items()):
            row = copy.deepcopy(original)
            evidence = []
            videos = []
            for artifact in row['artifacts']:
                artifact['source_url'] = artifact['url']
                if artifact['kind'] == 'raw_video':
                    artifact['storage'] = 'original_public_video'
                    videos.append(copy.deepcopy(artifact))
                else:
                    path = safe_path(root, artifact['site_path'])
                    raw = path.read_bytes()
                    require(len(raw) == artifact['bytes'] and digest(raw) == artifact['sha256'],
                            'Published evidence changed during API build')
                    artifact['url'] = site_url + artifact['site_path']
                    artifact['storage'] = 'github_pages'
                    evidence.append(dict(kind=artifact['kind'], path=artifact['path'],
                        sha256=artifact['sha256'], bytes=artifact['bytes'],
                        url=artifact['url'], data=json.loads(raw)))
                    evidence_bytes += len(raw)
            manifest_url = site_url + row['manifest_path'] if row.get('manifest_path') else None
            emit('results/'+rid+'.json', envelope(run_id=rid, memberships=memberships[rid],
                result=row, evidence=evidence, videos=videos, original_manifest_url=manifest_url))
            tasks[identifier(row['episode']['task'])].append(summaries[rid])
        task_list = []
        for task, results in sorted(tasks.items()):
            emit('tasks/'+task+'.json', envelope(task=task, count=len(results), results=results))
            task_list.append(dict(task=task, result_count=len(results), url=link('tasks/'+task+'.json')))
        emit('tasks.json', envelope(count=len(tasks), tasks=task_list))
        emit('round-selections.json', envelope(round_selections=source.get('round_selections', [])))
        emit('status.json', envelope(upload_queue=source.get('upload_queue', []),
            pending_review=source.get('pending_review', []),
            note='Publication status only; this endpoint does not report live simulator/controller health.'))
        emit('index.json', envelope(site_url=site_url, api_url=api_url,
            counts=dict(experiments=len(groups), results=len(rows), tasks=len(tasks)),
            links={name:link(name+'.json') for name in ['experiments','evaluations','results','tasks','round-selections','status','openapi']},
            evaluation_plan_sha256=evaluation_plan_sha256,
            documentation_url=site_url+'api/',
            score_scale='0..1', methods=['GET','HEAD'],
            query_filtering=False, authentication='none',
            structured_evidence='embedded in each result and mirrored on this site',
            videos='original public download URLs; video bytes are not hosted by this API'))
        emit('openapi.json', openapi(api_url))
        # Verify generated membership and full-evidence coverage, independently
        # of output counters. Never silently omit an artifact or result.
        for rid, original in by_id.items():
            doc = read(staging/('results/'+rid+'.json'))
            require(doc['result']['outcome'] == original['outcome'], 'Outcome changed')
            require(doc['result']['costs'] == original['costs'], 'Cost accounting changed')
            expected = {(a['kind'], a['path'], a['sha256']) for a in original['artifacts'] if a['kind'] != 'raw_video'}
            require({(a['kind'],a['path'],a['sha256']) for a in doc['evidence']} == expected,
                    'Incomplete structured evidence')
        require((root/'data/index.json').read_bytes() == source_raw, 'Snapshot changed during build')
        require(plans_file.read_bytes() == plans_raw, 'Evaluation plan changed during build')
        if target.exists():
            shutil.rmtree(target)
        staging.rename(target)
    except Exception:
        if staging.exists():
            shutil.rmtree(staging)
        raise
    return dict(snapshot_id=snapshot, experiments=len(groups), results=len(rows), tasks=len(tasks),
                generated_files=len(generated), structured_evidence_bytes=evidence_bytes,
                output_bytes=sum(p.stat().st_size for p in target.rglob('*') if p.is_file()),
                video_downloads=0)


def openapi(api_url):
    specs = [
        ('/index.json','Get API version, snapshot and endpoint links',None),
        ('/experiments.json','List experiment groups and summary metrics',None),
        ('/evaluations.json','Get frozen first-round, Spiky-2 (65 cases) and P50_111 scores, exact coverage and selected result IDs',None),
        ('/experiments/{experiment_id}.json','Get original experiment summary and rounds','experiment_id'),
        ('/experiments/{experiment_id}/results.json','List selected and preserved results in an experiment','experiment_id'),
        ('/results.json','List all published result summaries',None),
        ('/results/{run_id}.json','Get complete result and embedded structured evidence','run_id'),
        ('/tasks.json','List task families',None),
        ('/tasks/{task}.json','Compare a task across all experiments, seeds and scenes','task'),
        ('/round-selections.json','Get declared round membership plans',None),
        ('/status.json','Get upload and publication review status',None),
    ]
    paths = {}
    for path, summary, param in specs:
        operation = dict(summary=summary, responses={
            '200': {'description':'A public snapshot response', 'content':{'application/json':{'schema':{'$ref':'#/components/schemas/Envelope'}}}},
            '404': {'description':'Unknown identifier or path. GitHub Pages returns an HTML 404; check HTTP status before parsing JSON.'}})
        if param:
            operation['parameters']=[dict(name=param, **{'in':'path'}, required=True,
                schema={'type':'string','pattern':'^[A-Za-z0-9][A-Za-z0-9._-]*$'})]
        paths[path]={'get':operation}
    return dict(openapi='3.1.0', info=dict(title='RoboDojo L3 public data API',version='1.0.0',
        description='Read-only static JSON API. No authentication or server-side query filtering. All published structured evidence is included in result detail. Video URLs point to the original public storage.'),
        servers=[{'url':api_url.rstrip('/')}], paths=paths,
        components={'schemas':{'Envelope':{'type':'object','required':['schema_version','snapshot_id'],
            'properties':{'schema_version':{'const':VERSION},'snapshot_id':{'type':'string','pattern':'^[0-9a-f]{64}$'}},
            'additionalProperties':True}}})


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', nargs='?', default='web')
    parser.add_argument('--site-url', default=DEFAULT_SITE)
    args = parser.parse_args()
    print(json.dumps(build(args.directory, args.site_url), sort_keys=True))
