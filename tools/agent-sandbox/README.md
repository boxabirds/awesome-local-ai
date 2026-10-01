# agent-sandbox

Runs a benchmark's coding agent with the least access it needs. One policy, two enforcers: Seatbelt (`sandbox-exec`) on macOS, bubblewrap on Linux. Everything is denied unless the policy names it.

It replaces a policy of "allow everything, deny a list of paths". Every leak under that policy was a path nobody had listed: a file share with a clone of the repository, `/tmp` leftovers of other runs, a `node_modules` in the home directory that gave a build a package it never declared. A list of what is allowed has no such gaps: a path nobody thought of is closed.

**Status: not wired into the harness.** Proven on macOS (below). The Linux side is built and unit-tested but first ran on a Linux kernel in CI on 1 October 2026 (ubuntu, bubblewrap); see "Linux: what is not proven".

## Use

```sh
agent-sandbox run --own-dir <dir> [--ro <path>]… [--preset <name>]… [--allow-host <host[:port]>]… \
                  [--host-port <port>]… [--agent-ports <port|first-last>]… [--ephemeral-ports] \
                  [--proxy-log <file>] -- <command…>
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
| System files | read: `/` itself, `/usr`, `/bin`, `/System`, `/private/var/select`, `/private/etc/hosts`, `/private/etc/ssl`, `/private/etc/localtime`, `/private/var/db/timezone` | dyld and system libraries; `sh`; `localhost`; CA certificates; local time |
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
| tests/policy.rs | 15 | path resolution, own_dir and `--ro` validation, missing paths, ancestors |
| tests/seatbelt.rs | 17 | the profile text: deny default, own_dir last, no network rule unless a port is named, one TCP loopback port per rule, closed services, quoting |
| tests/ports.rs | 7 | `--agent-ports` values, merging ranges, the limit, the command line |
| tests/bwrap.rs | 10 | the bwrap argv against a faked host layout: empty root, order of mounts, the bridge |
| tests/proxy.rs | 18 | host matching, CONNECT parsing, 200/403/502 over real sockets, logging, the `proxy` command |
| tests/bridge.rs | 4 | both halves of the bridge over real sockets, and `agent-sandbox inner` as bubblewrap would run it |
| tests/presets.rs | 4 | presets.toml: contents, validity, github stays blocked |
| tests/toolchain.rs | 9 | finding tools on `PATH`, install roots, the proxy environment, exit codes |
| tests/sandbox.rs | 28 on macOS, 26 on Linux | the built binary under the real enforcer |

tests/sandbox.rs builds a stand-in bench layout in a directory named `agent-sandbox-test-<pid>-<n>` under the home directory (removed afterwards) and checks, inside the sandbox:

- unreadable: another run's file, a file in a stand-in repository, `package.json` and `node_modules` above the run (and node cannot `require` a package from there), a file written to `/tmp` and to the per-user temp directory from outside, the home directory's listing, `~/.ssh`, `~/.dbench` and other private directories. Each canary is first read without the sandbox, so the test cannot pass because the canary was missing.
- unwritable: everything outside own_dir.
- working: the workspace, `$TMPDIR`, `mktemp`, exit status, signals, everyday shell tools, git, node, a command reached through a symlink on `PATH`, output to a log file outside the run.
- network: a host loopback port named with `--host-port` is reachable and the proxy is; a listener outside the sandbox on a port that was not named is not, on loopback or on the machine's other address, on a fixed port or one the kernel picked; the command serves on and reaches a port given with `--agent-ports`, and with `--ephemeral-ports` one the kernel picks; on macOS a port it was not given cannot be bound, and `--ephemeral-ports` opens the ephemeral range and no fixed port; a connection to another machine is refused by the sandbox itself; a host that is not allowed gets 403 from the proxy and is logged.
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
    --agent-ports <the run's own ports> --ephemeral-ports \
    --proxy-log <run directory>/egress.jsonl \
    -- <cmd…>
```

`SANDBOX_DENY`, `outside_packages()`, `USER_TEMP_OPEN` and `hostenv.bwrap_wrap()` are then not needed: nothing they name is reachable.

What must change with it, each seen while testing:

- **Ports.** Give each run ports of its own for its dev servers and name them with `--agent-ports`: at least the app port and one for wrangler's inspector, plus the acceptance suite's (`ACCEPT_PORT` and the one after it). Tell the agent which they are; a server it starts on any other port fails with `EPERM` on macOS. `--ephemeral-ports` is needed wherever `wrangler dev` runs, and costs about 10 s at the start of each sandbox on macOS, so leave it off for commands that do not serve. `preflight.py` runs `wrangler dev --port 18899` with no `--inspector-port`: add one and name both ports. Two runs on one Mac that are given the same port can reach each other's server on it.

- **npm's cache.** `agent_env` points `npm_config_cache` at the user's `~/.npm`, which the sandbox closes. Leave it unset (it then lives in the run's `agent-home/.npm`). A cache shared and writable between runs is a channel between them. Cost: each run downloads its packages again.
- **Playwright's browsers.** Give each run a browsers directory of its own, inside own_dir, holding symlinks to the browser directories of the shared cache; point `PLAYWRIGHT_BROWSERS_PATH` at it and pass the shared cache with `--ro`. `playwright install` then takes its lock and writes its bookkeeping in the run's directory, finds every browser complete, and downloads nothing. Proven by the workload test.
- **Standard streams.** Pipes, as `drive.py` uses now, are fine.
- **Linux, one sandbox per session.** With a private network each `run` has its own loopback. `preflight.py` starts `wrangler dev` in one sandbox, polls it from the host and loads it from a second sandbox; all three must happen inside one sandbox (as tests/sandbox.rs does it). An agent session is already one sandbox.
- **`pkill`/`pgrep` on macOS** stop working (see above); `lsof -ti tcp:<port>` and `kill` work.
- **Homebrew tools** (a Homebrew node or OpenCode) need `--ro /opt/homebrew`: their scripts name Homebrew's node by absolute path.

## Known limit, accepted (owner's decision, 1 October 2026)

On macOS a run that needs `--ephemeral-ports` (anything that serves on kernel-picked ports: `wrangler dev` does)
can connect to every listener in the kernel's ephemeral port range, its own or not. Seatbelt can't say "the ports
this sandbox bound". It is accepted while one agent runs per Mac at a time and nothing in that range holds
held-out data; revisit it if a Mac ever runs two agents at once (the alternatives: narrow the machine's ephemeral
range, or run the agent in a Linux VM on the bubblewrap path, where the loopback is the sandbox's own).
