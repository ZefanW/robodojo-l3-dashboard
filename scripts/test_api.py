"""Offline API membership, evidence completeness and snapshot contract tests."""
import copy
import json
from pathlib import Path
import tempfile
import unittest

from build_api import build, canonical, digest, read


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.rows = []
        for rid, level in [('selected','native_terminal'),('preserved','native_terminal'),
                           ('supplement','user_accepted_supplementary')]:
            raw = b'{"actions":[{"control":1,"value":0.25}]}\n'
            path = 'data/runs/'+rid+'/actions.json'
            file = self.root/path; file.parent.mkdir(parents=True); file.write_bytes(raw)
            row = dict(run_id=rid, episode=dict(task='push_T',variant='standard',seed=0,scene=3),
                model=dict(name='gpt-6-astra',thinking_effort='medium'),
                protocol=dict(profile='persistent-cap20'), outcome=dict(score=0.5,success=False),
                costs=dict(total_tokens=None,known_token_lower_bound=10), evidence_level=level,
                artifacts=[dict(kind='action_feedback',path='actions.json',site_path=path,
                    url='https://example.org/actions',sha256=digest(raw),bytes=len(raw)),
                    dict(kind='raw_video',path='head.mp4',url='https://example.org/video',sha256='a'*64,bytes=99)])
            if level != 'native_terminal': row['formal_episode_result']=False
            self.rows.append(row)
        self.source = dict(runs=self.rows, groups=[dict(group_id='group-1',selection_id='selection-1',
            model=self.rows[0]['model'],protocol=self.rows[0]['protocol'],metrics={'score':None},
            run_ids=['selected','supplement'], preserved_unselected_run_ids=['preserved'],
            supplementary_run_ids=['supplement'],rounds=[{'round':8,'run_ids':['selected','supplement']}])],
            experiment_names={'group-1':'Shared alias'},upload_queue=[],pending_review=[])
        self.save()

    def save(self):
        (self.root/'data/index.json').write_bytes(canonical(self.source))

    def generate(self):
        return build(self.root, verify=False)

    def api(self, path):
        return read(self.root/'api/v1'/path)

    def test_complete_evidence_preserves_outcomes_costs_and_source_bytes(self):
        original = (self.root/'data/runs/selected/actions.json').read_bytes()
        result = self.generate()
        detail = self.api('results/selected.json')
        self.assertEqual(detail['result']['outcome'], self.rows[0]['outcome'])
        self.assertEqual(detail['result']['costs'], self.rows[0]['costs'])
        self.assertEqual(detail['evidence'][0]['data'], json.loads(original))
        self.assertEqual(detail['result']['artifacts'][0]['source_url'], 'https://example.org/actions')
        self.assertIn('github.io', detail['result']['artifacts'][0]['url'])
        self.assertEqual(detail['videos'][0]['url'], 'https://example.org/video')
        self.assertEqual((self.root/'data/runs/selected/actions.json').read_bytes(), original)
        self.assertEqual(result['video_downloads'], 0)

    def add_original_coding_image(self):
        public = Path(__file__).resolve().parents[1]/'web'
        rid = 'o23-depthpro-coding-unlimited-first42-add34-20261030-store_tools_in_toolbox-standard-s0-scene0'
        row = copy.deepcopy(next(r for r in read(public/'data/index.json')['runs'] if r['run_id'] == rid))
        for artifact in row['artifacts']:
            if artifact['kind'] == 'raw_video': continue
            target = self.root/artifact['site_path'];target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes((public/artifact['site_path']).read_bytes())
        self.source['runs'].append(row)
        self.source['groups'][0]['run_ids'].append(rid)
        self.save()
        return row

    def test_original_coding_image_binary_reference_keeps_all_evidence(self):
        row = self.add_original_coding_image(); result = self.generate()
        detail = self.api('results/'+row['run_id']+'.json')
        image = next(a for a in row['artifacts'] if a['kind'] == 'coding_output_image')
        item = next(a for a in detail['evidence'] if a['kind'] == 'coding_output_image')
        self.assertEqual(item, dict(kind=image['kind'], path=image['path'], sha256=image['sha256'],
            bytes=image['bytes'], url='https://zefanw.github.io/robodojo-l3-dashboard/'+image['site_path'],
            media_type='image/png', representation='binary_reference', data=None))
        expected = {(a['kind'],a['path'],a['sha256']) for a in row['artifacts'] if a['kind'] != 'raw_video'}
        self.assertEqual(expected,{(a['kind'],a['path'],a['sha256'])for a in detail['evidence']})
        self.assertEqual(result['binary_evidence_files'],1)
        self.assertEqual(result['binary_evidence_bytes'],246801)
        self.assertEqual(result['structured_evidence_bytes'],sum(a['bytes']for r in self.source['runs'] for a in r['artifacts'] if a['kind'] not in ('raw_video','coding_output_image')))
        self.assertEqual(detail['result']['costs'], row['costs'])
        self.assertEqual(detail['result']['outcome'], row['outcome'])
        # The old JSON object remains byte-for-byte equivalent canonically.
        action = next(a for a in detail['evidence'] if a['kind'] == 'action_feedback')
        original = next(a for a in row['artifacts'] if a['kind'] == 'action_feedback')
        self.assertEqual(canonical(action),canonical(dict(kind=original['kind'],path=original['path'],
            sha256=original['sha256'],bytes=original['bytes'],
            url='https://zefanw.github.io/robodojo-l3-dashboard/'+original['site_path'],
            data=read(self.root/original['site_path']))))

    def test_original_coding_image_corruption_fails_without_replacing_api(self):
        row=self.add_original_coding_image();self.generate()
        before=(self.root/'api/v1/results'/ (row['run_id']+'.json')).read_bytes()
        image=next(a for a in row['artifacts'] if a['kind']=='coding_output_image')
        (self.root/image['site_path']).write_bytes(b'corrupt')
        with self.assertRaisesRegex(ValueError,'evidence changed'): self.generate()
        self.assertEqual(before,(self.root/'api/v1/results'/(row['run_id']+'.json')).read_bytes())

    def test_original_coding_image_wrong_media_rejected_even_without_static_verify(self):
        row=self.add_original_coding_image()
        next(a for a in row['artifacts'] if a['kind']=='coding_output_image')['media_type']='application/json'
        self.save()
        with self.assertRaisesRegex(ValueError,'kind/type/path'): self.generate()

    def test_original_coding_image_foreign_identity_rejected(self):
        row=self.add_original_coding_image()
        row['protocol']['profile']='persistent-cap20';self.save()
        with self.assertRaisesRegex(ValueError,'protocol differs'): self.generate()

    def test_round_and_preserved_membership_do_not_promote_supplements(self):
        self.generate()
        records = {r['run_id']:r for r in self.api('experiments/group-1/results.json')['results']}
        self.assertEqual(len(records), 3)
        self.assertTrue(records['preserved']['memberships'][0]['preserved_unselected'])
        self.assertFalse(records['preserved']['memberships'][0]['selected'])
        self.assertEqual(records['preserved']['memberships'][0]['rounds'], [])
        self.assertEqual(records['selected']['memberships'][0]['rounds'], [8])
        self.assertTrue(records['supplement']['memberships'][0]['supplementary'])
        self.assertFalse(records['supplement']['formal_episode_result'])
        self.assertEqual(self.api('experiments.json')['experiments'][0]['name'], 'Shared alias')

    def test_snapshot_links_task_coverage_and_determinism(self):
        first = self.generate()
        content = {str(p.relative_to(self.root)):p.read_bytes() for p in (self.root/'api/v1').rglob('*.json')}
        self.assertEqual(self.generate(), first)
        self.assertEqual(content,{str(p.relative_to(self.root)):p.read_bytes() for p in (self.root/'api/v1').rglob('*.json')})
        self.assertEqual(self.api('tasks/push_T.json')['count'], 3)
        self.assertEqual(self.api('index.json')['snapshot_id'],digest((self.root/'data/index.json').read_bytes()))
        for p in (self.root/'api/v1').rglob('*.json'):
            if p.name != 'openapi.json': self.assertEqual(read(p)['snapshot_id'],first['snapshot_id'])

    def test_changed_evidence_aborts_without_replacing_previous_api(self):
        self.generate(); before=(self.root/'api/v1/results/selected.json').read_bytes()
        (self.root/'data/runs/selected/actions.json').write_bytes(b'{}')
        with self.assertRaisesRegex(ValueError,'evidence changed'):
            self.generate()
        self.assertEqual((self.root/'api/v1/results/selected.json').read_bytes(),before)

    def test_missing_members_and_unsafe_identifiers_fail_closed(self):
        self.source['groups'][0]['run_ids'].append('missing');self.save()
        with self.assertRaisesRegex(ValueError,'absent result'):self.generate()
        self.source['groups'][0]['run_ids'].pop();self.source['runs'][0]['run_id']='../escape';self.save()
        with self.assertRaisesRegex(ValueError,'Unsafe API identifier'):self.generate()

    def test_rebuild_removes_stale_api_documents(self):
        self.generate();stale=self.root/'api/v1/results/stale.json';stale.write_text('{}')
        self.generate();self.assertFalse(stale.exists())

    def test_custom_origin_rejects_embedded_credentials(self):
        for url in ['https://:secret@example.org/', 'https://user@example.org/']:
            with self.assertRaisesRegex(ValueError,'public HTTPS'):
                build(self.root, site_url=url, verify=False)


if __name__ == '__main__':
    unittest.main()
