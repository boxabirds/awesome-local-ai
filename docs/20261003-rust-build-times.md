# Rust build times: what costs what, and what to change

3 October 2026. Measured on this Mac (Apple M2, 8 cores, Rust 1.98.0 as pinned by `tools/dbench/rust-toolchain.toml`).
Every figure is a measurement from this session, not an estimate. The machine was under heavy load throughout
(load average 27 to 36 on 8 cores: another session's cargo builds and a Playwright suite), so the absolute numbers
are inflated and vary between runs; the ratios between variants held on every repeat and are what the
recommendations rest on.

## What Rust there is

| Crate | Lines | Packages in its lock | Own `target/` | Where it is built |
|---|---|---|---|---|
| `tools/dbench` | 17,451 | 187 | 7.9 GB | this Mac (native, and Linux via zig); release checks |
| `tools/power-collector` | 1,042 | 307 | 1.7 GB | release checks |
| `tools/vidi-gallery` | 4,034 | 89 | 1.1 GB | release checks |
| `tools/agent-sandbox` | 6,036 | 49 | 1.0 GB | **every bench node**, release + thin LTO, on every change to its directory (`sandbox.py`) |

Four separate crates, no workspace: 324 distinct packages, of which 173 are built by two or more crates and 34 by
all four (clap and its derive, serde and its derive, serde_json, syn, anyhow, libc, indexmap…). The release checks
(`dbench harness-release`, `checks.toml`) run `cargo test` in all four and clippy in two.

## What a build costs today (dbench)

| Build | Time |
|---|---|
| Clean debug build (separate target dir) | 25.5 s |
| Clean `cargo check` | 15.3 s |
| Warm no-op build | 0.9 s |
| Debug build after one source change | 2.7 s |
| `cargo check` after one source change | 4.7 s |
| `cargo test --no-run` after a change in `tests/server.rs` (2,007 lines) | 0.7 s |
| `cargo test --no-run` after a change in `src/` | 3.9 s |
| Clippy after one source change | 1.3 s |
| **Release build after one source change (thin LTO, as committed)** | **29.6 s, 36.4 s, 50.2 s, 71.4 s** (four runs) |
| Clean release build | 113.8 s (idle-ish), 66.7 s (second run) |

Where the clean debug build's time goes (`cargo build --timings`, 180 units, 135 s of unit time on 8 cores):
tokio 7.5 s, dbench itself 7.1 s, rustls 6.9 s, syn 4.9 s, clap_builder 4.6 s, SQLite's C build (libsqlite3-sys,
bundled) 4.2 s, regex-automata 4.1 s, ring's C build 4.0 s, toml_edit 4.0 s, zerocopy 3.5 s, regex-syntax 3.2 s.

**The inner loop is already fast.** A change to our code is back in a debug binary in under 3 s and in a test
binary in under 4 s; linking is inside those figures. The pain is elsewhere: the release profile, the sandbox
built on every node, and four crates each compiling the same dependencies.

## The experiments

Release profile variants, on a scratch copy of the committed tree (each: a full build, then one-line changes):

| `[profile.release]` | Full build | After one change (three runs) | Binary |
|---|---|---|---|
| `lto = "thin"`, `strip = true` (as committed) | 66.7 s | 71.4 s, 36.4 s, 50.2 s | 10.9 MB |
| `lto = "off"` | 126.7 s (contended) | 18.5 s, 41.8 s, 21.9 s | 11.4 MB |
| `lto = "off"`, `codegen-units = 16`, `incremental = true` | 61.4 s | **2.4 s, 3.3 s, 2.2 s** | 10.7 MB |
| the same with `opt-level = 2` | 62.2 s | 2.2 s, 3.2 s, 2.3 s | 10.4 MB |

Thin LTO re-optimises the whole program on every change: that is the 30 to 70 s. Without it, and with
incremental codegen on, a release rebuild costs what a debug rebuild costs. The binary is the same size.

The sandbox, as a node builds it (`cargo build --release --locked`, clean, the way `sandbox.py` runs it after a
change to `tools/agent-sandbox`):

| | Clean release |
|---|---|
| `lto = "thin"` (as committed) | 35.6 s |
| `lto = "off"` | 20.3 s |

Linkers: not a factor here. On macOS the toolchain links with Xcode's `ld` (ld-prime, `ld-27037`), and the whole
debug rebuild including the link is 2.7 s. On the Linux nodes (x86_64-unknown-linux-gnu) Rust has linked with
`rust-lld` by default since 1.90, and we pin 1.98, so the fast linker is already in use there
([Announcing Rust 1.90.0](https://blog.rust-lang.org/2025/09/18/Rust-1.90.0/),
[the pull request](https://github.com/rust-lang/rust/pull/140525)). Installing mold or lld would not change a
measured number on either platform.

`cargo check` versus `cargo build`: on this crate, check after a change (4.7 s) is not faster than build (2.7 s);
the bin crate's codegen is small. rust-analyzer uses check regardless. Nothing to change.

## Recommendations, in order of what they save

1. **Two release profiles for dbench: a fast one for every build here, a shipping one for the binaries that go
   to nodes.** `[profile.release]` loses `lto` and gains `codegen-units = 16`, `incremental = true`; a new
   `[profile.dist]` inherits release and keeps `lto = "thin"`, `strip = true`, `codegen-units = 1`, used by
   `build-linux.sh` and by whatever copies a binary to a node (`cargo build --profile dist`). Saves 30 to 70 s on
   every release rebuild here (measured 2 to 3 s instead). dbench is an I/O-bound control tool; the only CPU-bound
   code is the ingest, and the `dist` binary keeps full optimisation. Cost: an incremental release target dir is
   larger (the thin-LTO one was 424 MB clean; incremental caches roughly double a crate's own share).
2. **No LTO in agent-sandbox's release profile.** The nodes build it on every change to its directory and pay 35 s
   where 20 s would do; the sandbox is a thin wrapper around `sandbox-exec` and `bwrap` with nothing to optimise.
   One line in `tools/agent-sandbox/Cargo.toml`.
3. **A workspace for the three crates that are built here** (`tools/Cargo.toml` with members dbench, vidi-gallery,
   power-collector): one target dir, one build of each shared dependency, one `cargo test --workspace` for the
   release checks instead of three cold-ish ones. Saves disk (10.7 GB of three target dirs become one) and the
   duplicated dependency compiles. Two cautions: a workspace unifies feature sets, so a shared dependency may gain
   features another crate asked for (serde_json's `preserve_order` would apply to all three; harmless here);
   and shared packages pinned at different versions (base64 0.22 and 0.23, hashbrown at three versions, indexmap
   1 and 2, digest 0.10 and 0.11) still build twice until the crates agree. **agent-sandbox stays standalone**:
   the harness release copies `tools/agent-sandbox` alone to a node and builds it with `--locked`, and a workspace
   member without its root has no lock file.
4. **Trim the slow dependencies if a clean build ever matters** (it does on a toolchain bump, when every machine
   recompiles everything, and on a new machine): `regex` to `regex-lite` (regex-automata and regex-syntax are 7.3 s
   of the clean build; the ingest's patterns have no look-arounds and would need checking for Unicode classes),
   and `toml` with its parse-only feature set (toml_edit, 4 s). Not worth doing for the inner loop, which they do
   not touch.

Not recommended: sccache (a workspace removes the duplication it would hide; it adds a daemon on every machine);
mold or lld on macOS (the link is not the bottleneck and the default Linux linker is already lld);
`opt-level = 1` for dependencies in the dev profile (the inner loop is 2.7 s; the one measurement I took, 38 s
for a full build against 25.5 s without, was under contention and inconclusive); `panic = "abort"` or
`debug = 0` (small, and they change what a backtrace shows).

## What to re-measure after

`cargo build --timings` in `tools/dbench` for the clean picture; the one-change release rebuild (`touch
src/collect.rs; time cargo build --release`) for the day-to-day figure; on a node, the sandbox build time printed
by `sandbox.py` after the next change to its directory.

## As built (the same evening)

Approved and done: 1, 2 and 3; 4 left. One change to 3 on the way: **power-collector is not in the workspace.**
Its `tapo` dependency enables reqwest's aws-lc-rs TLS backend, so a workspace-wide build would have compiled
dbench's TLS a second time with it, plus aws-lc's cmake build; a dbench-only build was unaffected (0 aws-lc
packages) but `cargo test --workspace` would not have been. The workspace is dbench and vidi-gallery
(`tools/Cargo.toml`, which holds the profiles, the shared lock and the toolchain pin); agent-sandbox and
power-collector are excluded, each with its reason in that file, and keep their own locks and checks.
dbench's 187 dependency versions are exactly what they were before the move.

Measured after the change (load 5 to 17 on 8 cores, the other session still building):

| | Before | After |
|---|---|---|
| dbench release rebuild after one change | 30 to 71 s | **2.5 s, 1.7 s** |
| dbench full release build, fresh target | 67 to 114 s | 48.4 s |
| dbench `dist` build (what a node gets: thin LTO, stripped) | | 107.3 s, 9.3 MB |
| agent-sandbox clean release, as a node builds it | 35.6 s | 18.7 s |
| `cargo test --workspace` (dbench and vidi-gallery, one target) | | 41.6 s |
| Linux cross-build via zig, `dist` profile | | 93.3 s, stripped ELF |

The three old target directories (dbench 7.9 GB, vidi-gallery 1.1 GB) are deleted; the workspace builds into
`tools/target/`. `build-linux.sh` and the README name the `dist` profile and the new paths; the release check list
has one "rust tests (tools workspace)" entry in place of two, and dbench's own tests assert that name and the
pin's new location. The nodes rebuild the sandbox once (its `Cargo.toml` is in the source hash) at the next
harness release that carries it.

## Item 4, as built (5 October 2026)

Approved and done: dbench uses `regex-lite` in place of `regex` (the patterns use ASCII words, `\b`, `\d` and
`(?i)` only; the ingest goldens hold the output equal to the Python parsers', and every dbench test passes) and
`toml` with its `parse` feature only. Out of the lock: `regex`, `regex-automata`, `regex-syntax`, `aho-corasick`,
`toml_write`; in: `regex-lite`. `toml_edit` stays, as the parser `toml` reads with. From the 3 October timings those
removed crates were 7.3 s of the clean build's unit time (regex-automata 4.1 s, regex-syntax 3.2 s; aho-corasick
and toml_write were small).

**Not re-measured cleanly.** The one clean build timed after the trim took 68.8 s, with the load at 4 to 15 on 8
cores: the other session was building and running tests, and the system was indexing. That figure is not
comparable with the 25.5 s of 3 October and is not evidence either way; the saving is the removed crates' unit
time above, to be confirmed on a quiet machine with `cargo build --timings` in a fresh target directory.
