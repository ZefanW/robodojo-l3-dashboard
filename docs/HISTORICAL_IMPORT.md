# Historical result import

`python -m robodojo_l3.historical_export --metadata INPUT.json --output BUNDLE`
converts an existing, completed `leaderboard-lite-v1` publication bundle into
`l3-public-v1`. It is an offline file operation: it does not run a model or a
simulator and does not upload anything. The normal explicit publisher then
validates, uploads and anonymously reads back every object before registration.

The metadata supplies explicit paths to the original publication manifest and
client lock, their expected hashes, the selected episode, the complete campaign
selection, its definition, the registered layout and pinned asset identities.
Paths are private inputs and do not appear in the public export. No outcome,
score, success flag or cost override is accepted from metadata. An existing
output directory is never overwritten.

The converter binds the original native result, completion event, final physical
ACK, layout and continuous trajectory control ranges. It verifies every original
artifact against the original publication manifest, and preserves the original
sanitized result, completion, ACKs, trajectory, costs, source lock and publication
manifest under `historical/`. The three original camera files are copied without
conversion. The original composite demonstration is not substituted for any
camera. Both the new projections and the original evidence pass the public
privacy and SHA checks.

Several model calls can precede one physical execution, for example when a
planner rejects a proposed motion. Such calls remain distinct decisions, but the
physical controls belong only to the final call of that policy turn. A historical
timeline that repeats the same control span on each call must not be summed.
Observation-only `defer_llm` events and an automatic budget-stop `give_up` event
retain their controls with `decision_index: null`; they are not model decisions.
Original paid attempts, actual response counts and physical controls remain
separate. Unknown usage or response counts remain null, with a known token lower
bound, rather than being replaced with zero.

The authorized medium campaign is organized into these four rounds:

| Round | Seed | Tasks without a random variant | Tasks with a random variant |
| --- | --- | --- | --- |
| 1 | 0 | standard, scene 0 | random, scene 0 |
| 2 | 0 | standard, scene 1 | standard, scene 0 |
| 3 | 0 | standard, scene 2 | random, scene 1 |
| 4 | 0 | standard, scene 3 | standard, scene 1 |

Scene ordinals are local to each variant. For round `r`, tasks without a random
variant use scene `r - 1`; tasks with a random variant alternate random/standard
and use scene `floor((r - 1) / 2)`. Round membership therefore cannot be inferred
from the episode's scene ordinal alone.

Each round contains 42 task families. Episode evidence keeps its original run,
variant and layout identity. Scores use the current five-capability reduction;
the dashboard reports each completed round and the sample variance across
completed round scores and success rates. The variance concerns these different
scene/variant configurations, not repeated identical-condition trials. Partial
rounds do not enter the completed-round variance.

The [experiment protocol](EXPERIMENT_PROTOCOL.md) defines the round rule. The
versioned [medium-cap20-rounds4-v2 round selection](../registry/round-selections/medium-cap20-rounds4-v2.json) records the exact 42
episodes in each round. New imports use `medium-cap20-evidence216-v1` to identify
the full historical evidence library; the library's 216 episodes are not the
scoring denominator. The round selection chooses 168 of them. Previously
registered evidence remains immutable, including its original embedded
selection. The explicit round selection can combine eligible old and new
records only when their source report and common harness identities match.
Changing a display schedule does not rewrite a native episode or its cloud
registration. The 23 manifests registered before the schedule correction retain
their original bytes and hashes; all 23 belong to the unchanged first round.

This is an explicitly declared historical campaign, not a claim that every
episode used identical runtime code. Two round-1 outcomes reuse original
persistent executions whose complete planned and executed EEF spans were already
at most 20 controls. Their original policy, protocol and reuse explanation remain
visible. The import rejects reuse when any original planned or executed EEF span
would have changed under cap20.

All historical entries record Codex CLI **0.153.4**. The 166 cap20 executions have
an original source-bound client lock identifying executable SHA256
`b973d440acac501fd2594a43e7ca9ce41e0a65b9dfb28d0d7a7837c99e1261e3`.
The two reused originals have a version record but no captured executed-binary
SHA; their unknown provenance is explicit. A current executable hash must never
be substituted for a missing historical one. New reproductions still use the
fixed-version installer and record their actual executable SHA.

Publication progress, verified cloud registration, a Git push and the deployed
dashboard are separate states. A `complete.json` receipt is written only after
the accepted manifest and immutable registration have passed anonymous SHA
readback. An unknown upload is reconciled by reading receipts; it is never a
reason to rerun the experiment or blindly repeat a POST.
