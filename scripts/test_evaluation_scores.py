"""Fixed-plan coverage and official aggregation, without network or model calls."""
import copy
import json
from pathlib import Path
import tempfile
import unittest

from build_api import build
from evaluation_scores import case_key, evaluate_groups, score_plan, validate_plans


PLAN_PATH = Path(__file__).resolve().parents[1]/'web/evaluation-plans.json'


class EvaluationScoresTests(unittest.TestCase):
    def setUp(self):
        self.document = json.loads(PLAN_PATH.read_bytes())
        self.plans = validate_plans(self.document)
        self.rows = []
        for i, case in enumerate(self.plans['P50_111']['cases']):
            self.rows.append(dict(run_id='run-'+str(i), episode=copy.deepcopy(case),
                model=dict(name='example-model', thinking_effort='medium'),
                protocol=dict(profile='persistent-cap20', native_control_cap=20, max_decisions=100),
                evidence_level='native_terminal', artifacts=[], costs={},
                outcome=dict(score=.5, success=False, native_terminal=True, status='complete')))
        self.by_id = {r['run_id']: r for r in self.rows}
        self.group = dict(group_id='experiment', selection_id='example-selection',
            model=self.rows[0]['model'].copy(), protocol=self.rows[0]['protocol'].copy(),
            run_ids=list(self.by_id))
        self.source = dict(groups=[self.group], runs=self.rows)

    def score(self, plan='P50_111'):
        return score_plan(self.group, self.by_id, self.plans[plan])

    def test_manifest_has_exact_first_scenes_and_first_round_subset(self):
        first = self.plans['first_round']['cases']
        self.assertEqual(len(first), 42)
        self.assertEqual(sum(c['variant'] == 'random' for c in first), 12)
        self.assertTrue(all(c['scene'] == c['seed'] == 0 for c in first))
        generalization = [c for c in self.plans['P50_111']['cases'] if c['task'] == 'push_T']
        self.assertEqual([(c['variant'], c['scene']) for c in generalization],
                         [('random', 0), ('standard', 0), ('random', 1), ('standard', 1)])
        changed = copy.deepcopy(self.document)
        changed['plans']['P50_111']['cases'][1]['scene'] = 7
        with self.assertRaisesRegex(ValueError, 'scene prefix'):
            validate_plans(changed)

    def test_complete_scores_and_source_are_unchanged(self):
        before = copy.deepcopy(self.source)
        result = evaluate_groups(self.source, self.document)['experiment']
        self.assertEqual(result['first_round']['completed'], 42)
        self.assertEqual(result['P50_111']['completed'], 111)
        self.assertEqual(result['P50_111']['score'], .5)
        self.assertEqual(result['P50_111']['status'], 'complete')
        self.assertEqual(self.source, before)

    def test_task_then_capability_average_not_flat_episode_average(self):
        for row in self.rows:
            row['outcome']['score'] = 1 if row['episode']['capability'] == 'Memory' else 0
        result = self.score()
        self.assertAlmostEqual(result['score'], .2)
        flat = sum(r['outcome']['score'] for r in self.rows) / len(self.rows)
        self.assertNotAlmostEqual(result['score'], flat)
        # One four-repeat Open task contributes 1/(5*8), irrespective of its
        # four observations; a one-repeat task has the same task-level weight.
        for row in self.rows:
            row['outcome']['score'] = 1 if row['episode']['task'] == 'align_blocks' else 0
        self.assertAlmostEqual(self.score()['score'], 1/40)
        for row in self.rows:
            row['outcome']['score'] = 1 if row['episode']['task'] == 'pour_by_language' else 0
        self.assertAlmostEqual(self.score()['score'], 1/40)

    def test_later_scene_cannot_fill_missing_prefix(self):
        self.rows[1]['episode']['scene'] = 7
        result = self.score()
        self.assertEqual(result['status'], 'incomplete')
        self.assertEqual(result['completed'], 110)
        self.assertIsNone(result['score'])
        self.assertEqual(result['missing_cases'][0]['scene'], 1)
        self.assertEqual(self.score('first_round')['status'], 'complete')

    def test_variant_and_seed_are_part_of_identity(self):
        random0 = next(r for r in self.rows if r['episode']['variant'] == 'random')
        random0['episode']['variant'] = 'standard'
        result = self.score('first_round')
        self.assertEqual(result['completed'], 41)
        self.assertIsNone(result['score'])
        random0['episode']['variant'] = 'random'
        random0['episode']['seed'] = 1
        self.assertEqual(self.score('first_round')['completed'], 41)

    def test_duplicate_attempts_never_add_samples_or_pick_a_higher_score(self):
        self.group['run_ids'].append(self.rows[0]['run_id'])
        self.assertEqual(self.score()['completed'], 111)
        another = copy.deepcopy(self.rows[0])
        another.update(run_id='later-high-score')
        another['outcome']['score'] = 1
        self.by_id[another['run_id']] = another
        self.group['run_ids'].append(another['run_id'])
        result = self.score()
        self.assertEqual(result['status'], 'conflict')
        self.assertEqual(result['completed'], 110)
        self.assertIsNone(result['score'])
        self.assertEqual(set(result['conflicts'][0]['run_ids']), {'run-0', 'later-high-score'})

    def test_preserved_and_other_groups_do_not_fill_missing_selected_case(self):
        rid = self.group['run_ids'].pop(0)
        self.group['preserved_unselected_run_ids'] = [rid]
        self.source['groups'].append(dict(self.group, group_id='other', run_ids=[rid]))
        result = evaluate_groups(self.source, self.document)
        self.assertEqual(result['experiment']['P50_111']['completed'], 110)
        self.assertEqual(result['other']['P50_111']['completed'], 1)
        self.assertIsNone(result['experiment']['P50_111']['score'])

    def test_only_accepted_terminal_outcomes_count_and_zero_is_valid(self):
        self.rows[0]['outcome']['score'] = 0
        self.assertEqual(self.score()['status'], 'complete')
        for field, value in [('native_terminal', False), ('status', 'running'), ('score', float('nan'))]:
            original = self.rows[0]['outcome'][field]
            self.rows[0]['outcome'][field] = value
            self.assertEqual(self.score()['completed'], 110)
            self.rows[0]['outcome'][field] = original
        self.rows[0]['formal_episode_result'] = False
        self.assertEqual(self.score()['completed'], 110)

    def test_only_explicit_preexisting_user_supplements_count_without_promotion(self):
        row = self.rows[0]
        row.update(evidence_level='user_accepted_supplementary', formal_episode_result=False)
        row['outcome'].update(status='accepted_simplified')
        self.assertEqual(evaluate_groups(self.source, self.document)['experiment']['P50_111']['completed'], 110)
        self.source['user_accepted_supplements'] = {'source_packages': [{'run_id': row['run_id']}]}
        result = evaluate_groups(self.source, self.document)['experiment']['P50_111']
        self.assertEqual(result['completed'], 111)
        self.assertEqual(result['evidence_basis'], 'includes_user_accepted_supplementary')
        self.assertEqual(result['supplementary_run_ids'], [row['run_id']])
        self.assertIs(row['formal_episode_result'], False)

    def test_mismatched_settings_and_capability_do_not_count(self):
        self.rows[0]['model']['thinking_effort'] = 'low'
        self.assertEqual(self.score()['excluded_records'][0]['reason'], 'different_experiment_settings')
        self.rows[0]['model']['thinking_effort'] = 'medium'
        self.rows[0]['episode']['capability'] = 'Memory'
        self.assertEqual(self.score()['excluded_records'][0]['reason'], 'capability_mismatch')

    def test_api_scores_are_consistent_and_missing_becomes_complete_on_rebuild(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root/'data').mkdir()
            (root/'evaluation-plans.json').write_bytes(PLAN_PATH.read_bytes())
            missing_id = self.group['run_ids'].pop(1)
            def rebuild():
                (root/'data/index.json').write_text(json.dumps(self.source))
                build(root, verify=False)
                return json.loads((root/'api/v1/evaluations.json').read_bytes())
            pending = rebuild()
            self.assertEqual(pending['experiments'][0]['evaluation_scores']['P50_111']['status'], 'incomplete')
            self.group['run_ids'].append(missing_id)
            ready = rebuild()
            self.assertEqual(ready['experiments'][0]['evaluation_scores']['P50_111']['score'], .5)
            for path in ('experiments.json', 'experiments/experiment.json'):
                doc = json.loads((root/'api/v1'/path).read_bytes())
                scores = doc['experiments'][0]['evaluation_scores'] if path == 'experiments.json' else doc['evaluation_scores']
                self.assertEqual(scores, ready['experiments'][0]['evaluation_scores'])
                self.assertEqual(doc['snapshot_id'], ready['snapshot_id'])
            self.assertNotEqual(pending['snapshot_id'], ready['snapshot_id'])
            index = json.loads((root/'api/v1/index.json').read_bytes())
            self.assertTrue(index['links']['evaluations'].endswith('/api/v1/evaluations.json'))
            openapi = json.loads((root/'api/v1/openapi.json').read_bytes())
            self.assertIn('/evaluations.json', openapi['paths'])


if __name__ == '__main__':
    unittest.main()
