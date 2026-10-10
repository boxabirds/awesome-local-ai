# The benchmarker and the review server, kept running

Two services run on the Mac that shows the results. Each had been started by hand, so each vanished at a restart or a crash. On 10 Oct 2026
the Judge button stopped working because nothing was listening on the review server's port.

| Service | Label | What | Port |
|---|---|---|---|
| benchmarker | `com.awesome-local-ai.benchmarker` | `bun server/main.ts` in `tools/benchmarker`: the app | 7760 |
| gallery | `com.awesome-local-ai.gallery` | `tools/vidi-gallery`'s release build: the story review page behind the Judge button | 7800 |

Both are LaunchAgents with `KeepAlive`: launchd starts them at login and restarts them when they exit, after 10 seconds. The benchmarker is
given the review server's address for its Judge link, from one constant in `install.sh`.

## Install

    cd tools/benchmarker && bun run build               # what the benchmarker serves
    cd tools/vidi-gallery && cargo build --release      # the review server
    ops/services/install.sh all                         # or: benchmarker | gallery
    ops/services/install.sh all --print                 # show the plists without installing

The plists are generated for this user and written to `~/Library/LaunchAgents`; nothing machine-specific is stored in the repository. The
installer refuses, and says why, when a build is missing or when a copy started by hand holds the port (stop it first). Logs go to
`ops/service-state/` (git-ignored).

## After a code change

    cd tools/benchmarker && bun run build
    launchctl kickstart -k gui/$(id -u)/com.awesome-local-ai.benchmarker

The page is partly empty for the first minute or two after a start while it reads the run records and asks `dbench` for the live jobs.
The benchmarker needs `dbench` and `git` on its PATH: the installer puts their directories there, found at install time, because launchd
starts with a bare PATH.

## Stop

    launchctl bootout gui/$(id -u)/com.awesome-local-ai.benchmarker

## Tests

`tests/services-test.sh` (part of `tests/run-tests.sh`): the plists are valid and kept alive, the ports agree, `dbench` and `git` are on the
benchmarker's PATH, printing installs nothing, and a reinstall waits for launchd to finish stopping the old job (a `bootstrap` straight after
a `bootout` failed with an I/O error, which left the service down).
