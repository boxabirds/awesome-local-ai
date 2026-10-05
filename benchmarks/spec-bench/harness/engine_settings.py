"""The settings each engine actually ran with, read from its real command line (run.json "engine_settings").

    python3 identity.py ... | python3 engine_settings.py --requested-effort low --client pi \
        [--client-thinking LEVEL] --context-limit 131072

Reads identity.py's record on stdin (server_command is the engine's own argv, followed into its container)
and prints one JSON object. The parsing is pure (engine_settings()); the CLI only reads stdin and, for
mlx-serve, the served model directory's generation_config.json.

Every setting is {"value", "source", "evidence"}. source is one of SOURCES:
  command line     the flag is on the engine's command line (evidence: the flag and its value)
  model file name  read from the model file's name (quantisation)
  model config     read from a file the engine loads (mlx-serve's generation_config.json; Strata's run configuration)
  client           the client sends it with every request
  engine startup   the engine printed it as it loaded (evidence: the line); for what a setting resolved to at run
                   time, such as the size an "auto" cache actually took
  not set          nothing on the command line sets it; value is "not set", evidence says what applies then
  unknown          it can't be determined; value is "unknown", evidence says why
A value is never inferred from an engine's undocumented defaults: "not set" says only that nothing set it.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

UNKNOWN = "unknown"
NOT_SET = "not set"
SRC_COMMAND = "command line"
SRC_MODEL_NAME = "model file name"
SRC_MODEL_CONFIG = "model config"
SRC_CLIENT = "client"
SRC_ENGINE_START = "engine startup"
SRC_NOT_SET = "not set"
SRC_UNKNOWN = "unknown"
SOURCES = (SRC_COMMAND, SRC_MODEL_NAME, SRC_MODEL_CONFIG, SRC_CLIENT, SRC_ENGINE_START, SRC_NOT_SET, SRC_UNKNOWN)

# Strata prints the hot-expert cache it settled on as it loads:
#   [strata] filling the GPU's expert cache (9094 experts, 14.73 GiB of VRAM) ...
# With "--expert-cache auto" that size is chosen from the VRAM that is free, so it is a fact of the run, not a
# setting, and two runs of one combination can differ (A-045).
STRATA_CACHE_RE = re.compile(r"filling the GPU's expert cache \((\d+) experts, ([\d.]+) GiB of VRAM\)")

SETTING_KEYS = ("thinking_mode", "thinking_budget", "context_size", "kv_cache_type", "speculative",
                "temperature", "top_p", "top_k", "min_p", "quantisation")
# Recorded only for the engines that have them; see engine_settings().
ENGINE_ONLY_KEYS = ("expert_cache",)
THINKING_OFF = "thinking off"
REQUESTED_DEFAULT = "default"   # the launchers' word for "leave the template's own effort"

# GGUF quant names (Q4_K_M, UD-Q4_K_XL, IQ4_XS, Q8_0, F16, BF16, MXFP4) and MLX ones (4bit, mixed-4-8bit)
_GGUF_QUANT = re.compile(r"(?<![A-Za-z0-9])((?:UD-)?(?:I?Q\d+(?:_[A-Z0-9]+)*|BF16|F16|F32|MXFP4))(?![A-Za-z0-9])")
_MLX_QUANT = re.compile(r"(?<![A-Za-z0-9])(mixed-\d+-\d+bit|\d+bit)(?![A-Za-z0-9])")


# ---------- setting constructors ----------

def _set(value, source: str, evidence: str) -> dict:
    return {"value": value, "source": source, "evidence": evidence}


def _flag(value, flag: str, raw: str | None = None) -> dict:
    return _set(value, SRC_COMMAND, f"{flag} {raw if raw is not None else value}".strip())


def _not_set(evidence: str) -> dict:
    return _set(NOT_SET, SRC_NOT_SET, evidence)


def _unknown(why: str) -> dict:
    return _set(UNKNOWN, SRC_UNKNOWN, why)


# ---------- reading a command line ----------

def _match(arg: str, names: tuple[str, ...]) -> tuple[bool, str | None]:
    """(is this flag, its joined =value if any)."""
    for n in names:
        if arg == n:
            return True, None
        if arg.startswith(n + "="):
            return True, arg[len(n) + 1:]
    return False, None


def flag_value(argv: list[str], names: tuple[str, ...]) -> str | None:
    """The value of the last of these flags (engines take the last), from `--f v` or `--f=v`; None if absent."""
    found = None
    for i, a in enumerate(argv):
        hit, joined = _match(a, names)
        if hit:
            found = joined if joined is not None else (argv[i + 1] if i + 1 < len(argv) else None)
    return found


def has_flag(argv: list[str], names: tuple[str, ...]) -> bool:
    return any(a in names for a in argv)


def _flag_name(argv: list[str], names: tuple[str, ...]) -> str:
    """Which of the names was used last (for evidence)."""
    used = names[0]
    for a in argv:
        for n in names:
            if a == n or a.startswith(n + "="):
                used = n
    return used


def _num(raw: str):
    try:
        return int(raw)
    except ValueError:
        try:
            return float(raw)
        except ValueError:
            return raw


def _numeric(argv, names, absent: str) -> dict:
    raw = flag_value(argv, names)
    if raw is None:
        return _not_set(absent)
    return _flag(_num(raw), _flag_name(argv, names), raw)


def quant_from_name(name: str) -> str | None:
    base = Path(name).name
    for rx in (_GGUF_QUANT, _MLX_QUANT):
        m = rx.search(base)
        if m:
            return m.group(1)
    return None


def _quant(path: str | None, flag: str) -> dict:
    if not path:
        return _unknown(f"no {flag} on the command line to name the model file")
    q = quant_from_name(path)
    if q is None:
        return _unknown(f"the model name {Path(path).name} states no quantisation")
    return _set(q, SRC_MODEL_NAME, Path(path).name)


def _sampling(argv, names_by_key: dict[str, tuple[str, ...]], engine: str) -> dict:
    return {k: _numeric(argv, names, f"no {'/'.join(names)} on the command line: {engine}'s own default applies")
            for k, names in names_by_key.items()}


def _template_kwargs(argv, flag="--chat-template-kwargs") -> dict:
    raw = flag_value(argv, (flag,))
    try:
        kw = json.loads(raw) if raw else {}
    except ValueError:
        kw = {}
    return kw if isinstance(kw, dict) else {}


def _on_off(raw: str) -> str:
    return {"true": "on", "1": "on", "false": "off", "0": "off"}.get(raw.lower(), raw.lower())


# ---------- per engine: argv -> settings (plus the engine's own effort) ----------

def parse_llamacpp(argv: list[str]) -> dict:
    kw = _template_kwargs(argv)
    s = _sampling(argv, {"temperature": ("--temp", "--temperature"), "top_p": ("--top-p",),
                         "top_k": ("--top-k",), "min_p": ("--min-p",)}, "llama.cpp")
    s["context_size"] = _numeric(argv, ("-c", "--ctx-size"), "no -c/--ctx-size: llama.cpp takes the model's own context")
    k, v = flag_value(argv, ("-ctk", "--cache-type-k")), flag_value(argv, ("-ctv", "--cache-type-v"))
    s["kv_cache_type"] = (_set({"k": k or NOT_SET, "v": v or NOT_SET}, SRC_COMMAND, f"--cache-type-k {k} --cache-type-v {v}")
                          if k or v else _not_set("no --cache-type-k/-v: llama.cpp's default cache type applies"))
    reasoning = flag_value(argv, ("--reasoning", "-rea"))
    if reasoning is not None:
        s["thinking_mode"] = _flag(_on_off(reasoning), "--reasoning", reasoning)
    elif "enable_thinking" in kw:
        s["thinking_mode"] = _flag(_on_off(str(kw["enable_thinking"])), "--chat-template-kwargs enable_thinking",
                                   json.dumps(kw["enable_thinking"]))
    else:
        s["thinking_mode"] = _unknown("no --reasoning flag or enable_thinking kwarg: the chat template's own default "
                                      "applies, which the command line doesn't show")
    s["thinking_budget"] = _numeric(argv, ("--reasoning-budget",),
                                    "no --reasoning-budget: thinking is bounded only by the output limit")
    stype, draft_model = flag_value(argv, ("--spec-type",)), flag_value(argv, ("-md", "--model-draft"))
    if stype or draft_model:
        spec = {"method": stype or "draft model"}
        n = flag_value(argv, ("--spec-draft-n-max", "--draft-max", "--draft"))
        if n is not None:
            spec["draft_max"] = _num(n)
        p = flag_value(argv, ("--spec-draft-p-min", "--draft-p-min"))
        if p is not None:
            spec["p_min"] = _num(p)
        if draft_model and quant_from_name(draft_model):
            spec["draft_quantisation"] = quant_from_name(draft_model)
        ev = " ".join(f"{f} {flag_value(argv, (f,))}" for f in ("--spec-type", "-md", "--spec-draft-n-max",
                                                               "--spec-draft-p-min") if flag_value(argv, (f,)))
        s["speculative"] = _set(spec, SRC_COMMAND, ev)
    else:
        s["speculative"] = _not_set("no --spec-type or draft model: no speculative decoding")
    s["quantisation"] = _quant(flag_value(argv, ("-m", "--model")), "-m")
    effort = flag_value(argv, ("--reasoning-effort",))
    if effort is not None:
        s["engine_effort"] = _flag(effort, "--reasoning-effort")
    elif "reasoning_effort" in kw:
        s["engine_effort"] = _flag(kw["reasoning_effort"], "--chat-template-kwargs reasoning_effort")
    else:
        s["engine_effort"] = _not_set("no --reasoning-effort: llama.cpp passes none to the chat template")
    s["effort_note"] = "the chat template's own default effort applies"
    return s


def parse_gufo(argv: list[str]) -> dict:
    s = _sampling(argv, {"temperature": ("--temperature",), "top_p": ("--top-p",), "top_k": ("--top-k",),
                         "min_p": ("--min-p",)}, "gufo")
    s["context_size"] = _numeric(argv, ("--context",), "no --context: gufo's own default applies")
    s["kv_cache_type"] = _unknown("gufo's CLI has no KV-cache type switch (lib/gufo.sh), and the type it uses "
                                  "internally isn't on the command line")
    think = flag_value(argv, ("--think",))
    s["thinking_mode"] = (_flag(_on_off(think), "--think", think) if think is not None
                          else _unknown("no --think flag: gufo's default thinking mode isn't on the command line"))
    s["thinking_budget"] = _numeric(argv, ("--reasoning-budget", "--thinking-budget"),
                                    "no thinking-budget flag on gufo's command line (the launcher has none to set)")
    method = flag_value(argv, ("--speculative",))
    if method is not None:
        spec = {"method": method}
        n = flag_value(argv, ("--draft-tokens",))
        if n is not None:
            spec["draft_max"] = _num(n)
        head = flag_value(argv, ("--mtp-model",))
        if head and quant_from_name(head):
            spec["draft_quantisation"] = quant_from_name(head)
        s["speculative"] = _set(spec, SRC_COMMAND, f"--speculative {method}" + (f" --draft-tokens {n}" if n else ""))
    else:
        s["speculative"] = _not_set("no --speculative: gufo's default applies")
    s["quantisation"] = _quant(flag_value(argv, ("--model",)), "--model")
    effort = flag_value(argv, ("--reasoning-effort",))
    s["engine_effort"] = (_flag(effort, "--reasoning-effort") if effort is not None
                          else _not_set("no --reasoning-effort: gufo passes none to the chat template"))
    s["effort_note"] = "the chat template's own default effort applies"
    return s


def parse_mlxserve(argv: list[str], generation_config: dict | None = None, model_dir: str | None = None) -> dict:
    s = _sampling(argv, {"temperature": ("--temp", "--temperature"), "top_p": ("--top-p",), "top_k": ("--top-k",),
                         "min_p": ("--min-p",)}, "mlx-serve")
    s["context_size"] = _numeric(argv, ("--ctx-size",), "no --ctx-size: mlx-serve's own default applies")
    kv = flag_value(argv, ("--kv-quant",))
    s["kv_cache_type"] = _flag(kv, "--kv-quant") if kv is not None else _not_set("no --kv-quant: mlx-serve's default applies")
    kw = (generation_config or {}).get("default_chat_template_kwargs") if isinstance(generation_config, dict) else None
    if generation_config is None:
        s["thinking_mode"] = _unknown("the served directory's generation_config.json couldn't be read; mlx-serve takes "
                                      "its thinking default from there")
    elif isinstance(kw, dict) and "enable_thinking" in kw:
        s["thinking_mode"] = _set("on" if kw["enable_thinking"] else "off", SRC_MODEL_CONFIG,
                                  f"generation_config.json default_chat_template_kwargs.enable_thinking="
                                  f"{json.dumps(kw['enable_thinking'])}")
    else:
        s["thinking_mode"] = _unknown("generation_config.json names no enable_thinking: mlx-serve's architecture "
                                      "default applies (model.zig), which the command line doesn't show")
    s["thinking_budget"] = _numeric(argv, ("--reasoning-budget",),
                                    "no --reasoning-budget: per lib/runtime/server-mlxserve.sh mlx-serve then caps a "
                                    "request that names no effort at 2048 thinking tokens")
    if has_flag(argv, ("--no-mtp",)):
        s["speculative"] = _set("off", SRC_COMMAND, "--no-mtp")
    elif has_flag(argv, ("--mtp",)):
        s["speculative"] = _set({"method": "mtp"}, SRC_COMMAND, "--mtp (draft depth is mlx-serve's own)")
    else:
        s["speculative"] = _not_set("neither --mtp nor --no-mtp: mlx-serve's default applies")
    served = flag_value(argv, ("--model",))
    s["quantisation"] = _quant(model_dir or served, "--model")
    effort = flag_value(argv, ("--reasoning-effort",))
    s["engine_effort"] = (_flag(effort, "--reasoning-effort") if effort is not None
                          else _not_set("mlx-serve has no server-side reasoning-effort setting "
                                        "(lib/runtime/server-mlxserve.sh)"))
    s["effort_note"] = ("mlx-serve renders a request that names no effort by its template's rule; "
                        "lib/runtime/server-mlxserve.sh reads that as 'low' on Qwen3.8 (chat.zig), unverified here")
    return s


def _strata_arg(args: list[str], flag: str) -> str | None:
    return flag_value(args, (flag,))


def _strata_expert_cache(args: list[str], startup: str | None) -> dict:
    """The expert cache the engine settled on, from what it printed as it loaded, with what was asked for beside it.
    Never guessed: without the line the value is unknown and says why."""
    asked = _strata_arg(args, "--expert-cache")
    if not startup:
        return _unknown("Strata's server log for this start wasn't available, and the size it settled on is only in "
                        "what it printed as it loaded")
    m = STRATA_CACHE_RE.search(startup)
    if not m:
        return _unknown("Strata's server log has no expert cache line for this start, so the size it settled on "
                        "can't be told")
    value = {"requested": asked or NOT_SET, "experts": int(m.group(1)), "vram_gib": float(m.group(2))}
    return _set(value, SRC_ENGINE_START, f"server log: {m.group(0)}")


def parse_strata(config: dict | None, shared: dict | None, startup: str | None = None) -> dict:
    """Strata's server (`python serve/server.py --engine strata --config strata-run.json`) takes its settings from that
    JSON, not from flags: the engine's own flags are its "args", sampling is its "sampling" block, and the server-side
    reasoning effort is in the shared-settings file beside it. A configuration that could not be read leaves every
    setting unknown, with why."""
    if not isinstance(config, dict):
        return _all_unknown("Strata's run configuration (the --config file) couldn't be read, and its settings are "
                            "in that file, not on the command line")
    args = [str(a) for a in config.get("args") or []]
    ev = lambda *flags: " ".join(f"{f} {_strata_arg(args, f)}" for f in flags if _strata_arg(args, f) is not None)
    s = {}
    sampling = config.get("sampling") if isinstance(config.get("sampling"), dict) else {}
    for key in ("temperature", "top_p", "top_k", "min_p"):
        s[key] = (_set(sampling[key], SRC_MODEL_CONFIG, f"run configuration sampling.{key}={sampling[key]}")
                  if sampling.get(key) is not None
                  else _not_set(f"no sampling.{key} in Strata's run configuration: its own default applies"))
    ctx = _strata_arg(args, "--max-context")
    s["context_size"] = (_set(_num(ctx), SRC_MODEL_CONFIG, f"run configuration args: --max-context {ctx}") if ctx
                         else _not_set("no --max-context in Strata's engine arguments: its own default applies"))
    kv = _strata_arg(args, "--kv")
    s["kv_cache_type"] = (_set(kv, SRC_MODEL_CONFIG, f"run configuration args: --kv {kv}") if kv
                          else _not_set("no --kv in Strata's engine arguments: its default (fp16) applies"))
    s["thinking_mode"] = _unknown("Strata's thinking default isn't in its configuration: the chat template's own "
                                  "default applies, which the files don't show")
    budget = config.get("reasoning_budget_tokens")
    s["thinking_budget"] = (_set(budget, SRC_MODEL_CONFIG, f"run configuration reasoning_budget_tokens={budget}")
                            if budget is not None else _not_set("no reasoning_budget_tokens in Strata's run "
                                                                 "configuration: thinking is bounded only by the output limit"))
    if "--mtp" in args or _strata_arg(args, "--spec") is not None:
        spec = {"method": "mtp"} if "--mtp" in args else {"method": "suffix drafting"}
        n, p = _strata_arg(args, "--spec"), _strata_arg(args, "--spec-min-p")
        if n is not None:
            spec["draft_max"] = _num(n)
        if p is not None:
            spec["p_min"] = _num(p)
        s["speculative"] = _set(spec, SRC_MODEL_CONFIG, "run configuration args: " + ev("--spec", "--spec-min-p") +
                                (" --mtp" if "--mtp" in args else ""))
    else:
        s["speculative"] = _not_set("no --mtp or --spec in Strata's engine arguments: no speculative decoding")
    native = _strata_arg(args, "--native")
    s["quantisation"] = _quant(native, "--native")
    s["expert_cache"] = _strata_expert_cache(args, startup)
    effort = (shared or {}).get("reasoning_effort") if isinstance(shared, dict) else None
    s["engine_effort"] = (_set(effort, SRC_MODEL_CONFIG, f"shared settings reasoning_effort={effort}") if effort
                          else _not_set("no reasoning_effort in Strata's shared settings: it passes none to the chat template"))
    s["effort_note"] = "the chat template's own default effort applies"
    return s


def parse_mtplx(argv: list[str]) -> dict:
    """Both shapes: the launcher's `mtplx serve` (--default-temperature, --reasoning on) and the
    `python -m mtplx.server.openai` process that listens on the port (--temperature, --reasoning-mode on)."""
    s = _sampling(argv, {"temperature": ("--default-temperature", "--temperature"),
                         "top_p": ("--default-top-p", "--top-p"), "top_k": ("--default-top-k", "--top-k"),
                         "min_p": ("--default-min-p", "--min-p")}, "MTPLX")
    s["context_size"] = _numeric(argv, ("--context-window",), "no --context-window: MTPLX's own default applies")
    kv = flag_value(argv, ("--paged-kv-quantization", "--kv-quant"))
    s["kv_cache_type"] = (_flag(kv, _flag_name(argv, ("--paged-kv-quantization", "--kv-quant")), kv) if kv is not None
                          else _not_set("no KV quantisation flag: MTPLX's default applies"))
    mode = flag_value(argv, ("--reasoning", "--reasoning-mode"))
    if mode is not None:
        s["thinking_mode"] = _flag(_on_off(mode), _flag_name(argv, ("--reasoning", "--reasoning-mode")), mode)
    elif has_flag(argv, ("--enable-thinking",)):
        s["thinking_mode"] = _set("on", SRC_COMMAND, "--enable-thinking")
    else:
        s["thinking_mode"] = _unknown("no --reasoning flag: MTPLX's default mode is 'auto', which the command line "
                                      "doesn't resolve")
    s["thinking_budget"] = _numeric(argv, ("--reasoning-budget", "--thinking-budget"),
                                    "no thinking-budget flag: thinking is bounded only by --max-tokens")
    depth, gen = flag_value(argv, ("--depth",)), flag_value(argv, ("--generation-mode",))
    if gen == "ar":
        s["speculative"] = _set("off", SRC_COMMAND, "--generation-mode ar")
    elif depth is not None:
        s["speculative"] = _set({"method": "mtp", "depth": _num(depth)}, SRC_COMMAND,
                                f"--depth {depth}" + (f" --generation-mode {gen}" if gen else ""))
    else:
        s["speculative"] = _not_set("no --depth: MTPLX's profile default applies")
    s["quantisation"] = _quant(flag_value(argv, ("--model",)), "--model")
    effort = flag_value(argv, ("--reasoning-effort",))
    s["engine_effort"] = (_flag(effort, "--reasoning-effort") if effort is not None
                          else _not_set("no --reasoning-effort: MTPLX's default 'auto' applies "
                                        "(docs/discovery-macos-mtplx.md: it resolves to medium)"))
    s["effort_note"] = "MTPLX's own default effort applies"
    return s


# How each engine's own process shows on a command line: the binary's name, or MTPLX's Python module.
ENGINE_MARKERS = {"llamacpp": ("llama-server",), "gufo": ("gufo",), "mlxserve": ("mlx-serve",),
                  "mtplx": ("mtplx", "mtplx.server")}
# Strata's listener is `python serve/server.py --engine strata`; the engine binary is a child it starts.
STRATA_SERVER_SCRIPT = "server.py"


def is_engine_argv(backend: str, argv: list[str]) -> bool:
    """Whether argv is the engine's own process, not a wrapper or helper (e.g. Podman's pasta, which older
    records hold for gufo): its binary is named for the engine, or, for MTPLX, it runs mtplx's module."""
    if backend == "strata":
        return any(Path(a).name == STRATA_SERVER_SCRIPT for a in argv[1:2]) and flag_value(argv, ("--engine",)) == "strata"
    marks = ENGINE_MARKERS.get(backend, ())
    exe = Path(argv[0]).name if argv else ""
    if exe in marks:
        return True
    return backend == "mtplx" and "-m" in argv and any(argv[i + 1].startswith("mtplx.")
                                                      for i, a in enumerate(argv[:-1]) if a == "-m")


ENGINES = {"llamacpp": ("llama.cpp", parse_llamacpp), "gufo": ("gufo", parse_gufo),
           "mlxserve": ("mlx-serve", parse_mlxserve), "mtplx": ("MTPLX", parse_mtplx),
           "strata": ("Strata", None)}
CLOUD_BACKENDS = {"anthropic"}


# ---------- reasoning effort: requested, engine, client, effective ----------

def client_effort(client: str, client_thinking: str | None) -> dict:
    if client == "pi":
        if client_thinking:
            return _set(client_thinking, SRC_CLIENT, f"pi --thinking {client_thinking}")
        return _not_set("pi runs without --thinking and sends no reasoning effort (clients.py)")
    if client == "opencode":
        return _not_set("OpenCode drops reasoning_effort from an agent's options before the request leaves "
                        "(docs/discovery-macos-mtplx.md)")
    if client == "claude":
        return _unknown("Claude Code uses its own default effort, which the harness doesn't record")
    return _unknown(f"client {client!r}: what it sends isn't known to this module")


def resolve_effort(requested: str, engine: dict, client: dict, thinking_mode: dict, note: str) -> dict:
    """A per-request effort wins over the engine's default; with thinking off, no effort applies."""
    if client["source"] == SRC_CLIENT:
        effective = _set(client["value"], SRC_CLIENT, client["evidence"])
    elif thinking_mode["value"] == "off":
        effective = _set(THINKING_OFF, thinking_mode["source"], thinking_mode["evidence"])
    elif engine["source"] in (SRC_COMMAND, SRC_MODEL_CONFIG):
        effective = _set(engine["value"], engine["source"], engine["evidence"])
    elif engine["source"] == SRC_UNKNOWN:
        effective = _unknown(engine["evidence"])
    else:
        effective = _unknown(f"neither the engine's command line nor the client sets an effort: {note}. "
                             f"Engine: {engine['evidence']}. Client: {client['evidence']}")
    if effective["source"] != SRC_UNKNOWN:
        matches = effective["value"] == requested
    elif requested == REQUESTED_DEFAULT and engine["source"] == SRC_NOT_SET and client["source"] == SRC_NOT_SET:
        matches = True
    else:
        matches = None
    return {"requested": requested, "engine": engine, "client": client, "effective": effective,
            "matches_request": matches}


def gaps(s: dict, context_limit: int | None) -> list[str]:
    """Where what the owner asked for is not what the engine was given."""
    out = []
    r = s["reasoning_effort"]
    if s["engine"] not in CLOUD_BACKENDS and r["matches_request"] is not True and r["requested"] != REQUESTED_DEFAULT:
        eff = r["effective"]
        how = (f"'{eff['value']}' applied ({eff['source']})" if eff["source"] != SRC_UNKNOWN
               else "neither the engine nor the client applies one")
        out.append(f"reasoning effort: '{r['requested']}' requested, {how}")
    ctx = s["context_size"]
    if context_limit and s["engine"] not in CLOUD_BACKENDS:
        if ctx["source"] != SRC_COMMAND:
            out.append(f"context: {context_limit} requested, not on the engine's command line")
        elif ctx["value"] != context_limit:
            out.append(f"context: {context_limit} requested, {ctx['value']} served")
    return out


# ---------- the record ----------

def _all_unknown(why: str) -> dict:
    s = {k: _unknown(why) for k in SETTING_KEYS}
    s["engine_effort"] = _unknown(why)
    s["effort_note"] = why
    return s


def engine_settings(backend: str | None, argv: list[str] | None, version: str | None, *, requested_effort: str,
                    client: str, client_thinking: str | None, context_limit: int | None,
                    generation_config: dict | None = None, model_dir: str | None = None,
                    extra_config: dict | None = None, startup: str | None = None) -> dict:
    name = ENGINES.get(backend or "", (backend or "unknown", None))[0]
    if backend in CLOUD_BACKENDS:
        parsed = _all_unknown(f"cloud backend {backend}: no local engine, and the provider's settings aren't observable")
    elif not argv:
        parsed = _all_unknown("no engine command line was found for the benchmark port (identity.server_command is null)")
    elif backend not in ENGINES:
        parsed = _all_unknown(f"no settings parser for backend {backend!r} yet; its command line is in identity")
    elif not is_engine_argv(backend, argv):
        parsed = _all_unknown(f"the recorded command line ({Path(argv[0]).name}) is not {name}'s own process, "
                              f"so its flags aren't the engine's settings")
    elif backend == "mlxserve":
        parsed = parse_mlxserve(argv, generation_config, model_dir)
    elif backend == "strata":
        parsed = parse_strata(generation_config, extra_config, startup)
    else:
        parsed = ENGINES[backend][1](argv)
    s = {"engine": backend if backend in CLOUD_BACKENDS else name, "engine_version": version,
         **{k: parsed[k] for k in SETTING_KEYS}}
    # Settings only one engine has. They are left out where they would mean nothing rather than recorded as "not set"
    # everywhere: expert_cache belongs to an engine that keeps experts outside VRAM.
    for k in ENGINE_ONLY_KEYS:
        if k in parsed:
            s[k] = parsed[k]
    s["reasoning_effort"] = resolve_effort(requested_effort, parsed["engine_effort"],
                                           client_effort(client, client_thinking), parsed["thinking_mode"],
                                           parsed["effort_note"])
    s["gaps"] = gaps(s, context_limit)
    return s


def for_story(run_dir: Path) -> dict | None:
    """The settings the story runs under: those of the run's current start (run.json is rewritten at every start,
    the previous one kept in run-history.jsonl), stamped with that start's time. None if the run has none."""
    try:
        run = json.loads((Path(run_dir) / "run.json").read_text())
    except (OSError, ValueError):
        return None
    es = run.get("engine_settings")
    if not isinstance(es, dict):
        return None
    return {"server_started_at": run.get("started_at"), **es}


# ---------- thin CLI ----------

def _expand(path: str) -> Path:
    return Path(os.path.expanduser(path)) if path.startswith("~") else Path(path)


def _mlx_files(argv: list[str]) -> tuple[dict | None, str | None]:
    """The served directory's generation_config.json, and the real model directory its links point into."""
    served = flag_value(argv, ("--model",))
    if not served:
        return None, None
    d = _expand(served)
    try:
        gen = json.loads((d / "generation_config.json").read_text())
    except (OSError, ValueError):
        gen = None
    cfg = d / "config.json"
    real = str(cfg.resolve().parent) if cfg.is_symlink() else None
    return gen, real


def _strata_files(argv: list[str]) -> tuple[dict | None, dict | None]:
    """Strata's run configuration (the --config file) and the shared-settings file beside it, or None for either that
    isn't there."""
    path = flag_value(argv, ("--config",))
    if not path:
        return None, None
    p = _expand(path)
    out = []
    for f in (p, p.with_suffix("").with_name(p.with_suffix("").name + ".shared-settings.json")):
        try:
            out.append(json.loads(f.read_text()))
        except (OSError, ValueError):
            out.append(None)
    return out[0], out[1]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--requested-effort", default=REQUESTED_DEFAULT)
    ap.add_argument("--client", default="pi")
    ap.add_argument("--client-thinking", default="")
    ap.add_argument("--context-limit", type=int, default=0)
    ap.add_argument("--startup-log", default="",
                    help="the server's own log for this start; the engine's load-time facts are read from it")
    a = ap.parse_args()
    try:
        ident = json.loads(sys.stdin.read() or "null") or {}
        try:
            startup = Path(_expand(a.startup_log)).read_text(errors="replace") if a.startup_log else None
        except OSError:
            startup = None   # the record says the size is unknown, and why
        argv = ident.get("server_command")
        gen, real = _mlx_files(argv) if ident.get("backend") == "mlxserve" and argv else (None, None)
        extra = None
        if ident.get("backend") == "strata" and argv:
            gen, extra = _strata_files(argv)
        rec = engine_settings(ident.get("backend"), argv, ident.get("engine_version"),
                              requested_effort=a.requested_effort, client=a.client, client_thinking=a.client_thinking,
                              context_limit=a.context_limit or None, generation_config=gen, model_dir=real,
                              extra_config=extra, startup=startup)
    except Exception as e:  # never stop a run over its record
        rec = {"error": f"{type(e).__name__}: {e}"}
    print(json.dumps(rec))
    return 0


if __name__ == "__main__":
    sys.exit(main())
