# Making a DGX Spark a benchmark node

The steps that took the first DGX Spark from "dbench answers" to "runs the
Flash-Next llama.cpp baseline", written down to be repeated on the second.
Machines are named by hardware here; the hostnames live in the dbench node list.

Started 29 Oct 2026. Each step says what was found and what was done.

## What a Spark has when it arrives

Read over ssh on the first one, 29 Oct 2026:

| | |
|---|---|
| OS | DGX OS, Ubuntu 24.04.5 LTS, kernel 7.0.0-1019-nvidia |
| CPU / GPU | aarch64; NVIDIA GB10, compute capability 12.1 (sm_121) |
| Driver / CUDA | 580.178.04; CUDA 13.0, `/usr/local/cuda` -> `/etc/alternatives/cuda` -> `/usr/local/cuda-13.0` |
| Memory | MemTotal 127,598,832 kB (124,608 MiB); `nvidia-smi` memory fields are `[N/A]` |
| Disk | 3.7 TB NVMe |
| Already there | git 2.43, python3 3.12, rsync, bwrap 0.9.0, docker |
| Not there | uv, pi; Node only as a tarball in `~/node` (22.12), not on PATH |

Check a new one with:

```bash
ssh <spark> 'uname -m; . /etc/os-release; echo $PRETTY_NAME; uname -r
  nvidia-smi --query-gpu=name,compute_cap,memory.total,driver_version --format=csv
  /usr/local/cuda/bin/nvcc --version | tail -1; grep MemTotal /proc/meminfo; df -h ~ | tail -1
  for c in bwrap node pi uv cargo git rsync; do printf "%s: " $c; command -v $c || echo MISSING; done'
```

## 1. dbench (done before 29 Oct)

Both Sparks already ran `dbench serve` as a systemd user service, built
natively for aarch64 (`~/.dbench/tools/bin/dbench`, `0.1.0+3a59bba5`), with
linger on and both in the client's `~/.config/dbench/nodes.toml`. The unit:

```
dbench serve --bind <tailscale ip>:7717 --repo ~/.dbench/repo --home ~/.dbench
  --share-dir ~/.local/share --path-prepend ~/.dbench/tools/bin
  --path-prepend ~/.cargo/bin --max-restarts 3 --no-pull
```

`tools/dbench/build-linux.sh` builds x86_64 only; on a Spark, build with cargo
on the machine itself. The checkout is `~/.dbench/repo`, as on the RTX 4090
machine, so the private pack sits beside it at
`~/.dbench/awesome-local-ai-bench-private`. With `--no-pull`, the checkout is
updated by hand (`git -C ~/.dbench/repo pull --ff-only`, never a reset).

## 2. The installer on a GB10 (repo change, 29 Oct)

`nvidia-smi` gives `[N/A]` for a GB10's memory. Before this change the
installer did arithmetic on it, printed "arithmetic syntax error" and refused
the machine for too little VRAM; selection saw a 0 MiB host, and the
launcher's pre-flight and the smoke report read nothing. Now
`lib/accel/cuda.sh`, `lib/select.sh` and `lib/runtime/server-llamacpp.sh` fall
back to `/proc/meminfo` (MemTotal for the machine, MemAvailable for headroom),
and `dgx-spark` is a machine segment (CUDA, 128 GB). `tests/dgx-spark-test.sh`
fakes a GB10 and covers all four readers.

The combination is
[`qwen/3.8/flash-next/ubuntu/dgx-spark/llamacpp-pi`](../combinations/qwen/3.8/flash-next/ubuntu/dgx-spark/llamacpp-pi/README.md).

## 3. Tools for the harness (29 Oct)

```bash
curl -LsSf https://astral.sh/uv/install.sh | env UV_NO_MODIFY_PATH=1 sh     # ~/.local/bin/uv
PATH=$HOME/node/bin:$PATH npm install -g @earendil-works/pi-coding-agent@0.87.1   # into ~/node
```

pi is 0.87.1 to match every other node's v2 runs (the guide: client versions
must not differ between stacks). Then the dbench unit gets `~/node/bin` and
`~/.local/bin` on its `--path-prepend`, and is restarted.

## 4. The private pack

The Spark's GitHub key is a deploy key for the public repo only, so
`setup-node.sh` cannot clone `awesome-local-ai-bench-private`. It is copied
from another node instead, without `node_modules` (built for another
architecture; `setup-node.sh` runs `npm ci`).

## 5. setup-node.sh, the install, the check

Still to record: `setup-node.sh` (Playwright's arm64 Chromium, the sandbox
preflight), the installer (the llama.cpp build for sm_121, the 97 GB
download, the smoke test), and `dbench nodes` showing the install.
