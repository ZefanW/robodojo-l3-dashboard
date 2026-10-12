# RoboDojo L3 results dashboard

[Open the dashboard](https://zefanw.github.io/robodojo-l3-dashboard/)

This public repository hosts a read-only, validated projection of RoboDojo L3
results. The runner source remains in a separate private repository. No model
credentials, private conversations, runtime settings or source Git history are
mirrored here. Original videos and evidence link to accepted cloud objects.

[Experiment protocol](docs/EXPERIMENT_PROTOCOL.md) defines task/variant/seed/scene
selection, fixed Codex CLI 0.153.4, native control limits, capability weighting,
recovery accounting and variance. Odd rounds use random variants where present;
even rounds use standard. Each variant advances its own scene sequence.

A trusted maintainer validates completed cloud receipts and updates this
repository automatically. The browser refreshes every minute. Publication is
normally checked every five minutes while the maintainer host is awake and
connected; native completion, cloud validation and deployed-site coverage are
separate milestones. Incomplete rounds are never presented as final full scores.

The deployment workflow verifies mirror bytes and the static file allowlist.
Full native provenance, privacy and aggregation validation happens before the
snapshot enters this repository. Public availability is not an official benchmark
submission or a claim of cross-simulator equivalence.

Original dashboard code is MIT; referenced upstream assets retain their licenses.
