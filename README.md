# RoboDojo L3 results dashboard

[Open the dashboard](https://zefanw.github.io/robodojo-l3-dashboard/)

This independent repository hosts the dashboard on GitHub Pages. It contains the
frontend, accepted result catalog and small original evidence files. The former
ChatGPT-hosted site is retired and is no longer a publication target.

Original videos remain at their existing public Tsinghua cloud URLs. Moving the
dashboard does not change result identities, outcomes, costs or video bytes.
The browser reads this repository's static data and checks for updates every
60 seconds; it does not require a ChatGPT account or the retired site's APIs.

An intake service on the maintainer's Mac accepts and validates result bundles.
A separate file-only service checks for changed accepted data every 10 minutes,
projects the public snapshot, validates the mirrored evidence and pushes this
dashboard repository. GitHub Actions then publishes the snapshot. New uploads
wait while the Mac is offline; published pages remain available. Experiment code
is maintained separately in `ZefanW/robodojo-l3-lab`.

Experiment display names are shared maintainer settings, while hiding experiments
is a preference saved only in the current browser. Switching groups preserves the
task search; the case viewer also provides nearby group and run/scene selectors.

The original videos and evidence are unchanged. Formal results require native
terminal evidence, source/configuration and cost records, privacy validation,
and actual cloud readback. Supplementary review packages remain explicitly
separate. Incomplete coverage is not presented as a completed benchmark.

`scripts/project_static_dashboard.py` creates the static snapshot from a trusted
public catalog and existing local originals. It never downloads videos or writes
to a remote service. `scripts/validate_static_dashboard.py web` checks the
projection and original evidence hashes before every Pages deployment.

[Experiment protocol](docs/EXPERIMENT_PROTOCOL.md) documents task selection,
control limits, accounting and aggregation.

Original dashboard code is MIT; referenced upstream assets retain their licenses.
