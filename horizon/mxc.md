# MXC (Microsoft eXecution Container) for the agent's isolation

**Status:** open question (9 Oct 2026). Added at the owner's request: use MXC for isolation instead of platform-specific code, and
because it also supports Windows. Not installed, not tried. Everything below about MXC is from its own repository page
(<https://github.com/microsoft/mxc>), read once; nothing was run.
**Needs before it is a candidate:** an answer to each question under "What has to be true", from its documentation and a trial
on one platform.

## What it is

A sandbox for running untrusted code (model output, plugins, tools) that your application embeds, not a program you run. The
application gives it a container type, a policy and a command; it validates the request, picks a backend and launches the command.

- **Backends by OS.** Windows 11: `processcontainer` by default, also `windows_sandbox`, `wslc`, `microvm`, `hyperlight`,
  `isolation_session`. Linux: `bubblewrap` by default, also `lxc`, `microvm`, `hyperlight`. macOS: `seatbelt`, the only one.
  `windows_sandbox`, `microvm` and `hyperlight` are labelled experimental.
- **Policy.** Filesystem: read-only, read-write and denied path lists. Network: proxy support, outbound controls and host filtering,
  the last depending on the backend. Also clipboard, display and GUI controls, and a lifecycle for persistent containers. The
  configuration is versioned JSON with a stable schema.
- **Interfaces.** SDKs for Rust (`mxc-sdk` on crates.io), .NET and Node; JSON requests to platform executors.
- **Core in Rust**, MIT licence. The page shows no release number and no general-availability statement.

## What we have now

`tools/agent-sandbox` (Rust): one policy, two enforcers, the same two MXC uses on those platforms: Seatbelt on macOS and
bubblewrap on Linux. It is proved by tests, every agent runs in it, and every run records its version and a hash of the policy it
enforced (`identity`). It has no Windows enforcer, and the harness around it (bash and Python) has not been ported to Windows either.

## What this would and would not change

- **On the machines we use now, the isolation itself would not change:** MXC's Linux and macOS backends are bubblewrap and Seatbelt,
  which we already drive directly. What would change is who maintains the policy translation, and a schema that is shared.
- **Windows is the real gain,** through `processcontainer`. One of our boxes boots Windows, and a Windows engine (NInfer) is on the
  horizon. But a sandbox is one part of running the benchmark there: the harness, the clients and the held-out runner would
  still need a Windows port. MXC does not make Windows benchmarking possible by itself.

## What has to be true (none of it is known)

The page does not say whether MXC can do what our policy relies on. Each of these needs a documentation answer and then a trial:

1. **Our proof.** We prove the policy by tests that show what the agent can and cannot read, write and reach. They would have to pass
   unchanged through MXC on Linux and macOS.
2. **Features we use:** the run's directory shown at a fixed path inside (`/w`); one path inside it kept read-only (the spec); an
   environment of exactly an allow-list; an allow-listed egress proxy with preset hosts and a request log; the agent's own port
   ranges. The page names "host filtering that depends on the backend" and says nothing of the others.
3. **A policy identity for the record.** We stamp each run with a hash of the enforced policy. MXC's versioned JSON may supply one;
   it must be stable and say what was enforced.
4. **Per-backend enforcement details,** including what `--audit` (which the page says switches the sandbox's security off) is for and
   that we never use it on a run.
5. **Maturity.** Experimental backends, no stated release, and an optional telemetry path in Microsoft's own builds (the page says
   local builds send nothing). A benchmark needs a pinned version it can record.

GPU access is not stated, and does not matter here: the model server runs outside the sandbox, as it does now.

## If it goes ahead

A trial, not a swap: build the Rust SDK on the Linux box, express our policy in its JSON, run our sandbox proof against it, and compare
what it enforces with `agent-sandbox identity`. Only if that holds on Linux and macOS does a Windows trial make sense, and then only
alongside a plan for the rest of the harness there. The least-privilege rule in the repository `CLAUDE.md` is the test: deny by
default, allow only what the run is given.
