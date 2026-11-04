"""Fixed scene-based evaluation scores from already accepted public records.

This module never changes source outcomes or chooses the best retry. A complete
fixed manifest, not a count of arbitrary episodes, is required to release a score.
"""
import collections
import math


CASE_FIELDS = ('task', 'variant', 'seed', 'scene')
CAPABILITY_COUNTS = {'Generalization': 12, 'Long-Horizon': 8, 'Memory': 6,
                     'Open': 8, 'Precision': 8}
PLAN_ALLOCATIONS = {'first_round': (42, {1: 42}),
                    'spiky2_65': (65, {1: 19, 2: 23}),
                    'P50_111': (111, {1: 19, 4: 23})}
NOCAP_RERUN_REUSED_BEHAVIORS = {
    'nocap-import-l3_persistent_v1_arrange_largest_number_s0_layout0_20261002_v1':
        'c181e609f88ca46a0bdb04b7dc77bbe2631455f2c50902a2e5785488da6f97af',
    'nocap-import-l3_persistent_v1_fold_clothes_s0_layout0_20261002_v1':
        '0d182fd39111e8f55d379c61837689b48cf05d0b05531bd9674afad44a43ed9e',
    'nocap-import-l3_persistent_v1_pack_objects_into_box_s0_layout0_20261002_v1':
        '02da934259165ecba44d38957201d2804e2003e1d2c9655fe12181c4eee96bbc',
    'nocap-import-l3_persistent_v1_push_T_s0_layout0_20261002_v1':
        'faf27fc6019cbbb867a7fca7cfd7db4699d63d49984dbe48e6aacd414f8cdf46',
    'nocap-import-l3_persistent_v1_sort_nesting_dolls_by_size_s0_layout0_20261002_v1':
        'e33a8b9f6819b1f79b530b92f580f4e183bb565c31e743eae34c2ca77c32a0b9',
    'nocap-import-l3_persistent_v1_stack_bowls_s0_layout0_20261002_v1':
        '73aa404a3ffdb62ac43142a894fe80a401e4cbfbbbd3f21de3becc679a092b75',
}


def case_key(episode):
    return tuple(episode.get(k) for k in CASE_FIELDS)


def validate_plans(document):
    """Reject an accidental change of the agreed prefix/allocation geometry."""
    if document.get('schema_version') != 'robodojo-evaluation-plans-v1':
        raise ValueError('Unknown fixed evaluation manifest')
    plans = document['plans']
    if set(plans) != set(PLAN_ALLOCATIONS):
        raise ValueError('Expected first_round, spiky2_65 and P50_111')
    task_capabilities = {}
    repeated_tasks = {}
    for pid, (expected, allocation) in PLAN_ALLOCATIONS.items():
        plan = plans[pid]
        cases = plan['cases']
        if plan['plan_id'] != pid or plan['expected'] != expected or len(cases) != expected:
            raise ValueError('Fixed evaluation size changed')
        if len({case_key(c) for c in cases}) != expected:
            raise ValueError('Duplicate fixed scene')
        tasks = collections.defaultdict(list)
        for case in cases:
            if any(type(case[k]) is not int for k in ('seed', 'scene')) or case['seed'] != 0:
                raise ValueError('Fixed scenes require seed zero and integer scene')
            task, capability = case['task'], case['capability']
            if capability not in CAPABILITY_COUNTS or (task in task_capabilities and task_capabilities[task] != capability):
                raise ValueError('Task capability changed')
            task_capabilities[task] = capability
            tasks[task].append(case)
        if collections.Counter(task_capabilities[t] for t in tasks) != CAPABILITY_COUNTS:
            raise ValueError('Expected all 42 official task families')
        repeats = collections.Counter(len(c) for c in tasks.values())
        if repeats != allocation:
            raise ValueError('Fixed task allocation changed')
        repeated_tasks[pid] = {task for task, cases in tasks.items() if len(cases) > 1}
        for task, task_cases in tasks.items():
            generalization = task_capabilities[task] == 'Generalization'
            n = len(task_cases)
            expected_tuples = {(('random' if i % 2 == 0 else 'standard'), i // 2)
                               if generalization else ('standard', i) for i in range(n)}
            if {(c['variant'], c['scene']) for c in task_cases} != expected_tuples:
                raise ValueError('Fixed scene prefix changed')
    if repeated_tasks['spiky2_65'] != repeated_tasks['P50_111']:
        raise ValueError('Spiky-2 must repeat the same 23 spiky tasks as P50_111')
    first, compact, full = ({case_key(c) for c in plans[pid]['cases']}
                            for pid in PLAN_ALLOCATIONS)
    if not first <= compact <= full:
        raise ValueError('Fixed plans must contain first_round within Spiky-2 within P50_111')
    return plans


def scoring_profile(row, group):
    """Resolve the declared NoCap historical label for the verified devset members."""
    profile = row.get('protocol', {}).get('profile')
    if (group.get('group_id') == 'b38355a9f7dfb9ca45d6592cbc796b413274de34c79b67f99365fa14e447aa42'
            and group.get('selection_id') == 'persistent-nocap-medium-mixed42-v1'
            and group['protocol'].get('profile') == 'persistent-nocap'
            and profile == 'persistent'
            and row['protocol'].get('id') == 'persistent-nocap-medium-historical-v1'
            and row.get('selection', {}).get('id') == 'persistent-nocap-medium-full54-v1'
            and row['run_id'] in group.get('devset_supplement', {}).get('profile_alias_run_ids', [])
            and row.get('versions', {}).get('behavior_sha256') ==
            '10dfad791bb3000c97a33f3ba96ba0f2e97f39109635fba09998075f58ff9e8c'):
        return 'persistent-nocap'
    if (group.get('group_id') == 'f0ba6a3b6e7c6553d771e41507561cd747d408d7d62bc933b6f8eff3ed5b9040'
            and group.get('selection_id') == 'persistent-nocap-rerun'
            and group.get('protocol', {}).get('profile') == 'persistent'
            and profile == 'persistent-nocap'
            and row['protocol'].get('id') == 'persistent-nocap-medium-historical-v1'
            and row.get('selection', {}).get('id') == 'persistent-nocap-medium-full54-v1'
            and row['run_id'] in NOCAP_RERUN_REUSED_BEHAVIORS
            and row['run_id'] in group.get('devset_supplement', {}).get('reused_original_run_ids', [])
            and row.get('versions', {}).get('behavior_sha256') ==
            NOCAP_RERUN_REUSED_BEHAVIORS[row['run_id']]):
        return 'persistent'
    return profile


def accepted_kind(row, group, approved_supplements):
    """Keep exact pre-existing user exceptions separate from native evidence."""
    outcome = row.get('outcome', {})
    score = outcome.get('score')
    if type(score) not in (int, float) or not math.isfinite(score) or not 0 <= score <= 1:
        return None, 'invalid_score'
    if type(outcome.get('success')) is not bool:
        return None, 'missing_success'
    for category, keys in (('model', ('name', 'thinking_effort')),
                           ('protocol', ('native_control_cap', 'max_decisions'))):
        if any(row.get(category, {}).get(k) != group.get(category, {}).get(k) for k in keys):
            return None, 'different_experiment_settings'
    if scoring_profile(row, group) != group.get('protocol', {}).get('profile'):
        return None, 'different_experiment_settings'
    if (row.get('evidence_level') == 'native_terminal'
            and outcome.get('native_terminal') is True
            and outcome.get('status') == 'complete'
            and row.get('formal_episode_result', True) is True
            and row.get('strict_public_validation_passed', True) is True):
        return 'native', None
    if (row['run_id'] in approved_supplements
            and row.get('evidence_level') == 'user_accepted_supplementary'
            and outcome.get('status') == 'accepted_simplified'
            and row.get('formal_episode_result') is False):
        return 'user_accepted_supplementary', None
    return None, 'not_accepted_terminal_evidence'


def score_plan(group, by_id, plan, approved_supplements=()):
    required = {case_key(c): c for c in plan['cases']}
    candidates = collections.defaultdict(list)
    excluded = []
    # Repeated membership of one run is not another observation. Distinct runs
    # for one required tuple are a conflict until source selection resolves it.
    for rid in sorted(set(group['run_ids'])):
        row = by_id.get(rid)
        if row is None:
            raise ValueError('Experiment refers to an absent result selected for scoring: ' + rid)
        key = case_key(row.get('episode', {}))
        if key not in required:
            continue
        kind, reason = accepted_kind(row, group, approved_supplements)
        if row['episode'].get('capability') != required[key]['capability']:
            kind, reason = None, 'capability_mismatch'
        if kind is None:
            excluded.append({'run_id': rid, 'case': required[key], 'reason': reason})
        else:
            candidates[key].append((row, kind))
    chosen, missing, conflicts, supplements = [], [], [], []
    task_rows = collections.defaultdict(list)
    for case in plan['cases']:
        matches = candidates[case_key(case)]
        if not matches:
            missing.append(case)
        elif len(matches) > 1:
            conflicts.append({'case': case, 'run_ids': sorted(r['run_id'] for r, _ in matches)})
        else:
            row, kind = matches[0]
            chosen.append(row['run_id'])
            task_rows[case['task']].append(row)
            if kind == 'user_accepted_supplementary':
                supplements.append(row['run_id'])
    complete = not missing and not conflicts
    task_cases = collections.defaultdict(list)
    for case in plan['cases']:
        task_cases[case['task']].append(case)
    task_scores, capabilities = [], collections.defaultdict(list)
    for task, cases in sorted(task_cases.items()):
        selected = task_rows[task]
        finished = len(selected) == len(cases)
        score = sum(r['outcome']['score'] for r in selected) / len(cases) if finished else None
        success = sum(r['outcome']['success'] for r in selected) / len(cases) if finished else None
        item = dict(task=task, capability=cases[0]['capability'], completed=len(selected),
                    expected=len(cases), score=score, success_rate=success,
                    run_ids=[r['run_id'] for r in selected])
        task_scores.append(item)
        capabilities[cases[0]['capability']].append(item)
    capability_scores = {}
    for capability, tasks in sorted(capabilities.items()):
        finished = all(t['score'] is not None for t in tasks)
        capability_scores[capability] = dict(expected_tasks=len(tasks),
            completed_tasks=sum(t['score'] is not None for t in tasks),
            score=sum(t['score'] for t in tasks) / len(tasks) if finished else None,
            success_rate=sum(t['success_rate'] for t in tasks) / len(tasks) if finished else None)
    return dict(plan_id=plan['plan_id'], label=plan['label'],
        status='conflict' if conflicts else 'complete' if complete else 'incomplete',
        expected=len(plan['cases']), completed=len(chosen),
        score=sum(c['score'] for c in capability_scores.values()) / len(capability_scores) if complete else None,
        success_rate=sum(c['success_rate'] for c in capability_scores.values()) / len(capability_scores) if complete else None,
        missing_cases=missing, conflicts=conflicts, excluded_records=excluded,
        selected_run_ids=chosen, supplementary_run_ids=supplements,
        evidence_basis='includes_user_accepted_supplementary' if supplements else 'native_only',
        task_scores=task_scores, capability_scores=capability_scores)


def evaluate_groups(source, document):
    plans = validate_plans(document)
    by_id = {r['run_id']: r for r in source['runs']}
    if len(by_id) != len(source['runs']):
        raise ValueError('Duplicate published result ID')
    supplements = {r['run_id'] for r in source.get('user_accepted_supplements', {}).get('source_packages', [])}
    return {g['group_id']: {pid: score_plan(g, by_id, plan, supplements) for pid, plan in plans.items()}
            for g in source['groups']}
