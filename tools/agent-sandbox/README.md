# agent-sandbox

Runs a benchmark's coding agent with the least access it needs. One policy, two enforcers: Seatbelt (`sandbox-exec`) on macOS, bubblewrap on Linux. Everything is denied unless the policy names it.

It replaces a policy of "allow everything, deny a list of paths". Every leak under that policy was a path nobody had listed: a file share with a clone of the repository, `/tmp` leftovers of other runs, a `node_modules` in the home directory that gave a build a package it never declared. A list of what is allowed has no such gaps: a path nobody thought of is closed.

**Status: the harness runs every agent in it** (1 October 2026): both clients (pi, Claude Code), every machine, no way round it ("How the harness uses it"). The permissive sandbox that preceded it (the whole machine visible and writable, a list of paths hidden) is gone from the agent's execution. Proven on macOS (below) and on Linux, in CI (Ubuntu, bubblewrap) and on an aarch64 Ubuntu 24.04 VM ("Linux: where it was proven").

**Scope (2 October 2026): the filesystem and the network.** The sandbox protects what the agent can read and write and what it can reach. Hiding processes from the agent is not a goal of its own and is not part of the proof. The private process list on Linux stays because it closes a file leak: without it, the environment of every process of the same user, the harness's keys included, is readable under `/proc`. The operating system's own directories are shown whole and read-only; everything that is the user's is absent unless the run is given it.

**What it needs.** macOS: nothing beyond the system (`sandbox-exec`). Linux: bubblewrap 0.6.1 or newer (what Ubuntu 22.04 ships; `sudo apt install bubblewrap`). The sandbox uses no bubblewrap option newer than that, and a unit test holds it to it: on 2 October 2026 an option from 0.9 (`--argv0`) stopped every job on a machine with 0.6.1. Building it needs Rust 1.77 or newer. The harness's machine setup (`setup-node.sh`) checks these versions, and node's, and offers the install or upgrade.

## Use

```sh
agent-sandbox run --own-dir <dir> [--own-at <path>] [--own-ro <rel>]… [--workdir <rel>] [--keep-env <NAME,NAME…>] \
                  [--ro <path>]… [--preset <name>]… [--allow-host <host[:port]>]… \
                  [--host-port <port>]… [--agent-ports <port|first-last>]… [--ephemeral-ports] \
                  [--proxy-log <file>] -- <command…>
agent-sandbox print  <the same options> -- <command…>   # the Seatbelt profile, or the bwrap argv one per line
agent-sandbox proxy  [--preset <name>]… [--allow <host[:port]>]… [--log <file>] [--port <n>]
agent-sandbox identity                                   # {"version", "platform", "policy_hash"} as JSON
```

| Option | What it does |
|---|---|
| `--own-at <path>` | Linux: show `--own-dir` at this path inside (the harness uses `/w`), so the command never sees where the run really lives. macOS cannot remap a path and refuses a different one: the directory has to be where it is shown. |
| `--own-ro <rel>` | A path inside `--own-dir` that stays read-only (the spec). A mount on Linux, a deny after the allow on macOS: `chmod +w` opens nothing. Must exist and stay inside `--own-dir` once resolved. |
| `--workdir <rel>` | Where the command starts, relative to `--own-dir` (`workspace`). |
| `--keep-env <NAME,…>` | The command's environment is exactly these names (if this process has them) plus `PATH` and the proxy's variables. Without it the command inherits everything. |
| `identity` | What this build is, so runs can say which sandbox they ran in: its version, platform and a SHA-256 of the policy it enforces (the Seatbelt profile or the bubblewrap command line of an empty run, and the preset hosts). |

`run` exits with the command's status (128 + N if signal N killed it; 126 if the sandbox could not be set up). It passes SIGTERM, SIGINT and SIGHUP on to the command.

## The policy

| | Allowed | Why |
|---|---|---|
| **Write** | `--own-dir` and nothing else (minus each `--own-ro`) | the run's workspace, `tmp/` and `agent-home/` live in it |
| **Read and execute** | the system's programs and libraries; each `--ro` path; the install of the command itself and of `node`, as found on `PATH` | the toolchain |
| **Stat only** | the directories above those | tools resolve real paths by stat-ing every ancestor; nothing beside the allowed path can be listed or read |
| **Network** | the loopback ports that were named: `--host-port` (connect), `--agent-ports` (serve and connect), the proxy; outbound only through the allow-listing proxy, to hosts named with `--preset` or `--allow-host` | the model server; the agent's own dev servers; npm needs its registry |
| **Everything else** | denied | the home directory, the repository, other runs, `/tmp`, the per-user temp directory, `node_modules` and `package.json` above the run, every other host, every other loopback port (other runs' dev servers, the harness's services, databases) |

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
| System | read, whole: `/usr`, `/bin`, `/sbin`, `/System`, `/private/etc`; and `/` itself, `/private/var/select`, `/private/var/db/timezone` | the operating system's own directories, never listed file by file: nothing of the user's is in them. dyld and system libraries; `sh`; `localhost`; CA certificates; local time |
| Devices | read `/dev/null`, `zero`, `random`, `urandom`; write `/dev/null`; `/dev/fd` | no data in them; `/dev/stdout` and process substitution |
| Services | `mach-lookup` of `com.apple.system.opendirectoryd.libinfo` only | account lookup; node's `os.userInfo()` throws without it |
| Chromium | `mach-register` and `mach-lookup` of `org.chromium.Chromium.MachPortRendezvousServer.<pid>`; `iokit-open` of `RootDomainUserClient` | its processes find each other through that port; it crashes at start without either |
| Network | `network-outbound (remote tcp "localhost:<port>")` per named port; `network-bind network-inbound (local tcp "localhost:<port>")` per `--agent-ports` port; nothing when no port is named | TCP on named loopback ports only; see "macOS: loopback, port by port" |
| Ancestors | `file-read-metadata` on each directory above an allowed path | path resolution |
| Toolchain | `file-read* process-exec` per `--ro` and discovered path | |
| Own directory | `file-read* file-write*`, last | SBPL applies the last matching rule |

Deliberately closed, with what that buys:

- **`com.apple.bsd.dirhelper`**: with it denied, `mktemp` and `confstr` cannot find the per-user temp directory and fall back to `TMPDIR`, which is inside own_dir. No rule for the shared temp directory is needed at all.
- **The name resolver (mDNSResponder)**: no DNS from inside. The proxy resolves names, so DNS is not a way out either.
- **`/usr/bin/git`'s stub**: it finds the real git through xcrun, which needs the per-user temp directory, Xcode's licence state and more. Instead the developer directory's `usr` is allowed read-only and its `bin` is put on `PATH` just ahead of `/usr/bin`, so the real `git` (and `python3`) run directly and nothing the caller had ahead of `/usr/bin` is shadowed.
- **`/Library`, `/Applications`, `/opt`**, the user's `Library`: other software's data lives there, and the workload does not need them. A Homebrew-installed tool needs `--ro /opt/homebrew`.

### Linux (bubblewrap)

| Part | Arguments | Why |
|---|---|---|
| Empty root | `--tmpfs /`, made read-only at the end (`--remount-ro /`) | what is not bound does not exist |
| Namespaces | `--unshare-pid --unshare-ipc --unshare-uts --hostname agent-sandbox --new-session --die-with-parent`, and `--unshare-net` | only its own processes are visible; the machine's name is not; the sandbox dies with its parent |
| Privileges | `--cap-drop ALL`; bubblewrap sets no-new-privs | `sudo` and setuid programs gain nothing (`sudo: The "no new privileges" flag is set`) |
| First process | `--as-pid-1` with the bridge program started as `init`, the command read from the sockets directory | no `bwrap`, no mount list, no launcher in `ps`: pid 1 is `init`, pid 2 is the command (`ps -eo args` was, before, the sandbox's own configuration with every hidden path). It reaps orphans and passes the command's status on. |
| System | `--ro-bind` of `/usr`, `/etc` and `/sys`, whole; `/bin`, `/sbin`, `/lib*` recreated as symlinks or bound | the operating system's own directories, never listed file by file: programs and libraries, the machine's configuration, the kernel's view of the hardware (cgroup limits, CPU topology). Nothing of the user's is in them. What is hidden is what is the user's: the home, `/tmp`, `/var`, `/run`, mounted disks |
| Kernel | `--proc /proc --dev /dev` | a private `/proc` and a minimal `/dev` |
| Toolchain | `--ro-bind` per `--ro` and discovered path; `--symlink` for links on the way | |
| Temp | `--bind <own>/tmp /tmp` and `/var/tmp` | a hard-coded `/tmp` path works, privately |
| Own directory | `--bind <own> <own-at>` (`<own>` when no `--own-at`), then `--ro-bind` over each `--own-ro` path, the last mounts | a later mount covers an earlier one, and own_dir may be under `/tmp`; the spec is read-only whatever its mode; `--chdir` starts the command in `--workdir` |

### Network

Deny by default. The sandboxed command reaches the loopback ports that were named and nothing else; `--preset` and `--allow-host` start an allow-listing proxy on loopback and set `HTTPS_PROXY`, `HTTP_PROXY` (and lower-case forms), `NO_PROXY=localhost,127.0.0.1` and `NODE_USE_ENV_PROXY=1` for the command.

The proxy (src/proxy.rs) tunnels `CONNECT host:port` when the host is an allowed name or a subdomain of one, on port 443 unless the rule names another. Everything else gets 403: other hosts, look-alikes (`registry.npmjs.org.attacker.com`), other ports, addresses that were not listed exactly, and every request that is not CONNECT. Each request is logged as a JSON line (`t`, `request`, `allowed`), the same shape as the judge's proxy in `benchmarks/spec-bench/harness/egress_proxy.py`.

Presets are data: `presets.toml`. `npm` (registry.npmjs.org), `playwright` (its two browser CDNs), `claude` (api.anthropic.com). No preset, alone or combined, reaches github.com or its content hosts (tests/presets.rs).

**Linux.** `--unshare-net` gives the sandbox an empty network with its own loopback, which is exactly "nothing else", but the model server and the proxy listen on the host's loopback and are then out of reach. bubblewrap has no port forwarding. Three options:

| Option | Verdict |
|---|---|
| Leave the network namespace shared | enforces nothing; kept only as `--linux-net shared`, which says so on stderr |
| pasta or slirp4netns | a second tool to install and trust on every machine, and both give the sandbox a route to the whole network unless separately firewalled |
| **A unix socket per allowed port** | chosen. Needs nothing but bubblewrap and this binary |

How the bridge works (src/bridge.rs): for each `--host-port` and for the proxy's port, `run` listens on a unix socket in a private directory and connects each connection to `127.0.0.1:<port>` on the host. That directory is bound read-only into the sandbox, and bubblewrap's command is `agent-sandbox inner --forward <port>… -- <command>`: inside, it listens on the sandbox's own `127.0.0.1:<port>` and connects each connection to the socket. The command sees the same address and port as on the host. A host port that was not named has no socket, so other runs' dev servers and the harness's own services cannot be reached. Inside, the loopback is the sandbox's own: the command binds and connects to any port there, so `--agent-ports` and `--ephemeral-ports` are accepted and change nothing.

This is the default on Linux (`--linux-net isolated`): if it does not work on a machine, the run fails at preflight instead of running with an open network.

### macOS: loopback, port by port

macOS has one loopback for the whole machine, shared with other runs' dev servers, the harness's control server and whatever else listens there. The profile used to allow all of it (`(remote ip "localhost:*")`). Now the command may connect only to:

| | Flag | Rules |
|---|---|---|
| servers outside the sandbox (the model server or meter proxy) | `--host-port <port>` | connect |
| the allow-listing proxy | none: its port is added when it starts | connect |
| its own servers | `--agent-ports <port>` or `<first>-<last>`, repeatable, 1024 ports at most | bind, listen, connect |
| ports the kernel picks for it (bind to port 0) | `--ephemeral-ports` | bind and listen on any loopback port; connect to the kernel's ephemeral range |

With none of these there is no network rule at all. UDP is closed in every case (the old rule allowed it to every loopback port).

**What Seatbelt can express** (macOS 26.6, each line an experiment with `sandbox-exec`):

| Tried | Result |
|---|---|
| `(remote ip "localhost:41001")`, `(remote tcp "localhost:41001")` | accepted; that port is reachable on 127.0.0.1 and ::1, the next port is refused (`Operation not permitted`) |
| `(local tcp "localhost:41010")` for `network-bind` and `network-inbound` | accepted; bind needs `network-bind`, listen needs `network-inbound`, a connection to it needs `network-outbound` as well |
| `"localhost:41000-41005"` | refused when the profile is compiled: `invalid port in network address`. There are no ranges |
| `"127.0.0.1:41001"`, `"127.0.0.2:*"`, `"::1:41003"` | refused: `host must be * or localhost in network address`. There are no addresses |
| `"localhost:0"` | refused: `invalid port`. And a bind to port 0 is checked as port 0, before the kernel picks (the log says `deny network-bind local:*:0`; with 8192 ephemeral ports allowed for bind, 40 of 40 binds to port 0 were refused). So only `"localhost:*"` allows it |
| one rule per port, 1000 / 4000 / 8000 / 16384 ports | compiles in 0.04 s / 0.5 s / 2 s / 10 to 14 s: the time grows with the square of the count |
| 8000 filters in a single rule; 16384 ports for two operations | `profile compilation failed`; `sandbox_apply: Invalid argument` after 22 s. The ephemeral range can be listed once, not twice |
| `"localhost"` against the machine's other addresses | it matches them: a listener on the LAN address was reached with `localhost:*`, and a server inside could bind `0.0.0.0` and the LAN address |

So a rule can say "this port", and nothing else: not a range, not an address, not "the ports this sandbox bound". SBPL is Scheme, so the profile writes each range with a loop (`connect-to`, `listen-on`) that adds one rule per port.

**What the workload needed** (wrangler 4.145, vite 7.3, Playwright 1.63; sockets listed with `lsof` on the process tree, denials read from the system log):

| Tool | Ports | With `--agent-ports` only |
|---|---|---|
| a node server on a named port; `vite preview`; `vite` dev with its HMR websocket (same port) | the one named | works |
| Chromium under Playwright, `playwright test` with a `webServer` | none: Playwright drives Chromium over a pipe | works |
| `node --inspect` | 9229 unless told otherwise | works when the port is in `--agent-ports`, else `operation not permitted` |
| anything that listens on port 0 | one the kernel picks | `listen EPERM` |
| `wrangler dev` | the app port and the inspector port, both settable (`--port`, `--inspector-port`), **and five the kernel picks**: two in node (miniflare's loopback servers, `listen(0)` hard-coded) and three in the second workerd, with workerd connecting to them | fails: `listen EPERM: operation not permitted 127.0.0.1`. With bind opened and connect still limited to the named ports it starts and then never answers (13,637 denials of `workerd network-outbound remote:*:<ephemeral port>` in one attempt) |

No flag or variable pins wrangler's five ports, and the loader trick that could move a port-0 bind into a range (`DYLD_INSERT_LIBRARIES`) does not survive `/usr/bin/env` or `/bin/sh` (measured: the variable is gone in the child), which every `npx` and npm script passes through. So `wrangler dev` needs `--ephemeral-ports`.

**What `--ephemeral-ports` costs, stated plainly.** It is not least privilege; it is the tightest rule Seatbelt can hold that still runs `wrangler dev`:

- The command can connect to **every** port in the kernel's ephemeral range (49152 to 65535 here, read from `net.inet.ip.portrange.*` at start), its own or not. On a bench machine that includes other runs' miniflare and workerd internals. Fixed ports stay closed: other runs' dev servers on 8787, the harness's services, databases (tests/sandbox.rs pins both halves).
- The command can bind and listen on any loopback port, since a bind to port 0 cannot be allowed any other way.
- Starting takes about 10 s longer (16384 rules; measured 9.6 to 10.6 s against 0.4 s without), and each connection about 0.35 ms longer (0.11 ms to 0.46 ms). Narrowing the machine's ephemeral range (`sysctl net.inet.ip.portrange.first` and `hifirst`, as root) would shrink both the gap and the delay; that was not tried here.
- wrangler picks its inspector port itself (9229, or the next free one) unless given `--inspector-port`, and fails to become ready when it cannot connect to it. Give it one from `--agent-ports`.

**Inbound.** Nothing stops another process on the machine from connecting to the command's server: Seatbelt checks the command's bind and listen, not who connects (measured: a client outside the sandbox was served). Because `"localhost"` matches every address of the machine, the command can also bind `0.0.0.0` or the LAN address on a port it was given, and with `--ephemeral-ports` on any port; whether another machine can then reach it depends on the machine's firewall and was not tested from another machine. No held-out data is exposed this way, but it is a way in for an outside party.

**What would close the gap.** Not a loopback alias per run: Seatbelt refuses any address in a rule (above), and `127.0.0.2` cannot even be bound without `ifconfig lo0 alias` as root (measured: `Can't assign requested address`). What Linux has is a network stack per sandbox, and macOS has no unprivileged equivalent. The options are to run the macOS agent inside a Linux VM and use the bubblewrap path there, or to get wrangler to stop using port 0. Neither was tried here.

## How the macOS allow-list was measured

On macOS 26.6, with node 24 from nvm, git from Xcode, and the browser cache the harness provides:

1. Start from `(deny default)` plus own_dir. Run each stage of the harness's preflight workload (`preflight.py`: `npm install` of vite, wrangler and @playwright/test; `vite build`; `wrangler dev`; Chromium loading the page) plus `git init/commit`, and read what the kernel denied (`log show --predicate 'sender == "Sandbox"'`). Add a rule, repeat, until the workload passed: 56 candidate rules.
2. Remove each rule in turn and rerun the whole workload. 22 were needed; 34 were not (among them every Apple service Chromium asked for: window server, pasteboard, launch services, tccd and six more).
3. The 22 alone pass the workload but break ordinary shell use (`ls: command not found`, because `/bin` could not be stat-ed). So a second set of checks, everyday commands an agent runs, decided the rest: remove each remaining rule, rerun the checks, keep it only if one failed. That brought back `/bin`, `signal (target same-sandbox)`, `/dev/urandom`, `/private/var/select`, `/private/etc/hosts`, the account-lookup service, and added `/dev/fd`.

Kept without a failing check, as judgement: `/dev/zero` and `/dev/random` (no data in them), `/private/etc/localtime` with its zone data (correct local time), `/private/etc/ssl` (curl prints a configuration error without `openssl.cnf`).

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
| tests/policy.rs | 20 | path resolution, own_dir and `--ro` validation, missing paths, ancestors; `--own-at`, `--own-ro` and `--workdir` validation |
| tests/seatbelt.rs | 18 | the profile text: deny default, own_dir last, a path inside it denied for writing after it, no network rule unless a port is named, one TCP loopback port per rule, closed services, quoting |
| tests/ports.rs | 7 | `--agent-ports` values, merging ranges, the limit, the command line |
| tests/bwrap.rs | 13 | the bwrap argv against a faked host layout: empty root, order of mounts, the bridge, the first process (`init`, nothing listed), capabilities, the run shown at `/w` with the spec mounted over it |
| tests/proxy.rs | 18 | host matching, CONNECT parsing, 200/403/502 over real sockets, logging, the `proxy` command |
| tests/bridge.rs | 6 | both halves of the bridge over real sockets, `agent-sandbox inner` as bubblewrap would run it (the command read from the sockets directory), the command file's encoding |
| tests/presets.rs | 4 | presets.toml: contents, validity, github stays blocked |
| tests/toolchain.rs | 9 | finding tools on `PATH`, install roots, the proxy environment, exit codes |
| tests/sandbox.rs | 36 on macOS, 37 on Linux | the built binary under the real enforcer |

tests/sandbox.rs builds a stand-in bench layout in a directory named `agent-sandbox-test-<pid>-<n>` under the home directory (removed afterwards) and checks, inside the sandbox:

- unreadable: another run's file, a file in a stand-in repository, `package.json` and `node_modules` above the run (and node cannot `require` a package from there), a file written to `/tmp` and to the per-user temp directory from outside, the home directory's listing, `~/.ssh`, `~/.dbench` and other private directories. Each canary is first read without the sandbox, so the test cannot pass because the canary was missing.
- unwritable: everything outside own_dir.
- working: the workspace, `$TMPDIR`, `mktemp`, exit status, signals, everyday shell tools, git, node, a command reached through a symlink on `PATH`, output to a log file outside the run.
- the agent's world: a spec made read-only by `--own-ro` survives write, create, delete, rename of its directory and `chmod u+w` (the mode is unchanged); `--own-ro` refuses a path that is missing, absolute, above the run or a link out of it; macOS refuses `--own-at` elsewhere; Linux shows the run at `/w` with no trace of its real path in the mounts, `ps`, the environment or `cmdline`; Linux `ps` lists `init`, the shell and `ps` and no launcher; the first process reaps orphans and passes the status on; no new privileges, no capabilities, `sudo` refused; `--keep-env` leaves a canary key out (and without it the key gets through: the control); a process outside is neither found nor signalled by `pkill`, `pgrep` or `kill`; `identity` is stable and names the version, platform and a 64-hex-digit policy hash.
- network: a host loopback port named with `--host-port` is reachable and the proxy is; a listener outside the sandbox on a port that was not named is not, on loopback or on the machine's other address, on a fixed port or one the kernel picked; the command serves on and reaches a port given with `--agent-ports`, and with `--ephemeral-ports` one the kernel picks; on macOS a port it was not given cannot be bound, and `--ephemeral-ports` opens the ephemeral range and no fixed port; a connection to another machine is refused by the sandbox itself; a host that is not allowed gets 403 from the proxy and is logged.
- `online_*` (skipped with a reason when registry.npmjs.org cannot be reached): `npm install` through the proxy with only the `npm` preset; a direct connection to the registry is still refused; and the harness's preflight workload in one sandbox: `npm install`, `vite build`, `wrangler dev`, `playwright install`, Chromium loading the page. The Chromium step is skipped with a reason if the machine has no browser cache or not the revision the installed Playwright wants.

A test skips only when the machine has no sandbox tool, lacks the program the test is about, or (for `online_*`) is offline, and prints `SKIP <test>: <reason>`.

## Linux: what is not proven

Nothing in this crate has run on Linux. What exists:

- The bwrap argv and the bridge are unit-tested on macOS, the bridge and `agent-sandbox inner` over real sockets.
- The Linux-only code compiles and passes clippy for `x86_64-unknown-linux-gnu` (checked by cross-compiling).

What only a Linux machine can show, and tests/sandbox.rs is written to show it there:

- that the argv is accepted by bubblewrap and `/usr`, `/etc` and `/sys` are enough for node, npm, git and Chromium;
- that the bridge carries the model server's port and the proxy into the namespace (`a_server_on_the_hosts_loopback_is_reachable_when_its_port_is_named`, the `online_*` tests);
- that a host loopback port that was not named, and another address of the machine, are unreachable (two Linux-only tests).

## How the harness uses it

Every agent session (`drive.run_agent`, the preflight, the story loop's restarts, both clients) starts through one function,
`drive.launch_agent` -> `sandbox.launch` (benchmarks/spec-bench/harness/sandbox.py). There is no other path: a session
with no world does not start, and `SPEC_BENCH_SANDBOX=permissive` (no sandbox at all, for the harness's own tests) refuses to
run a recording benchmark, and a run that used it cannot be published (`drive.record_refusal`). The command line:

```sh
agent-sandbox run --own-dir <the run's directory> --workdir workspace --keep-env <the allow-list's names> \
    --own-ro workspace/spec [--own-at /w]                                  # /w on Linux only \
    --ro <the agents' browsers> --ro ~/.dbench/tools                       # read-only, shared \
    --preset npm --preset playwright [--preset claude] \
    --host-port <the model server's port> --agent-ports <the run's block of 16> [--ephemeral-ports]   # macOS: wrangler \
    --proxy-log <bench home>/egress/<id>.jsonl -- <the client's command>
```

| What the agent has | How |
|---|---|
| the filesystem | its run directory (workspace, `tmp/`, `agent-home/`, the client's configuration, its own `browsers/` directory) and nothing else writable; `spec/` read-only; node, npm, git, python3, the client and `~/.dbench/tools` read-only; no home directory, file share, other run, `~/.dbench`, harness code, reference build or private repository. Shown at `/w` on Linux; on macOS (where Seatbelt checks real paths) it really is in `~/.w/<id>`, the id a hash of the run's name, and the long name is a link the harness keeps for itself |
| the environment | exactly the names in `sandbox.ENV_ALLOWED` (one table, with the reason for each); `PATH` is the directories of node, the client and the system, not the harness's; `HOME` is `<run>/agent-home`; `TMPDIR` is the run's own (`/tmp` on Linux); Claude Code's token is a pipe named by `CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR`, never a variable. `agent-sandbox` drops everything else a second time (`--keep-env`), so what the launcher itself needed (the user manager's address for `systemd-run`) never reaches the agent |
| the network | the npm registry, Playwright's two CDN hosts and (Claude Code only) `api.anthropic.com`, through the allow-listing proxy; the model server's loopback port on the host (a model server that is not on the loopback is refused at start); nothing else, not other ports, other hosts, raw addresses or DNS |
| its own servers | a block of 16 ports chosen by the run's name (`AGENT_PORT_FIRST`, `AGENT_PORT_LAST`, which the story prompt names); on Linux its loopback is its own anyway |
| npm | its cache is in its own home: a cache shared and writable between runs is a channel between them. Each run downloads its packages again |
| Playwright | the shared browsers are read-only; the run's `browsers/` directory holds a link to each (never to the cache's own `.links` bookkeeping, which Playwright writes in the run's directory), so `playwright install` finds them complete and downloads nothing, and the agent cannot write libraries into the shared cache (a revision it lacks comes from the CDN into its own directory) |
| processes | Linux: a private pid namespace and `/proc`; macOS: no listing, no signal to anything outside |
| privileges | none: no `sudo`, no setuid, no capabilities |

What the harness does outside it, unchanged: the gates, the held-out scoring, snapshots, the containment scope (`systemd-run` wraps the
launcher, and kills what is left at the end of a story), the checks after a story (the spec's hash, `outside_workspace`), the
benchmarker's reads. The agent's directory is reached by its real path (`~/.w/<id>`); the harness never uses `/w`, and no published
record names it as a path. `logscan` still runs after each story as a backstop: in a sandboxed run it finds nothing by construction.

The one thing the old permissive path still serves is the judge (`harness/judge_sandbox.py`, macOS, a Codex session that grades two
finished runs): it is not a coding agent's run and has its own profile; moving it here is a separate job.

### What is not enforced, and why

- **macOS: loopback ports** ("Known limit, accepted", below): with `--ephemeral-ports` (needed by `wrangler dev`) the command can connect to every listener in the kernel's ephemeral range, its own or not. Owner's decision, 1 October 2026. Inbound: any process on the machine can connect to the command's own servers.
- **macOS: the run is not at `/w`.** Seatbelt cannot remap a path. The model sees `/Users/<user>/.w/<id>/workspace`: the owner's account name and a hash, no run name, engine, model, machine or the word "bench".
- **What a client adds to its own environment.** pi sets `PI_MODEL` (the served model's id, as the server reports it), `PI_PROVIDER`, `PI_SESSION_FILE`, `PI_SESSION_ID`, `PI_REASONING_LEVEL`, `PI_SKIP_VERSION_CHECK` and `AI_AGENT` for its tools; Claude Code sets `CLAUDECODE`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_PID`, `AI_AGENT` and a few more. None is a credential or names a run. `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` is not used: it forces Claude Code out of `--dangerously-skip-permissions` (measured: every shell call then asks for approval).
- **Linux: `/proc/self/mountinfo`** names, as the "root" of each bind mount, where its source is within its filesystem: the run's real path (`~/.w/<id>`). `/proc/mounts`, `ps`, the environment and every command line do not. An agent that reads that one file learns the machine's account name and a hash.
- **Linux: the account name** is in the sandbox's `/etc/passwd` and the machine's name is `agent-sandbox`. `PATH` names the directory node and the client are in (`~/.nvm/…`, `~/.dbench/tools/bin`) because they are readable there.
- **No seccomp filter, no resource limits** (the containment scope has the memory limit), no defence against a kernel vulnerability: the sandbox is a namespace and a profile, and so is as strong as the kernel's.
- **The proxy's log** is written by the harness's side and is not tamper-proof against the machine's own user; it is not published.
- **Claude Code, authenticated.** Proven here up to the API: it starts, runs a shell call, reaches `api.anthropic.com` through the proxy and is refused there as a made-up token is. A session with the owner's real token was not run (nobody entered a credential).
- **WebKit's system libraries** are not on the Linux machines and the agent can no longer fetch them: an agent that needs them fails instead of downloading `.deb` packages from 18 hosts (findings 7).

### The binary and releases

A release is `git archive` of the paths in `harness` (tools/dbench/checks.toml); `tools/agent-sandbox` is one of them since this change, source and `Cargo.lock`, no binary. `sandbox.binary()` builds it with `cargo build --release --locked` into `<bench home>/agent-sandbox/<hash of the source>/` the first time a machine runs a harness with that source, and keeps it; `run.sh` does it before anything starts (`sandbox.py identity`), so a node that cannot (no cargo, no crates.io) stops there with the reason, not mid-story. `AGENT_SANDBOX_BIN=<file>` names a binary instead. A node needs Rust (1.77 or newer; `setup-node.sh` checks for cargo) and, once per change of the sandbox's source, the network. Its release profile has no link-time optimisation: there is nothing in a sandbox wrapper to optimise, and a node pays the build on every change (docs/20261003-rust-build-times.md). Nothing is built by hand on a node and nothing travels but the release.

## Known limit, accepted (owner's decision, 1 October 2026)

On macOS a run that needs `--ephemeral-ports` (anything that serves on kernel-picked ports: `wrangler dev` does)
can connect to every listener in the kernel's ephemeral port range, its own or not. Seatbelt can't say "the ports
this sandbox bound". It is accepted while one agent runs per Mac at a time and nothing in that range holds
held-out data; revisit it if a Mac ever runs two agents at once (the alternatives: narrow the machine's ephemeral
range, or run the agent in a Linux VM on the bubblewrap path, where the loopback is the sandbox's own).
