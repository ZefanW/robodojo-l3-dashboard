# Experiment selection and round statistics

## Fixed first-round and P50_111 scores

All experiment tabs use the same [frozen evaluation plan](../web/evaluation-plans.json).
These scores are computed independently of the campaign's overall completion
and of the round currently selected in the viewer. New accepted data triggers
the usual publication pipeline; each Pages build recomputes both evaluations.
This is automatic publication of existing outcomes, not permission to run
additional experiments.

- **First round (42):** seed 0; the 30 non-Generalization tasks use standard
  scene 0, and the 12 Generalization tasks use random scene 0.
- **P50_111:** the frozen 23 selected task families each contribute four
  samples; the other 19 contribute their first-round sample. Selected tasks
  among the 30 use standard scenes 0–3. Selected tasks among the 12 use
  random/standard scenes 0–1, in the order random0, standard0, random1,
  standard1. These are exactly their first four rounds above, not any four
  completed scenes. The first round is a subset of P50_111.

The 23-task selection was based on the theoretical highest non-full score
being at most 50/100, and at least one of LOW/MEDIUM observing both full and
non-full scores in the eight-round development data. This task list is now
fixed: new results do not reselect tasks or change their repetition counts.

For either evaluation, average the selected samples **within each task**, then
average tasks within each capability, then average the five capabilities
equally. Repeating a task four times does not quadruple its aggregate weight.
SR uses the same hierarchy with the original success flags. Scores and SR in
the API remain on the 0–1 scale; the dashboard displays percentages.

Coverage is checked against exact task/variant/seed/scene tuples from each
group's selected `run_ids`. Later scenes, different seeds, other experiment
groups and preserved-unselected records cannot fill gaps. Multiple selected
attempts for a required tuple block its score; neither the best nor the latest
attempt is silently selected. Missing or ambiguous coverage yields `null`, not
a partial mean or zero. Extra records outside the plan have no effect.

The two existing, explicitly user-accepted supplementary imitate results keep
their disclosed evidence status when included: they are not promoted to native
validated results. Evaluation output lists the supplementary run IDs and
evidence basis. Other incomplete or unaccepted evidence cannot fill a slot.

This frozen devset is an analysis/evaluation convention, not a claim of the
upstream benchmark leaderboard's identical protocol.

## Historical round selection

A round contains one episode for each of the 42 task families: 30 families
without a random variant and 12 Generalization families with both variants.
The selected seed is 0. A scene is the zero-based ordinal after numerically
sorting the layouts **for that task and variant**. Its exact original layout
SHA remains in the episode evidence.

For round `r`, families without a random variant use standard scene `r - 1`.
Families with a random variant use random in odd rounds and standard in even
rounds; their scene ordinal is `floor((r - 1) / 2)`. Thus switching variant does
not skip a scene within either variant.

| Round | Seed | 30 families without random | 12 families with random | Current import |
| --- | --- | --- | --- | --- |
| 1 | 0 | standard, scene 0 | random, scene 0 | selected |
| 2 | 0 | standard, scene 1 | standard, scene 0 | selected |
| 3 | 0 | standard, scene 2 | random, scene 1 | selected |
| 4 | 0 | standard, scene 3 | standard, scene 1 | selected |
| 5 | 0 | standard, scene 4 | random, scene 2 | example only |
| 6 | 0 | standard, scene 5 | standard, scene 2 | example only |

The current historical medium import is limited to rounds 1–4: **168 existing
episodes**, with no new simulations, seeds or model calls. Rows 5–6 explain the
rule and do not authorize or schedule additional experiments.

## Harness and provenance

The selected historical harness is `persistent-cap20`, `gpt-6-astra`, medium
effort, with Codex CLI fixed at **0.153.4**. A new reproduction must install that
exact version and record the actual executable SHA; a version label alone is
insufficient. The original 166 cap20 runs bind the executable SHA256
`b973d440acac501fd2594a43e7ca9ce41e0a65b9dfb28d0d7a7837c99e1261e3`.
The two reused originals record version 0.153.4 but lack a captured binary SHA;
that field remains unknown, with the original policy and reuse proof visible.

Cap20 executes the first at most 20 native controls of each EEF plan. It is not
a limit of 20 model decisions or 20 total controls across both arms. Each
episode has at most 100 model decisions. Original observation-only controls,
budget-stop events, rejected model replies, paid requests and actual model
responses keep their distinct meanings. Unknown cost/response values stay
unknown rather than becoming zero. See [historical import](HISTORICAL_IMPORT.md).

The same card may display an explicitly declared historical campaign with
audited result reuse, while preserving actual simulator versions, original
runtime protocols and policy/client source differences as comparison strata.
This does not assert that all original executions had identical software.
Different efforts or unrelated harness sources do not share a card.

## Immutable evidence and explicit round membership

The checked-in [medium round selection](../registry/round-selections/medium-cap20-rounds4-v2.json)
lists every selected task, variant, seed, scene and capability. Its identity is
`medium-cap20-rounds4-v2`. It is a derived overlay, not a replacement manifest.
It binds the original report SHA and common harness SHA, including the model,
effort, effective parameters, policy/client sources and common assets.

New imports use `medium-cap20-evidence216-v1` for the 216-record original
evidence library. Already accepted records retain the original
`medium-cap20-alternating4-v1` identity and exact manifest bytes. Both can be
selected by the same reviewed overlay. Only its 168 explicit members contribute
to this campaign. Any other retained historical record remains inspectable
but does not affect selected coverage, Score, SR or variance. No run is renamed,
no scene is relabeled and no native result, action, layout SHA or cost is edited.

Apply the overlay when building a derived snapshot:

```sh
l3-lab build-site ACCEPTED_MANIFESTS... --out NEW_SITE \
  --round-selection registry/round-selections/medium-cap20-rounds4-v2.json
l3-lab validate-site NEW_SITE
```

The v2 index embeds the overlay and its digest. Later automatic builds preserve
that reviewed membership; upload order cannot change round assignment. The
validator recomputes membership and statistics from accepted episode evidence.
A local converted bundle is prepared evidence, not proof of cloud publication.
Only validated upload and anonymous SHA readback permit accepted registration.

## Scores and variation

Each round averages within variants, then task families, then equally across
its five capabilities. The campaign score and SR are equal-weight means of
complete, unambiguous rounds. Partial rounds show their coverage and do not
enter that mean or variance. Final campaign totals require all 168 selected
episodes. Multiple attempts for an episode are not silently resolved by taking
the best or latest result; the affected round remains ambiguous.

For complete round scores `x`, sample variance is
`sum((x - mean(x))^2) / (n - 1)`. The dashboard shows Score and SR variance in
squared percentage points (`pp²`), standard deviation in percentage points,
and the number of complete rounds. Fewer than two complete rounds gives null,
not zero. These values describe variation across the listed scene and variant
selections; they are not repeated-seed variance under an identical condition.
