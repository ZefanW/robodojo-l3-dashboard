"""Small offline checks for the static publishing boundary."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from validate_static_dashboard import canonical, digest, semantic_digest, validate, safe_path

class StaticMirrorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for name in ('index.html','app.js','style.css'): (self.root/name).write_text('static test')
        self.folder = self.root/'data/runs/example'; self.folder.mkdir(parents=True)
        action = b'[]'; (self.folder/'actions.json').write_bytes(action)
        self.manifest = dict(run_id='example',evidence_level='native_terminal',outcome=dict(score=.25,success=False),artifacts=[
            dict(kind='action_feedback',path='actions.json',url='https://example.test/actions',bytes=2,sha256=digest(action)),
            dict(kind='raw_video',path='head.mp4',url='https://example.test/video',bytes=999999999,sha256='a'*64)])
        (self.folder/'manifest.json').write_bytes(canonical(self.manifest))
        row = copy.deepcopy(self.manifest);row.update(manifest_path='data/runs/example/manifest.json',configuration_parameters={'mode':'original'})
        row['artifacts'][0]['site_path']='data/runs/example/actions.json'
        self.index=dict(schema_version='l3-index-v2',runs=[row],groups=[{'score':.25}],experiment_names={'group':'Fixed name'})
        self.save()
    def save(self):
        raw=canonical(self.index);(self.root/'data/index.json').write_bytes(raw)
        receipt=dict(schema_version='l3-static-projection-v1',source_semantic_sha256=semantic_digest(self.index),static_index_sha256=digest(raw),source_catalog_sha256='b'*64,records=1,native_records=1,supplementary_records=0,manifest_sha256={'example':digest((self.folder/'manifest.json').read_bytes())})
        (self.root/'data/projection.json').write_bytes(canonical(receipt))
    def test_valid_and_video_is_not_opened(self):
        self.assertEqual(validate(self.root)['video_downloads'],0)
        self.assertFalse((self.folder/'head.mp4').exists())
    def test_changed_metadata_is_rejected(self):
        (self.folder/'actions.json').write_text('[0]')
        with self.assertRaisesRegex(ValueError,'SHA/size'):validate(self.root)
    def test_formal_score_cannot_change(self):
        self.index['runs'][0]['outcome']['score']=1;self.save()
        with self.assertRaisesRegex(ValueError,'Formal manifest'):validate(self.root)
    def test_abandoned_api_path_rejected(self):
        self.index['runs'][0]['manifest_path']='/api/manifest/example';self.save()
        with self.assertRaisesRegex(ValueError,'Manifest path'):validate(self.root)
    def test_static_v1_allowed_but_retired_routes_blocked(self):
        app = self.root/'app.js'
        app.write_text('fetch("/api/v1/evaluations.json")')
        validate(self.root)
        for text in ['fetch("/api/catalog")', 'fetch("https://old.chatgpt.site/api/v1/evaluations.json")']:
            app.write_text(text)
            with self.assertRaisesRegex(ValueError,'abandoned site APIs'):validate(self.root)
    def test_unknown_supplement_cannot_bypass_manifest(self):
        self.index['runs'][0].update(evidence_level='user_accepted_supplementary',manifest_path=None,formal_episode_result=False,strict_public_validation_passed=False);self.save()
        with self.assertRaisesRegex(ValueError,'Unapproved supplementary'):validate(self.root)
    def test_paths_cannot_escape(self):
        with self.assertRaises(ValueError):safe_path(self.root,'data/runs/../secrets.json')
    def test_group_semantics_are_pinned(self):
        self.index['groups'][0]['score']=1
        (self.root/'data/index.json').write_bytes(canonical(self.index))
        with self.assertRaisesRegex(ValueError,'semantics'):validate(self.root)
    def test_original_manifest_bytes_are_pinned(self):
        (self.folder/'manifest.json').write_text(json.dumps(self.manifest,indent=2))
        with self.assertRaisesRegex(ValueError,'manifest bytes'):validate(self.root)

if __name__=='__main__':unittest.main()
