# Story 21: the lake compared with the repository (TC-104, task 21.36)

`bench-lake <STATE_DIR> compare-git <REPO> --report story-21-parity-lake-reads.json`, run on 3 Nov 2026 on the host
that holds the lake, against `origin/main` at `4c18ce2f6`. The collector was running. Node names in the report are
neutral aliases (node-a: the RTX 4090 machine, node-c: the M5 Max, node-d: the Strix Halo), as in the fixture.

**Comparison A (the library against a direct read of each lake file): 0 defects.**

**Comparison B (the lake against the repository): 72 runs compared, 143 differences, every one of the same kind:
a file the lake has and the repository does not.** No file differs between the two, and no file the repository
holds is missing from the lake.

| file the repository lacks | count | why |
|---|---|---|
| `collection.json` | 70 | the collector's note; written in the lake only, never tracked |
| `progress.json` | 70 | written in the lake only; the repository tracks none |
| `finalize.json`, `rescore/vidi-v2.0-pre2/rescore.json`, `rescore/vidi-v2.0-pre2/stories/03/accept-summary.json` | 3 | one run, mlxserve-pi `v2-r4` on node-c: made there on 15 Oct and collected, never in any commit |

Four of the 143 are in two runs whose lake note says incomplete: strata-pi `v2-strata0141-r2` on node-a (a resumed job
still to run) and strata-pi `v2-stratastrix-r1` on node-d. Task 5.32 (every run complete) is still open, so these two
may gain files.

**Not compared (6):** runs the repository does not track: one dry run, two smoke runs and the three DGX Spark runs
`v2-iq4xs-r1` to `r3`. Untracked runs are neither compared nor counted.

**The hand-built reference runs** `todoodle/opus-5.5/run-1` and `run-2`, which the task expected to exist only in the
repository, are in the lake (`state/reference/todoodle/opus-5.5/`). They were compared and nothing differs; their
`run-status.json` is byte-identical to `origin/main`'s.

What it means for story 16: the lake holds everything the repository holds for every tracked run, byte for byte, plus
the collector's own notes and one run's later records. Nothing has to be copied from the repository into the lake.

On 2 Nov the same comparison, run through the test TC-104, counted 137 differences over 72 runs; that report was not
kept, so which six are new today is not known. That run took 54 minutes as a debug build; this one took 3 minutes 43
seconds as a release build.
