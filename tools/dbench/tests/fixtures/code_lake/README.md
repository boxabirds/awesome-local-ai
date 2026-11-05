Fixture lake for `dbench code-import` (tests/lake_code.rs, TC-1A to TC-1D).

Copied on 5 Nov 2026 from the real lake (`state/collected/gruntus/...`): each run's `workspace.bundle` and `run.json`
as they are, and its `metrics.json` cut to the story commits (`stories.<n>.commit`), the only field the import reads.

- mlx-serve `v2-r4` (3 stories) and gufo-fork `v2-q36fork-b-r2` (11 stories): every story commit is in the bundle.
- strata `strata-s2on-r1` (1 story): the bundle holds "snapshot after the story ended" commits, not the commit its
  record names, as in 23 of the lake's 374 bundles.
