# Unit coverage contract

The CI unit matrix is the only place that executes the unit-test corpus. Each shard records the standard Vitest V8 coverage map once. `BODYCAST_INCLUDE_MODULE_COVERAGE=1` adds the Stage 1C roots from `tests/refactor-comparator/module-coverage-v1.json` to the established include scope; both the global and module checks consume the resulting merged `coverage/coverage-summary.json`.

The coverage merge job does not execute tests. Vitest merges the shard blobs, then `scripts/refactor/run-module-coverage-gate.mjs` checks the existing global floors (lines 85%, functions 85%, statements 85%, branches 80%) over the original include scope and the frozen per-file floors over Stage 1C roots. New executable module files must meet 85/85/85/80. A missing summary, missing total metric, missing expected file, or missing module measurement fails closed.

The source inventory remains bound to `baselineSha`. The existing frozen per-file percentages are retained unchanged as policy floors. They were originally measured by the previous AST-aware related-test method; they are not claimed to be same-method V8 baseline counters. The changed V8 shard method must prove on the first exact-SHA CI run that the complete merged report meets those existing floors. New files use the fixed floors above. Coverage-excluded compatibility barrels, DTO-only files, and test helpers remain listed with reasons and cannot change without an explicit coverage review. Coverage scope and threshold constants are shared by Vitest and the gate in `scripts/refactor/coverage-scopes.mjs` and the manifest, rather than copied into CI commands.

## Stage 1C optimization ledger

| Checkpoint | Evidence |
| --- | --- |
| Before, `a5a9c949089d56002bd9f9cac3a9deb30c058900` | CI run [45700909358](https://github.com/krustallik/body-model/actions/runs/45700909358). The per-file gate took 6m25s (21:09:32–21:15:58 UTC) and executed the related 1,582 test cases twice (3,164 redundant case executions; each Vitest report was about 3m11s). The preceding shard merge took about 2s and already reported the full unit suite. |
| Method change calibration | Exact baseline `5194fcd00544f7ca94fca4fbac039f647cb26503` was inspected. Its successful CI artifacts contain only unit-shard reports and no BodyCast module coverage, so they cannot supply V8 counters for these roots. A local two-pass calibration was attempted in Docker; Windows-mounted Git/shell fixture behavior and Git-heavy test timeouts prevented a valid complete baseline result. No same-method historical V8 equivalence is claimed. The frozen numeric percentage floors were not changed. |
| After | Pending the first successful exact-SHA CI run of this contract. Record the candidate SHA, Unit coverage merge duration, merge step duration, and proof that all expected global/module paths were present and passed the unchanged floors. |

The first exact-SHA CI run is the acceptance gate for this method update. It must pass the complete unit shards without test exclusions, merge their uploaded reports, and pass both global and per-file floors from the single merged summary. A local calibration exception is not carried into CI. If any unchanged floor fails or a report is incomplete, stop and investigate; do not lower or replace floors to obtain a pass.

The next queued task is to revalidate Phase 1A–1C against current `main` and then continue the owner-approved architecture plan. It begins only after the current CI optimization and production-release goal is complete.

The method changed from a separate AST-aware `vitest related` run to the existing unit-shard V8 report. That is an intentional Stage 1C measurement-method update. Review the first merged summary against the frozen per-file floors and record the exact candidate SHA and CI step timings here; do not relax floors to make the gate pass.
