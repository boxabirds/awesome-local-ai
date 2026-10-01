# agent-sandbox

Runs a benchmark's coding agent with the least access it needs. One policy, two enforcers: Seatbelt (`sandbox-exec`) on macOS, bubblewrap on Linux. Everything is denied unless the policy names it.

It replaces a policy of "allow everything, deny a list of paths". Every leak under that policy was a path nobody had listed: a file share with a clone of the repository, `/tmp` leftovers of other runs, a `node_modules` in the home directory that gave a build a package it never declared. A list of what is allowed has no such gaps: a path nobody thought of is closed.

**Status: not wired into the harness.** Proven on macOS (below). The Linux side is built and unit-tested but has never run on a Linux kernel; see "Linux: what is not proven".

## Use

```sh
agent-sandbox run --own-dir <dir> [--ro <path>]… [--preset <name>]… [--allow-host <host[:port]>]… \
                  [--host-port <port>]… [--proxy-log <file>] -- <command…>
agent-sandbox print  <the same options> -- <command…>   # the Seatbelt profile, or the bwrap argv one per line
agent-sandbox proxy  [--preset <name>]… [--allow <host[:port]>]… [--log <file>] [--port <n>]
```

`run` exits with the command's status (128 + N if signal N killed it; 126 if the sandbox could not be set up). It passes SIGTERM, SIGINT and SIGHUP on to the command.

## The policy

| | Allowed | Why |
|---|---|---|
| **Write** | `--own-dir` and nothing else | the run's workspace, `tmp/` and `agent-home/` live in it |
| **Read and execute** | the system's programs and libraries; each `--ro` path; the install of the command itself and of `node`, as found on `PATH` | the toolchain |
| **Stat only** | the directories above those | tools resolve real paths by stat-ing every ancestor; nothing beside the allowed path can be listed or read |
| **Network** | loopback; outbound only through the allow-listing proxy, to hosts named with `--preset` or `--allow-host` | the model server and the agent's own dev servers are on loopback; npm needs its registry |
| **Everything else** | denied | the home directory, the repository, other runs, `/tmp`, the per-user temp directory, `node_modules` and `package.json` above the run, every other host |

Rules that hold on both platforms (tests/policy.rs):

- Paths are resolved first (`/tmp` → `/private/tmp`), since the kernel checks the resolved path. A symlink on the way to an allowed path stays resolvable, as a link, and opens nothing.
- `--own-dir` may not be `/`, the home directory or anything above it.
- A `--ro` path may not contain `--own-dir` (it would show the runs beside it) or the home directory. One that does not exist is reported and stays closed, so it cannot appear later and be read. One inside `--own-dir` is dropped: own_dir is writable and wins.
- A tool found on `PATH` brings its install root when it sits in a `bin` directory (`…/node/v24/bin/node` → `…/node/v24`, which holds npm and globally installed clients). If that root is the home directory or lies above the run, only the one resolved file is opened.

### macOS (Seatbelt)

`(deny default)`, then these groups. `agent-sandbox print` shows the profile with the reason above each group.

| Group | Rules | Why |
|---|---|---|
| Processes | `process-fork`; `process-exec` only in `/usr`, `/bin`, `/System`, the toolchain and own_dir; `signal (target same-sandbox)`; `(deny process-info* (target others))` | children and tools must run; signals stay inside; without the explicit deny, `lsof` listed every process of the user and the paths of its open files |
| Kernel facts | `sysctl-read` | node aborts at start without it. Allowed as a whole: read-only kernel values, no file contents. A list of names measured on one macOS release would break on the next |
| System files | read: `/` itself, `/usr`, `/bin`, `/System`, `/private/var/select`, `/private/etc/hosts`, `/private/etc/ssl`, `/private/etc/localtime`, `/private/var/db/timezone` | dyld and system libraries; `sh`; `localhost`; CA certificates; local time |
| Devices | read `/dev/null`, `zero`, `random`, `urandom`; write `/dev/null`; `/dev/fd` | no data in them; `/dev/stdout` and process substitution |
| Services | `mach-lookup` of `com.apple.system.opendirectoryd.libinfo` only | account lookup; node's `os.userInfo()` throws without it |
| Chromium | `mach-register` and `mach-lookup` of `org.chromium.Chromium.MachPortRendezvousServer.<pid>`; `iokit-open` of `RootDomainUserClient` | its processes find each other through that port; it crashes at start without either |
| Network | `network-outbound (remote ip "localhost:*")`, inbound and bind on `localhost:*` | loopback only |
| Ancestors | `file-read-metadata` on each directory above an allowed path | path resolution |
| Toolchain | `file-read* process-exec` per `--ro` and discovered path | |
| Own directory | `file-read* file-write*`, last | SBPL applies the last matching rule |

Deliberately closed, with what that buys:

- **`com.apple.bsd.dirhelper`**: with it denied, `mktemp` and `confstr` cannot find the per-user temp directory and fall back to `TMPDIR`, which is inside own_dir. No rule for the shared temp directory is needed at all.
- **The name resolver (mDNSResponder)**: no DNS from inside. The proxy resolves names, so DNS is not a way out either.
- **`/usr/bin/git`'s stub**: it finds the real git through xcrun, which needs the per-user temp directory, Xcode's licence state and more. Instead the developer directory's `usr` is allowed read-only and its `bin` is put on `PATH` just ahead of `/usr/bin`, so the real `git` (and `python3`) run directly and nothing the caller had ahead of `/usr/bin` is shadowed.
- **`/Library`, `/Applications`, `/opt`, `/sbin`**, the user's `Library`: not needed by the workload. A Homebrew-installed tool needs `--ro /opt/homebrew`.

### Linux (bubblewrap)

| Part | Arguments | Why |
|---|---|---|
| Empty root | `--tmpfs /`, made read-only at the end (`--remount-ro /`) | what is not bound does not exist |
| Namespaces | `--unshare-pid --unshare-ipc --unshare-uts --hostname agent-sandbox --new-session --die-with-parent`, and `--unshare-net` | only its own processes are visible; the machine's name is not; the sandbox dies with its parent |
| System | `--ro-bind` of `/usr`; `/bin`, `/sbin`, `/lib*` recreated as symlinks or bound | programs and libraries |
| `/etc` | only: `ld.so.cache`, `ld.so.conf(.d)`, `passwd`, `group`, `nsswitch.conf`, `hosts`, `ssl`, `ca-certificates`, `pki`, `localtime`, `alternatives`, `fonts` | linker, account lookup, `localhost`, CA certificates, time zone, Debian's tool links, Chromium's fonts. No `resolv.conf`: there is no DNS |
| Kernel | `--proc /proc --dev /dev` | a private `/proc` and a minimal `/dev` |
| Toolchain | `--ro-bind` per `--ro` and discovered path; `--symlink` for links on the way | |
| Temp | `--bind <own>/tmp /tmp` and `/var/tmp` | a hard-coded `/tmp` path works, privately |
| Own directory | `--bind <own> <own>`, the last mount | a later mount covers an earlier one, and own_dir may be under `/tmp` |

### Network

Deny by default. The sandboxed command reaches loopback and nothing else; `--preset` and `--allow-host` start an allow-listing proxy on loopback and set `HTTPS_PROXY`, `HTTP_PROXY` (and lower-case forms), `NO_PROXY=localhost,127.0.0.1` and `NODE_USE_ENV_PROXY=1` for the command.

The proxy (src/proxy.rs) tunnels `CONNECT host:port` when the host is an allowed name or a subdomain of one, on port 443 unless the rule names another. Everything else gets 403: other hosts, look-alikes (`registry.npmjs.org.attacker.com`), other ports, addresses that were not listed exactly, and every request that is not CONNECT. Each request is logged as a JSON line (`t`, `request`, `allowed`), the same shape as the judge's proxy in `benchmarks/spec-bench/harness/egress_proxy.py`.

Presets are data: `presets.toml`. `npm` (registry.npmjs.org), `playwright` (its two browser CDNs), `claude` (api.anthropic.com). No preset, alone or combined, reaches github.com or its content hosts (tests/presets.rs).

**Linux.** `--unshare-net` gives the sandbox an empty network with its own loopback, which is exactly "nothing else", but the model server and the proxy listen on the host's loopback and are then out of reach. bubblewrap has no port forwarding. Three options:

| Option | Verdict |
|---|---|
| Leave the network namespace shared | enforces nothing; kept only as `--linux-net shared`, which says so on stderr |
| pasta or slirp4netns | a second tool to install and trust on every machine, and both give the sandbox a route to the whole network unless separately firewalled |
| **A unix socket per allowed port** | chosen. Needs nothing but bubblewrap and this binary |

How the bridge works (src/bridge.rs): for each `--host-port` and for the proxy's port, `run` listens on a unix socket in a private directory and connects each connection to `127.0.0.1:<port>` on the host. That directory is bound read-only into the sandbox, and bubblewrap's command is `agent-sandbox inner --forward <port>… -- <command>`: inside, it listens on the sandbox's own `127.0.0.1:<port>` and connects each connection to the socket. The command sees the same address and port as on the host. A host port that was not named has no socket, so other runs' dev servers and the harness's own services cannot be reached, which macOS cannot offer.

This is the default on Linux (`--linux-net isolated`): if it does not work on a machine, the run fails at preflight instead of running with an open network.

**macOS limits, stated plainly.** Seatbelt's only address filter besides "any" is `localhost`. So:

- Every loopback port on the machine is reachable, including other runs' dev servers. `--host-port` changes nothing there.
- `localhost` also matches the machine's other addresses (measured: a listener on the LAN address was reached). A port of this machine is reachable by any of its addresses. Other machines are not: a direct connection gets `Operation not permitted` (tests/sandbox.rs).

## How the macOS allow-list was measured

On macOS 26.6, with node 24 from nvm, git from Xcode, and the browser cache the harness provides:

1. Start from `(deny default)` plus own_dir. Run each stage of the harness's preflight workload (`preflight.py`: `npm install` of vite, wrangler and @playwright/test; `vite build`; `wrangler dev`; Chromium loading the page) plus `git init/commit`, and read what the kernel denied (`log show --predicate 'sender == "Sandbox"'`). Add a rule, repeat, until the workload passed: 56 candidate rules.
2. Remove each rule in turn and rerun the whole workload. 22 were needed; 34 were not (among them every Apple service Chromium asked for: window server, pasteboard, launch services, tccd and six more).
3. The 22 alone pass the workload but break ordinary shell use (`ls: command not found`, because `/bin` could not be stat-ed). So a second set of checks, everyday commands an agent runs, decided the rest: remove each remaining rule, rerun the checks, keep it only if one failed. That brought back `/bin`, `signal (target same-sandbox)`, `/dev/urandom`, `/private/var/select`, `/private/etc/hosts`, the account-lookup service, and added `/dev/fd`.

Kept without a failing check, as judgement: `/dev/zero` and `/dev/random` (no data in them), `/private/etc/localtime` with its zone data (correct local time), `/private/etc/ssl` (curl prints a configuration error without `openssl.cnf`), `network-bind` on loopback.

Found on the way:

- `(deny default)` did not stop `lsof` from listing every process of the user. `(deny process-info* (target others))` does; `lsof -ti tcp:<port>` still finds the command's own server.
- node aborts at start if its stdout is a regular file it cannot stat, which is any file outside own_dir. `run` carries a standard stream that is a regular file through a pipe instead.
- `playwright install` hangs against a read-only browser cache: it retries a lock directory it cannot create. See "Wiring it into the harness".
- `ps` cannot run (it is setuid; this is already so under today's sandbox). `pgrep` and `pkill` cannot list processes: they ask `com.apple.sysmond`, which would show every process on the machine. That is a change from today, where they work.

## Tests

```sh
cargo test                                       # everything; the real-sandbox tests need sandbox-exec or bwrap
cargo clippy --all-targets -- -D warnings        # kept at zero warnings
```

| File | Tests | What |
|---|---|---|
| tests/policy.rs | 15 | path resolution, own_dir and `--ro` validation, missing paths, ancestors |
| tests/seatbelt.rs | 12 | the profile text: deny default, own_dir last, loopback only, closed services, quoting |
| tests/bwrap.rs | 10 | the bwrap argv against a faked host layout: empty root, order of mounts, the bridge |
| tests/proxy.rs | 18 | host matching, CONNECT parsing, 200/403/502 over real sockets, logging, the `proxy` command |
| tests/bridge.rs | 4 | both halves of the bridge over real sockets, and `agent-sandbox inner` as bubblewrap would run it |
| tests/presets.rs | 4 | presets.toml: contents, validity, github stays blocked |
| tests/toolchain.rs | 9 | finding tools on `PATH`, install roots, the proxy environment, exit codes |
| tests/sandbox.rs | 23 on macOS, 25 on Linux | the built binary under the real enforcer |

tests/sandbox.rs builds a stand-in bench layout in a directory named `agent-sandbox-test-<pid>-<n>` under the home directory (removed afterwards) and checks, inside the sandbox:

- unreadable: another run's file, a file in a stand-in repository, `package.json` and `node_modules` above the run (and node cannot `require` a package from there), a file written to `/tmp` and to the per-user temp directory from outside, the home directory's listing, `~/.ssh`, `~/.dbench` and other private directories. Each canary is first read without the sandbox, so the test cannot pass because the canary was missing.
- unwritable: everything outside own_dir.
- working: the workspace, `$TMPDIR`, `mktemp`, exit status, signals, everyday shell tools, git, node, a command reached through a symlink on `PATH`, output to a log file outside the run.
- network: a host loopback port named with `--host-port` is reachable; a connection to another machine is refused by the sandbox itself; a host that is not allowed gets 403 from the proxy and is logged.
- `online_*` (skipped with a reason when registry.npmjs.org cannot be reached): `npm install` through the proxy with only the `npm` preset; a direct connection to the registry is still refused; and the harness's preflight workload in one sandbox: `npm install`, `vite build`, `wrangler dev`, `playwright install`, Chromium loading the page. The Chromium step is skipped with a reason if the machine has no browser cache or not the revision the installed Playwright wants.

A test skips only when the machine has no sandbox tool, lacks the program the test is about, or (for `online_*`) is offline, and prints `SKIP <test>: <reason>`.

## Linux: what is not proven

Nothing in this crate has run on Linux. What exists:

- The bwrap argv and the bridge are unit-tested on macOS, the bridge and `agent-sandbox inner` over real sockets.
- The Linux-only code compiles and passes clippy for `x86_64-unknown-linux-gnu` (checked by cross-compiling).

What only a Linux machine can show, and tests/sandbox.rs is written to show it there:

- that the argv is accepted by bubblewrap and the listed parts of `/etc` are enough for node, npm, git and Chromium (Chromium may want `/sys`, which is not bound);
- that the bridge carries the model server's port and the proxy into the namespace (`a_server_on_the_hosts_loopback_is_reachable_when_its_port_is_named`, the `online_*` tests);
- that a host loopback port that was not named, and another address of the machine, are unreachable (two Linux-only tests).

To run it in CI, three changes outside this crate are needed (not made here):

1. `.github/workflows/checks.yml`: install bubblewrap (`sudo apt-get install -y bubblewrap`) and, on Ubuntu 24.04 runners, allow unprivileged user namespaces (`sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0`); without that bwrap fails with "setting up uid map: Permission denied" and the tests fail, as they should.
2. `tools/dbench/checks.toml`: two checks in `tools/agent-sandbox`, `cargo test` and `cargo clippy --all-targets -- -D warnings`.
3. `Swatinem/rust-cache`: add `tools/agent-sandbox` to `workspaces`.

## Wiring it into the harness (later)

`drive.sandboxed(cmd, own_dir)` becomes one command line on both platforms:

```sh
agent-sandbox run --own-dir <own_dir> \
    --ro <the agents' browser cache> --ro <dbench's tools directory> \
    --preset npm [--preset claude] \
    --host-port <model server or meter proxy port> \
    --proxy-log <run directory>/egress.jsonl \
    -- <cmd…>
```

`SANDBOX_DENY`, `outside_packages()`, `USER_TEMP_OPEN` and `hostenv.bwrap_wrap()` are then not needed: nothing they name is reachable.

What must change with it, each seen while testing:

- **npm's cache.** `agent_env` points `npm_config_cache` at the user's `~/.npm`, which the sandbox closes. Leave it unset (it then lives in the run's `agent-home/.npm`). A cache shared and writable between runs is a channel between them. Cost: each run downloads its packages again.
- **Playwright's browsers.** Give each run a browsers directory of its own, inside own_dir, holding symlinks to the browser directories of the shared cache; point `PLAYWRIGHT_BROWSERS_PATH` at it and pass the shared cache with `--ro`. `playwright install` then takes its lock and writes its bookkeeping in the run's directory, finds every browser complete, and downloads nothing. Proven by the workload test.
- **Standard streams.** Pipes, as `drive.py` uses now, are fine.
- **Linux, one sandbox per session.** With a private network each `run` has its own loopback. `preflight.py` starts `wrangler dev` in one sandbox, polls it from the host and loads it from a second sandbox; all three must happen inside one sandbox (as tests/sandbox.rs does it). An agent session is already one sandbox.
- **`pkill`/`pgrep` on macOS** stop working (see above); `lsof -ti tcp:<port>` and `kill` work.
- **Homebrew tools** (a Homebrew node or OpenCode) need `--ro /opt/homebrew`: their scripts name Homebrew's node by absolute path.
