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
`~/.local/bin` on its `--path-prepend` (and on its `Environment=PATH`), and is
restarted: `systemctl --user daemon-reload && systemctl --user restart dbench`.
After it, `dbench nodes` says `missing tools: none`.

The Spark's global git identity may be someone else's setting. Set the
records' identity on the bench checkout only:
`git -C ~/.dbench/repo config user.name …` and `user.email …`.

## 4. The private pack

The Spark's GitHub key is a deploy key for the public repo only, so
`setup-node.sh` cannot clone `awesome-local-ai-bench-private`. Copy its git
history from a node that has it, as a bundle (not the working tree, which
holds other runs' held-out detail), then point origin at GitHub:

```bash
ssh <node> 'git -C ~/.dbench/awesome-local-ai-bench-private bundle create - --all' > pack.bundle
scp pack.bundle <spark>:/tmp/ && ssh <spark> 'git clone -q /tmp/pack.bundle ~/.dbench/awesome-local-ai-bench-private
  && cd ~/.dbench/awesome-local-ai-bench-private
  && git remote set-url origin git@github.com:boxabirds/awesome-local-ai-bench-private.git
  && git checkout -q vidi-v2.0-pre2 && rm /tmp/pack.bundle'
```

## 5. setup-node.sh

```bash
cd ~/.dbench/repo && PATH=$HOME/node/bin:$HOME/.local/bin:$HOME/.cargo/bin:$PATH \
  bash benchmarks/spec-bench/harness/setup-node.sh
```

On the first Spark every check passed, including the held-out suite's
`npm ci` and Playwright's Chromium for arm64 ("browser launches", for the
agents' browser and the suite's), **except the sandbox preflight**:

```
bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted
```

Ubuntu 24.04 sets `kernel.apparmor_restrict_unprivileged_userns = 1`, so bwrap
gets a user namespace without the right to configure its network namespace.
The fix gives that right to `/usr/bin/bwrap` alone, which is narrower than
turning the restriction off for every program. It needs root:

```bash
sudo tee /etc/apparmor.d/bwrap >/dev/null <<'EOF'
abi <abi/4.0>,
include <tunables/global>

profile bwrap /usr/bin/bwrap flags=(unconfined) {
  userns,
  include if exists <local/bwrap>
}
EOF
sudo apparmor_parser -r /etc/apparmor.d/bwrap
```

Then run `setup-node.sh` again; its last section is the sandbox preflight.
(Not yet run on a Spark when written: the preflight passing after it is the
proof.)

## 6. The install

The installer's packages that DGX OS lacks: `ninja-build` and
`libcurl4-openssl-dev`. Without passwordless sudo the installer warns and
falls back (ninja as a uv tool, llama.cpp built with `-DLLAMA_CURL=OFF`,
which only drops llama.cpp's own downloading). To have them:
`sudo apt-get install -y --no-install-recommends ninja-build libcurl4-openssl-dev`.

```bash
cd ~/.dbench/repo && PATH=$HOME/node/bin:$HOME/.local/bin:$HOME/.cargo/bin:$PATH INSTALL_INTERACTIVE=0 \
  setsid nohup bash ./install-qwen-3.8-flash-next-ubuntu-dgx-spark-llamacpp-pi.sh > ~/spark-install.log 2>&1 < /dev/null &
```

On the first Spark: qualification read `NVIDIA GB10 (sm_121, 124608 MiB)` and
passed; llama.cpp (the MTP branch) built for sm_121 with CUDA 13.0 in under
two minutes (12:24 to 12:26); the 97.4 GB download took 94 minutes (12:26 to
14:00 GMT, about 17 MB/s, over the machine's Wi-Fi).

The smoke test loads the whole model, so it needs about 100 GB free. Run it
when nothing else on the Spark holds memory: two attempts there failed while
another program (in Docker) held 61 GB and then 15 GB and growing. The
launcher's pre-flight named the first. The kernel's OOM killer ended the
second (`journalctl -k`: "Out of memory: Killed process … (llama-server)"). Re-running the
installer redoes only the smoke test (`SKIP_BACKEND_UPDATE=1` keeps the build).

On a free machine (30 Oct, 04:57 GMT) it passed: server healthy in 23 s at
131072 context, generation OK, MTP draft acceptance 0.57 (16 of 28, mean
length 3.29); on its 22-token reply, 36 tok/s decode and 60 tok/s prefill
(too short to be a measurement). After it, `dbench nodes` lists the install
`qwen38-flash-next-spark` on the Spark.
