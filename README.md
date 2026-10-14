# RoboDojo L3 results dashboard

[Open the live dashboard](https://robodojo-live-results.glassy-quail-2213.chatgpt.site/)

This repository preserves historical published files and the original GitHub Pages
entry point, which redirects to the live dashboard. New result data does not
require a Git commit, repository push, or website redeployment.

The fixed frontend reads a cloud data catalog and refreshes every 60 seconds.
A trusted intake service checks the upload inbox, validates each result bundle,
uploads its original videos and evidence as separate immutable cloud objects,
and updates the catalog. The intake currently runs on the maintainer's Mac; new
uploads wait while that host is offline. Already published results remain online.

The original videos and evidence are unchanged. Formal results require native
terminal evidence, source/configuration and cost records, privacy validation,
and actual cloud readback. Supplementary review packages remain explicitly
separate. Incomplete coverage is not presented as a completed benchmark.

[Experiment protocol](docs/EXPERIMENT_PROTOCOL.md) documents task selection,
control limits, accounting and aggregation. Archived files in this repository
are historical snapshots, not the current live result directory.

Original dashboard code is MIT; referenced upstream assets retain their licenses.
