# Native runs across explicit rounds

`l3-native-round-selection-v1` is a derived, SHA-pinned round definition for
new native campaigns. It is separate from the historical-import
`l3-round-selection-v1` contract, whose report binding remains unchanged.

The definition binds the reviewed finite round-plan SHA, every original
selection/protocol ID pair, and each round's exact task, variant, seed, scene
and capability membership. A selected episode can belong to only one round.
It never renames a run or edits its manifest, outcome, trace or source lock.

The native harness digest excludes only selection and protocol ID labels.
It still binds the protocol profile, per-EEF control cap, decision bound,
model and effort, actual Codex executable and policy, effective non-simulator
parameters and shared assets. Unknown harness formats and historical imports
cannot use this contract. Original protocol IDs, runtime/source identities and
simulator versions remain visible in the group's execution breakdown.

Complete, unambiguous rounds contribute equally to the mean and sample
variance (ddof 1). A partial or duplicate-attempt round cannot contribute to
variance or make a campaign complete. The plan SHA is an audit reference to
the reviewed plan, not evidence of an episode having run or been published.

For the authorized four-round low schedule, ordinary tasks use scene 0/1/2/3.
Generalization tasks use random scene 0, standard scene 0, random scene 1,
standard scene 1. Every case uses seed 0. Existing round-one evidence is
retained byte-for-byte; only the derived index gains the new membership.
