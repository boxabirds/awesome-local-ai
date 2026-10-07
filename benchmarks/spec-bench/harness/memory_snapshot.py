"""What the model server is holding when a story starts.

The footprint that decides what fits on a machine was recorded in one place (the conditions sampler's total, every
30 s) and shown nowhere, and there was no breakdown at all. This takes a snapshot at each story's start, from what
each engine actually says about itself.

Engines say different things, so a snapshot reports what THAT engine volunteers, names it, and leaves the rest out.
It never derives a figure and presents it beside measured ones: a "KV cache" that is really context length times a
constant would sit in the same column as a real one and read as a measurement. Where something is not offered it is
absent, and a value that could not be read is None -- never 0, which is what a containerised engine's footprint
read for 2,381 readings before the shim was recognised (hostenv.is_container_shim).

What each engine offers, as found on 7 Oct 2026 (the tests carry real lines):

  llama.cpp   every prompt-cache EVICTION with the evicted entry's size, and each erased context checkpoint. No line
              for the cache's current size, so the cumulative evictions since the server started stand in: a cache
              that keeps evicting multi-gigabyte entries is thrashing, which is the thing worth knowing.
  gufo        a [cache] line with what the snapshot cache holds against its capacity, the GPU's use at load, and on
              every request the process's RSS and the host's free memory.

More can be added per engine as they are found, including by upstream changes: the engines are open source.
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Iterable

BYTES_PER_MIB = 1024 * 1024
MIB_PER_GIB = 1024

# A shard is "<name>-00001-of-00003.gguf": the first shard is what an engine is pointed at, the rest sit beside it.
_SHARD = re.compile(r"^(?P<stem>.+)-(?P<n>\d{5})-of-(?P<of>\d{5})\.gguf$")

# llama.cpp, from its server log.
_LLAMACPP_SIGNATURE = ("llama_server", "srv    load_model", "prompt cache entry", "erasing old context checkpoint")
_EVICTION = re.compile(r"making room for prompt cache entry, removing oldest entry \(size = ([\d.]+) MiB\)")
_CHECKPOINT = "erasing old context checkpoint"

# gufo, from its server log.
_GUFO_SIGNATURE = ("[cache]", "[loader]", "[http]")
_RETAINED = re.compile(r"retained_bytes=(\d+)")
_CAPACITY = re.compile(r"capacity_bytes=(\d+)")
_SNAPSHOT = re.compile(r"cache_snapshot_bytes=(\d+)")
_GPU_USED = re.compile(r"gpu_device_used_mib=(\d+)")
_GPU_TOTAL = re.compile(r"gpu_device_total_mib=(\d+)")
_HOST_FREE = re.compile(r"host_available_mib=(\d+)")
_RSS = re.compile(r"\brss_mib=(\d+)")
_SKIPPED_FOR_CAPACITY = "reason=byte_capacity"


def _mib(nbytes: int) -> float:
    return round(nbytes / BYTES_PER_MIB, 1)


def _last(pattern: re.Pattern, line: str, into: dict, key: str, convert=int) -> None:
    m = pattern.search(line)
    if m:
        into[key] = convert(m.group(1))


def parse_engine_log(lines: Iterable[str]) -> dict:
    """The engine's own account of its memory, from its log. {} when it is an engine this does not know.

    Streams the lines: a server log for a long run is large, and counts (evictions) need all of it while "latest"
    values need only the last line that carries them.
    """
    evictions, evicted_mib, last_evicted, checkpoints = 0, 0.0, None, 0
    llamacpp = gufo = False
    seen: dict = {}
    skipped = 0
    for line in lines:
        if not llamacpp and any(s in line for s in _LLAMACPP_SIGNATURE):
            llamacpp = True
        if not gufo and any(s in line for s in _GUFO_SIGNATURE):
            gufo = True
        m = _EVICTION.search(line)
        if m:
            evictions += 1
            evicted_mib += float(m.group(1))
            last_evicted = float(m.group(1))
        elif _CHECKPOINT in line:
            checkpoints += 1
        if "retained_bytes=" in line:
            _last(_RETAINED, line, seen, "retained_bytes")
            _last(_CAPACITY, line, seen, "capacity_bytes")
        if _SKIPPED_FOR_CAPACITY in line:
            skipped += 1
        for pattern, key in ((_SNAPSHOT, "snapshot_bytes"), (_GPU_USED, "gpu_used"), (_GPU_TOTAL, "gpu_total"),
                             (_HOST_FREE, "host_free"), (_RSS, "rss")):
            _last(pattern, line, seen, key)

    # gufo's log carries [cache]/[loader]/[http]; llama.cpp's carries "srv". A log with neither is not one we know.
    if gufo and ("retained_bytes" in seen or "gpu_used" in seen or "rss" in seen):
        cache: dict = {}
        if "retained_bytes" in seen:
            cache["retained_mib"] = _mib(seen["retained_bytes"])
        if "capacity_bytes" in seen:
            cache["capacity_mib"] = _mib(seen["capacity_bytes"])
        cache["skipped_for_capacity"] = skipped
        if "snapshot_bytes" in seen:
            cache["last_snapshot_mib"] = _mib(seen["snapshot_bytes"])
        extras = {}
        for src, dst in (("gpu_used", "gpu_device_used_mib"), ("gpu_total", "gpu_device_total_mib"),
                         ("host_free", "host_available_mib"), ("rss", "engine_rss_mib")):
            if src in seen:
                extras[dst] = seen[src]
        return {"engine": "gufo", "prompt_cache": cache, "extras": extras}
    if llamacpp:
        return {"engine": "llama.cpp",
                "prompt_cache": {"evictions": evictions, "evicted_mib": round(evicted_mib, 1),
                                 "last_evicted_mib": round(last_evicted, 1) if last_evicted is not None else None,
                                 "checkpoints_erased": checkpoints}}
    return {}


def _files_under(p: Path) -> list[Path]:
    """The files a path stands for: itself, every shard of a sharded GGUF, or everything inside a directory (an MLX
    model is a directory of safetensors, often links into a cache of blobs)."""
    m = _SHARD.match(p.name)
    if m and p.is_file():
        siblings = [f for f in p.parent.glob(f"{m['stem']}-*-of-{m['of']}.gguf") if _SHARD.match(f.name)]
        return siblings or [p]
    if p.is_file():
        return [p]
    if p.is_dir():
        return [f for f in p.rglob("*") if f.is_file()]
    return []


def weights_bytes(paths: Iterable[Path]) -> int | None:
    """The exact size on disk of what an engine was pointed at.

    A path ending "-00001-of-00003.gguf" stands for all three shards (a different model in the same folder is not
    counted), and a directory for everything in it. Links are followed and a blob that two links reach is counted
    once, so a model stored as links into a blob cache is not counted twice. None when nothing was found: an
    unknown size must not look like a small one.
    """
    total, seen = 0, set()
    for p in map(Path, paths):
        for f in _files_under(p):
            real = f.resolve()
            if real not in seen:
                seen.add(real)
                total += real.stat().st_size
    return total if seen else None


def read_manifest(path: Path) -> dict:
    """install.env as a dict. The installer writes it with printf %q, so a value may be bare, quoted or
    backslash-escaped: shlex reads all three. A missing or unreadable manifest is {}, never an error."""
    import shlex
    env: dict = {}
    try:
        text = Path(path).read_text()
    except OSError:
        return env
    for line in text.splitlines():
        key, eq, value = line.partition("=")
        if not eq or key.startswith("#") or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key.strip()):
            continue
        try:
            parts = shlex.split(value)
        except ValueError:
            parts = [value.strip().strip("\"'")]
        env[key.strip()] = parts[0] if parts else ""
    return env


def weights_from_manifest(env: dict, home: Path, environ: dict | None = None, root: Path | None = None) -> list[Path]:
    """Where the install's weights are.

    The launchers disagree about what MODEL_SUBDIR is relative to -- llama.cpp resolves $ROOT/$MODEL_SUBDIR, ROOT
    being the install's own directory; gufo and mlx-serve resolve $HOME/$MODEL_SUBDIR -- and the first version of
    this assumed one rule and found nothing for llama.cpp. So each candidate base is tried and the one that holds
    the file is used; a directory the manifest's MODEL_CACHE_ENV_VAR points at, as the launchers allow, is the only
    candidate when it is set. A gufo-family manifest (GUFO_MODEL_REL) puts the model under the directory MODEL_FILE
    names, with the draft head beside it. What is not there is simply left out; weights_bytes() then says unknown.
    """
    environ = environ if environ is not None else __import__("os").environ
    sub = env.get("MODEL_SUBDIR", "")
    moved = environ.get(env.get("MODEL_CACHE_ENV_VAR", ""), "")
    bases = [Path(moved)] if moved else [home / sub] + ([root / sub] if root is not None else [])
    model_file = env.get("MODEL_FILE", "")
    gufo_family = bool(env.get("GUFO_MODEL_REL"))
    # The model itself, then what rides with it. In a gufo-family manifest MODEL_FILE is the weights DIRECTORY, which
    # can hold other quants, so only the files the manifest names are the model; anywhere else MODEL_FILE is the model.
    if gufo_family:
        primary = f"{model_file}/{env['GUFO_MODEL_REL']}" if model_file else ""
        extras = [f"{model_file}/{env[k]}" for k in ("GUFO_MTP_REL",) if env.get(k) and model_file]
    else:
        primary = model_file
        extras = [env[k] for k in ("MTP_FILE", "MMPROJ_FILE") if env.get(k)]
    if not primary:
        return []

    def find(rel: str) -> Path | None:
        return next((b / rel for b in bases if (b / rel).exists()), None)

    # A draft head or image projector alone is not the model: reporting it would show a small number that looks like
    # a small model (the 4-bit llama.cpp install on the M5 Max had lost its shards and read 3.44 GiB). No model, no size.
    main = find(primary)
    if main is None:
        return []
    return [main] + [h for h in (find(r) for r in extras) if h is not None]


def take(resident_gb: float | None, server_log: Path, weights: Iterable[Path], at: float) -> dict:
    """A snapshot: when, the server's total resident memory, the weights' exact size, and the engine's own account."""
    snap: dict = {"at": at,
                  "resident_mib": round(resident_gb * MIB_PER_GIB, 1) if resident_gb is not None else None,
                  "model_bytes": weights_bytes(weights)}
    try:
        with open(server_log, errors="replace") as f:
            snap.update(parse_engine_log(f))
    except OSError:
        pass
    return snap
