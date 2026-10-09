# SLOs for dbench: planning

**Status:** open question (9 Oct 2026). Raised by the owner: "define what good looks like and identify how to measure it", with the
monitor treated as an ad-hoc SLO v1. Nothing is built. No baseline has been computed, so every objective below is a strawman, not a
finding.
**Needs before it is a candidate:** the three decisions at the end, and a baseline of each SLI over the existing history.

## Why the monitor is not yet an SLO

`ops/monitor/monitor.py` is detection. At the time of writing its log held 2,180 events in about 40 kinds, all at the level of a cause
(a machine idle, a job restarted, a story with no progress). Nothing in it says whether the benchmark, taken as a whole, is doing its job.
It can be quiet while results are poor, or loud while they are fine. An SLO states the outcome; the monitor's detections then become the
diagnosis attached to a breach.

## Best practice, in short

From the Google SRE Workbook as relayed by secondary sources. The official pages (sre.google/workbook/implementing-slos and
sre.google/workbook/alerting-on-slos) could not be opened, and the secondary sources disagree on the exact burn-rate windows, so
check those against the originals before copying any numbers.

- Define SLIs from what the consumer receives, not from worker health (CPU, queue depth, job duration are diagnostics, usually poor SLOs).
- Pick three to five. Give each an objective over a rolling window.
- The written error-budget policy (what happens when the budget is spent) matters more than the number.
- Alert on budget burn, not on every cause. Multi-window, multi-burn-rate alerting needs both a long window (it is sustained) and a short
  one (it is still happening).
- For batch work the consumer-facing SLIs are freshness, correctness, coverage and throughput. Do not count job success. The unit counted
  is the promise (a story, a run), never retries, worker executions or restarts. Define the expected work outside the pipeline, so a
  configuration error cannot shrink both numerator and denominator.
- **Our fit:** volume is low and a story takes 30 minutes to hours, so the usual 1 h / 5 min windows would fire on one failure. Use a
  28-day window counted in whole stories and runs, and state the budget as a count ("2 spoiled runs per window").

## The promise

Every compute-hour ends as a complete, trustworthy, visible result, on a machine kept busy.

## Candidate SLIs

The event counts are all-time detection counts from the monitor log, not rates.

| SLI (what is counted) | Strawman objective | Measured from | Monitor today |
|---|---|---|---|
| 1 Yield: runs that end valid with a score of record ÷ runs started (owner cancels excluded) | ≥ 90% per 28 d | dbench job history, `finalize.json`, invalid marks | `run_ended_early` 22, `run_not_scored` 6, `job_failed` 25 |
| 2 Wasted compute: story-hours in runs later spoiled by our infrastructure ÷ all story-hours | ≤ 5% | job history, `cancel --reason` | none |
| 3 Completeness: finished stories with time split, passed accounting check, conversation profile and score under the current suite ÷ finished stories | ≥ 98% within 24 h | benchmarker faults feed, warehouse | `conversation_missing` 141, `accounting_failed` 12 |
| 4 Utilisation: machine-hours with work queued that were running ÷ machine-hours with work queued (holds and dual-boot windows excluded) | ≥ 95% | one sample per monitor tick | `machine_idle` 16, `queue_not_starting` 8 |
| 5 Freshness: story end to visible in the app | 99% within 30 min | story end time vs collector ingest | not measured |
| 6 Durability: last good backup age on both repositories; restore drill | ≤ 36 h; a drill every 90 d | backup `status.json` | `backup_stale` |
| Guardrail: main is green and a release passes all checks | every release | release checks, CI | `ci_failed` 8 |

## Proposed policy

Two tiers, with the monitor's cause detections attached as the diagnosis.

1. The projected budget would run out within 7 days: log it and notify.
2. The budget is spent: queue no new series on the affected machine or harness until the cause is fixed test-first.

Only imminent threats stay urgent (an unreachable machine, a stalled story).

## Constraints

- Status lives in `ops/` and the monitor, never in the benchmarker (the repo rule: the app shows results, not faults).
- SLI 2 needs every cancel to carry a reason that separates our infrastructure from the owner's choice. `dbench cancel --reason` exists;
  how consistently it has been used has not been checked.
- An SLI is cross-checked against something independent, such as the benchmarker's own counts, before its figure is trusted.

## Decisions waiting for the owner

1. **The SLI set.** Problem: no definition of "good", so a spoiled run and a routine restart look the same in the monitor.
   Recommended: adopt the promise and SLIs 1 to 4 now, add 5 once freshness is timestamped, fold in 6 and the guardrail as they are.
   Actions: approve or trim the list (needs the owner); write `ops/slo/` with the definitions and exclusions in plain words (no approval).
2. **Baseline before targets.** Problem: targets picked now would be guesses. Recommended: compute each SLI over the existing history,
   cross-check it, then set objectives. Actions: build the read-only report (no approval); set the objectives after seeing it (needs the owner).
3. **The budget policy.** Problem: an SLO with no consequence is decoration. Recommended: the two tiers above. Actions: approve or change
   the freeze rule (needs the owner).

## Sources

- [Multi-window multi-burn-rate alerting](https://oneuptime.com/blog/post/2026-02-17-how-to-set-up-multi-window-multi-burn-rate-alerting-for-slos-on-google-cloud/markdown)
- [Burn rate alerts](https://oneuptime.com/docs/slo/burn-rate-alerts)
- [Outcome-based SLOs for batch jobs and async pipelines](https://oneuptime.com/blog/post/2026-08-29-how-to-write-outcome-based-slos-for-batch-jobs-queues-and-async-pipelines/markdown)
- [Freshness SLOs](https://oneuptime.com/blog/post/2026-01-30-freshness-slos/markdown)
- [Designing batch pipelines around SLAs and SLOs](https://dev.to/beefedai/designing-batch-data-pipelines-around-slas-and-slos-3ekf)
- [Google Cloud: data processing SLI metrics](https://docs.cloud.google.com/stackdriver/docs/solutions/slo-monitoring/sli-metrics/data-proc-metrics)

**Last checked:** 9 Oct 2026. **Recheck when:** the owner answers the decisions, or the baseline report exists.
