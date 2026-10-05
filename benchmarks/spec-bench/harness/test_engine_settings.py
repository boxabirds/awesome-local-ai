"""engine_settings.py: the settings each engine actually ran with, read from its real command line.

Organised so each concern is tested once (MECE):
  1. reading flags off a command line
  2. quantisation from model file names
  3. each engine's parser, on command lines taken from this repo's records and launchers
  4. reasoning effort: requested vs applied by the engine vs applied by the client
  5. intended-vs-applied gaps
  6. the unknown discipline: every setting says where it came from, and unknown always says why
  7. the thin CLI and the per-story lookup
Command lines below are copied from real run.json records (identity.server_command) where one exists,
else built exactly as the launcher in lib/runtime/ builds them from the combination's config.sh."""
import json
import subprocess
import sys
from pathlib import Path

import pytest

import engine_settings as E

# --- real-shaped command lines -------------------------------------------------------------------

# the RTX 4090 machine, swift15-qwen38-27b, vidi v2-r1 run.json identity.server_command (verbatim)
LLAMA_SWIFT = ["~/.local/share/swift15-qwen38-27b/llama.cpp/build/bin/llama-server", "-m",
               "~/.local/share/swift15-qwen38-27b/models/Swift-1.5-Qwen3.8-27B-Q4_K_M.gguf", "-a",
               "qwen3.8-swift-1.5-27b", "-ngl", "99", "-c", "131072", "-fa", "on", "--jinja", "--cache-type-k",
               "q4_0", "--cache-type-v", "q4_0", "-np", "1", "-ub", "256", "-b", "1024", "--host", "127.0.0.1",
               "--port", "18010", "--temp", "1.0", "--top-p", "0.95", "--top-k", "20", "--min-p", "0.0",
               "--reasoning-effort", "low", "--spec-type", "draft-mtp", "--spec-draft-n-max", "4"]
LLAMA_SWIFT_VERSION = "version: 0.5.0-dev (build 1, commit 6a2743f)"

# Strix Halo/Mac flash-next llamacpp-pi: server-llamacpp.sh with a separate MTP head (-md), SPEC_DRAFT_P_MIN=0.0
# and LLAMA_EXTRA_ARGS="-lm dio --ctx-checkpoints 8", QUANT=UD-IQ4_XS, MTP_QUANT=shared-Q8_0
LLAMA_FLASH = ["~/.local/share/qwen38-flash-next/llama.cpp/build/bin/llama-server",
               "-m", "~/models/Qwen3.8-Flash-Next-GGUF/UD-IQ4_XS/Qwen3.8-Flash-Next-UD-IQ4_XS-00001-of-00003.gguf",
               "-a", "qwen3.8-flash-next", "-ngl", "99", "-c", "131072", "-fa", "on", "--jinja",
               "--cache-type-k", "f16", "--cache-type-v", "f16", "-np", "1", "-ub", "512", "-b", "1024",
               "--host", "127.0.0.1", "--port", "18010", "--temp", "1.0", "--top-p", "0.95", "--top-k", "20",
               "--min-p", "0.0", "--reasoning-effort", "low",
               "-md", "~/models/Qwen3.8-Flash-Next-GGUF/MTP/mtp-Qwen3.8-Flash-Next-shared-Q8_0.gguf",
               "--spec-type", "draft-mtp", "--spec-draft-n-max", "4", "--spec-draft-ngl", "99",
               "--spec-draft-type-k", "f16", "--spec-draft-type-v", "f16", "--spec-draft-p-min", "0.0",
               "-lm", "dio", "--ctx-checkpoints", "8"]

# server-llamacpp.sh with THINKING=0: `--reasoning off` and the instruct sampler; SPEC_MTP=0 (no --spec-type)
LLAMA_NO_THINK = ["llama-server", "-m", "m/Qwen3.8-27B-Q8_0.gguf", "-c", "65536", "--jinja",
                  "--reasoning", "off", "--temp", "0.7", "--top-p", "0.80", "--top-k", "20", "--min-p", "0.0",
                  "--presence-penalty", "1.5"]

# gufo inside its container: server-gufo.sh's ARGS for the gufo-pi config (profile coding: 131072|1|7|512),
# as `podman inspect` gives them (Path "gufo", Args the rest)
GUFO = ["gufo", "serve", "--host", "0.0.0.0", "--port", "8080", "--sessions", "1", "llm",
        "--model", "/models/UD-Q4_K_XL/Qwen3.8-Flash-Next-UD-Q4_K_XL-00001-of-00004.gguf",
        "--mtp-model", "/models/MTP/mtp-Qwen3.8-Flash-Next-shared-Q8_0.gguf", "--speculative", "mtp",
        "--draft-tokens", "7", "--context", "131072", "--prefill-chunk", "512",
        "--served-model-name", "qwen3.8-flash-next-gufo", "--think", "on", "--temperature", "1.0",
        "--top-p", "0.95", "--top-k", "20", "--min-p", "0.0", "--reasoning-effort", "low"]
GUFO_VERSION = "gufo b722a61"

# Mac, mlxserve-qwen38-flash-next, vidi v2-r1 run.json identity.server_command (verbatim)
MLX = ["~/.local/share/awesome-local-ai/mlx-serve/v26.9.6/mlx-serve-macos-arm64/mlx-serve", "--model",
       "~/.local/share/mlxserve-qwen38-flash-next/served/mlxserve-flash-next-mixed-4-8bit", "--serve", "--host",
       "127.0.0.1", "--port", "18010", "--ctx-size", "131072", "--max-tokens", "32768", "--kv-quant", "off",
       "--max-concurrent", "1", "--max-resident-models", "1", "--os-reserve-gib", "16", "--mtp", "--no-vision",
       "--reasoning-budget", "32768", "--prefix-cache-mem", "16GB", "--temp", "1.0", "--top-p", "0.95",
       "--top-k", "20"]
MLX_VERSION = "mlx-serve 26.9.6"
MLX_GENCFG_ON = {"eos_token_id": [1], "default_chat_template_kwargs": {"enable_thinking": True}}

# the M5 Max, MTPLX 2.12.0: the listening process as `ps` shows it (docs/20260924-mtplx-memory-report.md)
MTPLX_PY = ["python", "-m", "mtplx.server.openai", "--model",
            "~/.mtplx/models/Youssofal--Qwen3.8-Flash-Next-MTPLX-Optimized-Speed", "--backend-id", "native_mtp",
            "--host", "127.0.0.1", "--port", "18010", "--depth", "3", "--generation-mode", "mtp", "--profile",
            "turbo", "--reasoning-mode", "on", "--preserve-thinking", "auto", "--verify-strategy", "batched",
            "--model-id", "mtplx-flash-next-optimized-speed", "--paged-kv-quantization", "off", "--no-auth",
            "--context-window", "131072", "--draft-temperature", "1.0", "--draft-top-p", "0.95",
            "--draft-top-k", "20", "--max-response-tokens", "32768", "--temperature", "1.0", "--top-p", "0.95",
            "--top-k", "20", "--enable-thinking", "--reasoning-parser", "qwen3", "--reasoning-effort", "low"]
# the same stack as server-mtplx.sh execs it (`mtplx serve`, SAMPLING_THINKING with --default-*)
MTPLX_CLI = ["mtplx", "serve", "--model", "~/.mtplx/models/Youssofal--Qwen3.8-Flash-Next-MTPLX-Optimized-Speed",
             "--model-id", "mtplx-flash-next-optimized-speed", "--cache-dir", "~/.mtplx/models", "--host",
             "127.0.0.1", "--port", "18010", "--depth", "3", "--context-window", "131072", "--max-tokens", "32768",
             "--yes", "--no-auth", "--reasoning", "on", "--default-temperature", "1.0", "--default-top-p", "0.95",
             "--default-top-k", "20", "--reasoning-effort", "low"]
MTPLX_VERSION = "mtplx 2.12.0"


def settings(backend, argv, version=None, **kw):
    kw.setdefault("requested_effort", "low")
    kw.setdefault("client", "pi")
    kw.setdefault("client_thinking", "")
    kw.setdefault("context_limit", 131072)
    return E.engine_settings(backend, argv, version, **kw)


def val(s, key):
    return s[key]["value"]


# --- 1. reading flags ----------------------------------------------------------------------------

class TestFlags:
    def test_a_flag_followed_by_its_value(self):
        assert E.flag_value(["x", "-c", "4096"], ("-c", "--ctx-size")) == "4096"

    def test_a_flag_joined_to_its_value_with_equals(self):
        assert E.flag_value(["x", "--ctx-size=4096"], ("-c", "--ctx-size")) == "4096"

    def test_the_last_occurrence_wins_as_it_does_for_the_engines(self):
        # the launchers append "$@" after the profile's flags, so a later flag is an override
        assert E.flag_value(["x", "--temp", "1.0", "--temp", "0.6"], ("--temp",)) == "0.6"

    def test_a_flag_is_matched_exactly_not_by_prefix(self):
        assert E.flag_value(["x", "--reasoning-effort", "low"], ("--reasoning",)) is None

    def test_an_absent_flag_or_one_with_no_value_left_is_none(self):
        assert E.flag_value(["x", "--port", "1"], ("--temp",)) is None
        assert E.flag_value(["x", "--temp"], ("--temp",)) is None

    def test_a_switch_is_present_or_not(self):
        assert E.has_flag(MLX, ("--mtp",)) and not E.has_flag(MLX, ("--no-mtp",))


# --- 2. quantisation from names ------------------------------------------------------------------

@pytest.mark.parametrize("name, quant", [
    ("Swift-1.5-Qwen3.8-27B-Q4_K_M.gguf", "Q4_K_M"),
    ("UD-Q4_K_XL/Qwen3.8-Flash-Next-UD-Q4_K_XL-00001-of-00004.gguf", "UD-Q4_K_XL"),
    ("Qwen3.8-Flash-Next-UD-IQ4_XS-00001-of-00003.gguf", "UD-IQ4_XS"),
    ("mtp-Qwen3.8-Flash-Next-shared-Q8_0.gguf", "Q8_0"),
    ("mmproj-Swift-1.5-Qwen3.8-27B-F16.gguf", "F16"),
    ("Qwen3.8-Flash-Next-MLX-Serve-mixed-4-8bit", "mixed-4-8bit"),
    ("some-model-4bit", "4bit"),
])
def test_quantisation_is_read_from_the_model_file_name(name, quant):
    assert E.quant_from_name(name) == quant


def test_a_name_that_states_no_quantisation_gives_none():
    assert E.quant_from_name("Youssofal--Qwen3.8-Flash-Next-MTPLX-Optimized-Speed") is None


# --- 3. each engine's parser ---------------------------------------------------------------------

class TestLlamaCpp:
    def test_the_swift_run_on_the_rtx_4090(self):
        s = settings("llamacpp", LLAMA_SWIFT, LLAMA_SWIFT_VERSION)
        assert s["engine"] == "llama.cpp" and s["engine_version"] == LLAMA_SWIFT_VERSION
        assert val(s, "context_size") == 131072
        assert val(s, "kv_cache_type") == {"k": "q4_0", "v": "q4_0"}
        assert val(s, "speculative") == {"method": "draft-mtp", "draft_max": 4}
        assert (val(s, "temperature"), val(s, "top_p"), val(s, "top_k"), val(s, "min_p")) == (1.0, 0.95, 20, 0.0)
        assert val(s, "quantisation") == "Q4_K_M" and s["quantisation"]["source"] == E.SRC_MODEL_NAME
        assert s["reasoning_effort"]["engine"] == {"value": "low", "source": E.SRC_COMMAND,
                                                   "evidence": "--reasoning-effort low"}

    def test_no_reasoning_budget_flag_is_recorded_as_not_set(self):
        s = settings("llamacpp", LLAMA_SWIFT)
        assert s["thinking_budget"]["source"] == E.SRC_NOT_SET and val(s, "thinking_budget") == E.NOT_SET

    def test_a_reasoning_budget_flag_is_recorded(self):
        s = settings("llamacpp", LLAMA_SWIFT + ["--reasoning-budget", "8192"])
        assert val(s, "thinking_budget") == 8192

    def test_no_reasoning_flag_leaves_the_template_mode_unknown(self):
        s = settings("llamacpp", LLAMA_SWIFT)
        assert val(s, "thinking_mode") == E.UNKNOWN and "template" in s["thinking_mode"]["evidence"]

    def test_the_thinking_off_launch(self):
        s = settings("llamacpp", LLAMA_NO_THINK)
        assert val(s, "thinking_mode") == "off"
        assert (val(s, "temperature"), val(s, "top_p")) == (0.7, 0.8)
        assert s["speculative"]["source"] == E.SRC_NOT_SET
        assert s["kv_cache_type"]["source"] == E.SRC_NOT_SET

    def test_thinking_and_effort_from_chat_template_kwargs(self):
        s = settings("llamacpp", ["llama-server", "--chat-template-kwargs",
                                  '{"enable_thinking": true, "reasoning_effort": "high"}'])
        assert val(s, "thinking_mode") == "on"
        assert s["reasoning_effort"]["engine"]["value"] == "high"

    def test_a_separate_mtp_head_with_its_own_quantisation_and_p_min(self):
        s = settings("llamacpp", LLAMA_FLASH)
        assert val(s, "speculative") == {"method": "draft-mtp", "draft_max": 4, "p_min": 0.0,
                                         "draft_quantisation": "Q8_0"}
        assert val(s, "quantisation") == "UD-IQ4_XS"
        assert val(s, "kv_cache_type") == {"k": "f16", "v": "f16"}

    def test_different_k_and_v_types_are_both_kept(self):
        s = settings("llamacpp", ["llama-server", "-ctk", "q8_0", "-ctv", "q4_0"])
        assert val(s, "kv_cache_type") == {"k": "q8_0", "v": "q4_0"}


class TestGufo:
    def test_the_gufo_container_on_the_strix_halo(self):
        s = settings("gufo", GUFO, GUFO_VERSION)
        assert s["engine"] == "gufo" and s["engine_version"] == GUFO_VERSION
        assert val(s, "context_size") == 131072
        assert val(s, "thinking_mode") == "on"
        assert val(s, "speculative") == {"method": "mtp", "draft_max": 7, "draft_quantisation": "Q8_0"}
        assert (val(s, "temperature"), val(s, "top_p"), val(s, "top_k"), val(s, "min_p")) == (1.0, 0.95, 20, 0.0)
        assert val(s, "quantisation") == "UD-Q4_K_XL"
        assert s["reasoning_effort"]["engine"]["value"] == "low"

    def test_gufo_has_no_kv_type_switch_so_it_is_unknown_with_why(self):
        s = settings("gufo", GUFO)
        assert val(s, "kv_cache_type") == E.UNKNOWN and "no KV-cache type switch" in s["kv_cache_type"]["evidence"]

    def test_gufo_sets_no_thinking_budget(self):
        assert settings("gufo", GUFO)["thinking_budget"]["source"] == E.SRC_NOT_SET

    def test_gufo_with_thinking_off(self):
        argv = [a for a in GUFO if a not in ("--reasoning-effort", "low")]
        argv[argv.index("--think") + 1] = "off"
        assert val(settings("gufo", argv), "thinking_mode") == "off"


class TestMlxServe:
    def test_the_mlxserve_run_on_the_mac(self):
        s = settings("mlxserve", MLX, MLX_VERSION, generation_config=MLX_GENCFG_ON)
        assert s["engine"] == "mlx-serve" and s["engine_version"] == MLX_VERSION
        assert val(s, "context_size") == 131072
        assert val(s, "kv_cache_type") == "off"
        assert val(s, "speculative") == {"method": "mtp"}
        assert val(s, "thinking_budget") == 32768
        assert (val(s, "temperature"), val(s, "top_p"), val(s, "top_k")) == (1.0, 0.95, 20)
        assert val(s, "quantisation") == "mixed-4-8bit"

    def test_mlxserve_takes_no_effort_flag_so_the_engine_applies_none(self):
        s = settings("mlxserve", MLX, generation_config=MLX_GENCFG_ON)
        eng = s["reasoning_effort"]["engine"]
        assert eng["value"] == E.NOT_SET and "no server-side reasoning-effort" in eng["evidence"]

    def test_min_p_is_not_on_the_mlxserve_command_line(self):
        assert settings("mlxserve", MLX)["min_p"]["source"] == E.SRC_NOT_SET

    def test_the_thinking_mode_comes_from_the_served_generation_config(self):
        on = settings("mlxserve", MLX, generation_config=MLX_GENCFG_ON)["thinking_mode"]
        assert on["value"] == "on" and on["source"] == E.SRC_MODEL_CONFIG
        off = settings("mlxserve", MLX, generation_config={"default_chat_template_kwargs": {"enable_thinking": False}})
        assert val(off, "thinking_mode") == "off"

    def test_without_the_generation_config_the_thinking_mode_is_unknown(self):
        s = settings("mlxserve", MLX, generation_config=None)
        assert val(s, "thinking_mode") == E.UNKNOWN and "generation_config.json" in s["thinking_mode"]["evidence"]

    def test_a_config_without_the_key_leaves_the_architecture_default_unknown(self):
        s = settings("mlxserve", MLX, generation_config={"eos_token_id": [1]})
        assert val(s, "thinking_mode") == E.UNKNOWN

    def test_mtp_off(self):
        argv = [("--no-mtp" if a == "--mtp" else a) for a in MLX]
        s = settings("mlxserve", argv)
        assert val(s, "speculative") == "off" and s["speculative"]["source"] == E.SRC_COMMAND

    def test_the_real_model_directory_names_the_quantisation_over_the_served_alias(self):
        s = settings("mlxserve", MLX, model_dir="~/.mlx-serve/models/ddalcu/Qwen3.8-Flash-Next-MLX-Serve-mixed-4-8bit")
        assert val(s, "quantisation") == "mixed-4-8bit" and "Qwen3.8-Flash-Next-MLX-Serve" in s["quantisation"]["evidence"]


class TestMtplx:
    def test_the_python_server_process_that_listens_on_the_port(self):
        s = settings("mtplx", MTPLX_PY, MTPLX_VERSION)
        assert s["engine"] == "MTPLX" and s["engine_version"] == MTPLX_VERSION
        assert val(s, "context_size") == 131072
        assert val(s, "thinking_mode") == "on"
        assert val(s, "kv_cache_type") == "off"
        assert val(s, "speculative") == {"method": "mtp", "depth": 3}
        # --temperature, not --draft-temperature: the draft sampler is a different setting
        assert (val(s, "temperature"), val(s, "top_p"), val(s, "top_k")) == (1.0, 0.95, 20)
        assert s["reasoning_effort"]["engine"]["value"] == "low"

    def test_the_mtplx_cli_shape_the_launcher_execs(self):
        s = settings("mtplx", MTPLX_CLI, MTPLX_VERSION)
        assert val(s, "thinking_mode") == "on"
        assert (val(s, "temperature"), val(s, "top_p"), val(s, "top_k")) == (1.0, 0.95, 20)
        assert val(s, "speculative") == {"method": "mtp", "depth": 3}
        assert s["kv_cache_type"]["source"] == E.SRC_NOT_SET

    def test_the_model_name_states_no_quantisation(self):
        s = settings("mtplx", MTPLX_PY)
        assert val(s, "quantisation") == E.UNKNOWN and "Optimized-Speed" in s["quantisation"]["evidence"]

    def test_no_effort_flag_names_mtplx_own_default(self):
        argv = MTPLX_CLI[:-2]
        eng = settings("mtplx", argv)["reasoning_effort"]["engine"]
        assert eng["value"] == E.NOT_SET and "auto" in eng["evidence"]


# --- 4. reasoning effort -------------------------------------------------------------------------

class TestEffort:
    def test_the_engine_applies_it_and_the_client_sends_none(self):
        r = settings("llamacpp", LLAMA_SWIFT)["reasoning_effort"]
        assert r["requested"] == "low"
        assert r["client"]["value"] == E.NOT_SET and "pi" in r["client"]["evidence"]
        assert r["effective"]["value"] == "low" and r["effective"]["source"] == E.SRC_COMMAND
        assert r["matches_request"] is True

    def test_a_client_effort_overrides_the_engine_default(self):
        r = settings("llamacpp", LLAMA_SWIFT, client_thinking="high")["reasoning_effort"]
        assert r["client"] == {"value": "high", "source": E.SRC_CLIENT, "evidence": "pi --thinking high"}
        assert r["effective"]["value"] == "high" and r["effective"]["source"] == E.SRC_CLIENT
        assert r["matches_request"] is False

    def test_the_client_alone_can_apply_it(self):
        r = settings("mlxserve", MLX, client_thinking="low", generation_config=MLX_GENCFG_ON)["reasoning_effort"]
        assert r["effective"]["value"] == "low" and r["matches_request"] is True

    def test_neither_applies_it_so_it_is_unknown_with_why(self):
        r = settings("mlxserve", MLX, generation_config=MLX_GENCFG_ON)["reasoning_effort"]
        assert r["effective"]["value"] == E.UNKNOWN
        assert "neither" in r["effective"]["evidence"] and "mlx-serve" in r["effective"]["evidence"]
        assert r["matches_request"] is None

    def test_with_thinking_off_no_effort_applies(self):
        r = settings("llamacpp", LLAMA_NO_THINK)["reasoning_effort"]
        assert r["effective"]["value"] == "thinking off"

    def test_opencode_drops_a_per_request_effort(self):
        c = settings("mtplx", MTPLX_CLI, client="opencode")["reasoning_effort"]["client"]
        assert c["value"] == E.NOT_SET and "OpenCode" in c["evidence"]

    def test_a_client_this_module_does_not_know_is_unknown(self):
        c = settings("llamacpp", LLAMA_SWIFT, client="aider")["reasoning_effort"]["client"]
        assert c["value"] == E.UNKNOWN and "aider" in c["evidence"]

    def test_requesting_the_template_default_matches_when_nothing_sets_one(self):
        argv = [a for a in LLAMA_SWIFT if a not in ("--reasoning-effort", "low")]
        r = settings("llamacpp", argv, requested_effort="default")["reasoning_effort"]
        assert r["matches_request"] is True


# --- 5. gaps -------------------------------------------------------------------------------------

class TestGaps:
    def test_llamacpp_and_gufo_apply_what_was_asked(self):
        assert settings("llamacpp", LLAMA_SWIFT)["gaps"] == []
        assert settings("gufo", GUFO)["gaps"] == []

    def test_mlxserve_effort_is_a_gap(self):
        g = settings("mlxserve", MLX, generation_config=MLX_GENCFG_ON)["gaps"]
        assert len(g) == 1 and g[0].startswith("reasoning effort: 'low' requested")

    def test_an_effort_other_than_the_one_requested_is_a_gap(self):
        g = settings("llamacpp", LLAMA_SWIFT, client_thinking="high")["gaps"]
        assert g == ["reasoning effort: 'low' requested, 'high' applied (client)"]

    def test_a_served_context_other_than_the_run_context_is_a_gap(self):
        g = settings("llamacpp", LLAMA_SWIFT, context_limit=65536)["gaps"]
        assert g == ["context: 65536 requested, 131072 served"]

    def test_a_context_that_cannot_be_read_is_a_gap(self):
        g = settings("llamacpp", ["llama-server"], requested_effort="default")["gaps"]
        assert g == ["context: 131072 requested, not on the engine's command line"]


# --- 6. the unknown discipline -------------------------------------------------------------------

def _all_settings(s):
    yield from ((k, s[k]) for k in E.SETTING_KEYS)
    for k in ("engine", "client", "effective"):
        yield f"reasoning_effort.{k}", s["reasoning_effort"][k]


CASES = [("llamacpp", LLAMA_SWIFT), ("llamacpp", LLAMA_FLASH), ("llamacpp", LLAMA_NO_THINK), ("gufo", GUFO),
         ("mlxserve", MLX), ("mtplx", MTPLX_PY), ("mtplx", MTPLX_CLI), ("llamacpp", None), ("sglang", ["x"]),
         ("anthropic", None)]


@pytest.mark.parametrize("backend, argv", CASES)
def test_every_setting_says_where_it_came_from(backend, argv):
    for name, st in _all_settings(settings(backend, argv)):
        assert set(st) == {"value", "source", "evidence"}, name
        assert st["source"] in E.SOURCES, name
        assert isinstance(st["evidence"], str) and st["evidence"], name
        assert (st["source"] == E.SRC_UNKNOWN) == (st["value"] == E.UNKNOWN), name
        assert (st["source"] == E.SRC_NOT_SET) == (st["value"] == E.NOT_SET), name


def test_no_serving_process_makes_every_setting_unknown_with_why():
    s = settings("llamacpp", None)
    for name, st in _all_settings(s):
        if name == "reasoning_effort.client":
            continue
        assert st["value"] == E.UNKNOWN and "no engine command line" in st["evidence"], name


# the Strix Halo box, gufo-pi v2-r1 identity.server_command, recorded before identity followed containers
PASTA = ["/usr/bin/pasta", "--config-net", "-t", "127.0.0.1/18010-18010:8080-8080", "--quiet"]


@pytest.mark.parametrize("backend, argv", [("gufo", PASTA), ("llamacpp", ["/usr/bin/python3", "-m", "x"]),
                                           ("mlxserve", LLAMA_SWIFT), ("mtplx", ["python", "-m", "http.server"])])
def test_a_command_line_that_is_not_the_engine_is_not_read_as_one(backend, argv):
    s = settings(backend, argv)
    for k in E.SETTING_KEYS:
        assert val(s, k) == E.UNKNOWN and "is not" in s[k]["evidence"], k


@pytest.mark.parametrize("backend, argv", [("llamacpp", LLAMA_SWIFT), ("gufo", GUFO), ("mlxserve", MLX),
                                           ("mtplx", MTPLX_PY), ("mtplx", MTPLX_CLI)])
def test_each_engine_recognises_its_own_command_line(backend, argv):
    assert E.is_engine_argv(backend, argv)


def test_an_engine_without_a_parser_is_unknown_and_named():
    s = settings("sglang", ["python3", "-m", "sglang.launch_server"])
    assert val(s, "context_size") == E.UNKNOWN and "sglang" in s["context_size"]["evidence"]


def test_a_cloud_backend_has_no_local_engine():
    s = settings("anthropic", None, client="claude", requested_effort="client default")
    assert val(s, "temperature") == E.UNKNOWN and "cloud" in s["temperature"]["evidence"]
    assert s["gaps"] == []


# --- 7. the thin CLI, the per-story lookup, and the doc ------------------------------------------

def _cli(identity: dict, *args) -> dict:
    out = subprocess.run([sys.executable, str(Path(E.__file__)), *args], input=json.dumps(identity),
                         capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def test_the_cli_reads_the_expert_cache_from_the_server_log_it_is_given(tmp_path):
    """The size is only in what the server printed as it loaded, so the CLI has to be handed that log (run.sh passes
    $RUN_DIR/server.log). Without it the field says unknown rather than repeating "auto"."""
    cfg = tmp_path / "strata-run.json"
    cfg.write_text(json.dumps(STRATA_CONFIG))
    (tmp_path / "strata-run.shared-settings.json").write_text(json.dumps(STRATA_SHARED))
    log = tmp_path / "server.log"
    log.write_text(STRATA_STARTUP)
    argv = [*STRATA[:4], "--config", str(cfg), "--host", "127.0.0.1", "--port", "18010"]
    ident = {"backend": "strata", "engine_version": "v0.1.39", "server_command": argv}
    s = _cli(ident, "--requested-effort", "low", "--context-limit", "131072", "--startup-log", str(log))
    assert s["expert_cache"]["value"] == {"requested": "auto", "experts": 9094, "vram_gib": 14.73}
    assert s["expert_cache"]["source"] == E.SRC_ENGINE_START
    bare = _cli(ident, "--requested-effort", "low", "--context-limit", "131072")
    assert bare["expert_cache"]["source"] == E.SRC_UNKNOWN
    gone = _cli(ident, "--requested-effort", "low", "--startup-log", str(tmp_path / "nope.log"))
    assert gone["expert_cache"]["source"] == E.SRC_UNKNOWN


def test_the_cli_reads_identity_from_stdin_and_the_served_generation_config(tmp_path, monkeypatch):
    served = tmp_path / "served" / "mlxserve-flash-next-mixed-4-8bit"
    real = tmp_path / "models" / "Qwen3.8-Flash-Next-MLX-Serve-mixed-4-8bit"
    served.mkdir(parents=True)
    real.mkdir(parents=True)
    (real / "config.json").write_text("{}")
    (served / "config.json").symlink_to(real / "config.json")
    (served / "generation_config.json").write_text(json.dumps(MLX_GENCFG_ON))
    argv = [str(served) if a.endswith("mixed-4-8bit") else a for a in MLX]
    ident = {"backend": "mlxserve", "server_command": argv, "engine_version": MLX_VERSION}
    s = _cli(ident, "--requested-effort", "low", "--client", "pi", "--context-limit", "131072")
    assert s["thinking_mode"]["value"] == "on"
    assert "Qwen3.8-Flash-Next-MLX-Serve-mixed-4-8bit" in s["quantisation"]["evidence"]
    assert s["reasoning_effort"]["effective"]["value"] == E.UNKNOWN


def test_the_cli_expands_the_recorded_tilde_to_find_the_served_directory(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    served = tmp_path / "served" / "x"
    served.mkdir(parents=True)
    (served / "generation_config.json").write_text(json.dumps(MLX_GENCFG_ON))
    ident = {"backend": "mlxserve", "server_command": ["mlx-serve", "--model", "~/served/x"], "engine_version": None}
    s = _cli(ident, "--requested-effort", "low", "--client", "pi", "--context-limit", "131072")
    assert s["thinking_mode"]["value"] == "on"


def test_the_cli_never_fails_a_run(tmp_path):
    out = subprocess.run([sys.executable, str(Path(E.__file__)), "--requested-effort", "low"],
                         input="not json", capture_output=True, text=True)
    assert out.returncode == 0 and "error" in json.loads(out.stdout)


def test_a_null_identity_gives_unknown_settings():
    s = _cli(None, "--requested-effort", "low", "--client", "pi", "--context-limit", "131072")
    assert s["context_size"]["value"] == E.UNKNOWN


def test_a_story_gets_the_settings_of_the_start_it_ran_under(tmp_path):
    rs = settings("llamacpp", LLAMA_SWIFT)
    (tmp_path / "run.json").write_text(json.dumps({"started_at": "2026-09-30T08:00:00Z", "engine_settings": rs}))
    got = E.for_story(tmp_path)
    assert got["server_started_at"] == "2026-09-30T08:00:00Z" and got["context_size"] == rs["context_size"]


def test_a_story_in_a_run_without_engine_settings_gets_none(tmp_path):
    assert E.for_story(tmp_path) is None
    (tmp_path / "run.json").write_text(json.dumps({"started_at": "x"}))
    assert E.for_story(tmp_path) is None


def test_run_sh_records_engine_settings_in_run_json():
    run_sh = (Path(E.__file__).parent / "run.sh").read_text()
    assert '"engine_settings": $ENGINE_SETTINGS_JSON' in run_sh
    assert "engine_settings.py" in run_sh


def test_telemetry_md_names_every_engine_settings_field():
    doc = (Path(E.__file__).resolve().parent.parent / "TELEMETRY.md").read_text()
    s = settings("llamacpp", LLAMA_FLASH)
    names = set(s) | set(s["reasoning_effort"]) | {"server_started_at", "listener_command", "container"}
    names |= set(val(s, "speculative")) | {"depth"} | set(E.SOURCES) | {E.NOT_SET, E.UNKNOWN}
    # The fields only one engine records are documented too, with what they hold.
    st = strata_settings()
    names |= set(E.ENGINE_ONLY_KEYS) | set(val(st, "expert_cache"))
    missing = sorted(n for n in names if f"`{n}`" not in doc)
    assert missing == []


# ---------- Strata: its settings are in the configuration the launcher derived, not on a command line ----------
# The listener is `python serve/server.py --engine strata --config <root>/strata-run.json`. The engine's own flags
# (--max-context, --kv, --spec, --mtp, --native) are the "args" of that JSON; sampling is its "sampling" block; the
# server-side reasoning effort is in the shared-settings file beside it. Both files are read by the CLI, as the mlx-serve
# one reads generation_config.json. Values here are those of the 2 Oct 2026 check on the RTX 4090 machine.

STRATA = ["~/.local/share/awesome-local-ai/strata/Strata/.venv/bin/python",
          "~/.local/share/awesome-local-ai/strata/Strata/serve/server.py", "--engine", "strata", "--config",
          "~/.local/share/strata-qwen38-flash-next/strata-run.json", "--host", "127.0.0.1", "--port", "18010"]
STRATA_CONFIG = {
    "exe": "~/.local/share/awesome-local-ai/strata/Strata/engine/strata",
    "args": ["--pack", "~/.local/share/awesome-local-ai/strata/Strata-data/packs/iq3_xxs", "--native",
             "~/.local/share/awesome-local-ai/strata/Strata-data/models/IQ3_XXS/Qwen3.8-Flash-Next-GSQ-RCO-IQ3_XXS-00001-of-00002.gguf",
             "--expert-cache", "auto", "--prefill", "auto", "--spec", "4", "--spec-min-p", "0.5", "--mtp",
             "~/.local/share/awesome-local-ai/strata/Strata-data/mtp/rt", "--max-context", "131072", "--kv", "int8",
             "--vram-reserve-mib", "969"],
    "model_name": "strata-flash-next-iq3xxs",
    "sampling": {"temperature": 1.0, "top_p": 0.95, "top_k": 20},
}
STRATA_SHARED = {"reasoning_effort": "low"}


# What the server prints as it loads, with the size the "auto" expert cache actually took (RTX 4090, 5 Oct 2026).
STRATA_STARTUP = """[strata] starting the engine: reading the model's weights ...
[strata] experts loaded: 39.97 GiB at 4.41 GiB/s (61 s so far)
[strata] filling the GPU's expert cache (9094 experts, 14.73 GiB of VRAM) ...
[strata] almost ready ...
ready: http://127.0.0.1:18010/v1  (OpenAI: /v1/chat/completions, Anthropic: /v1/messages, context 131072 tokens)
"""


def strata_settings(config=STRATA_CONFIG, shared=STRATA_SHARED, argv=STRATA, version="v0.1.36", startup=STRATA_STARTUP):
    return E.engine_settings("strata", argv, version, requested_effort="low", client="pi", client_thinking=None,
                             context_limit=131072, generation_config=config, extra_config=shared, startup=startup)


class TestStrata:
    def test_its_own_process_is_the_python_server_with_the_strata_engine(self):
        assert E.is_engine_argv("strata", STRATA)
        assert not E.is_engine_argv("strata", ["python", "other.py"])
        assert not E.is_engine_argv("strata", ["python", "serve/server.py", "--engine", "mock"])

    def test_the_engine_and_its_version(self):
        s = strata_settings()
        assert s["engine"] == "Strata" and s["engine_version"] == "v0.1.36"

    def test_context_and_kv_type_come_from_the_engines_flags_in_its_configuration(self):
        s = strata_settings()
        assert s["context_size"]["value"] == 131072 and s["context_size"]["source"] == E.SRC_MODEL_CONFIG
        assert "--max-context 131072" in s["context_size"]["evidence"]
        assert s["kv_cache_type"]["value"] == "int8" and "--kv int8" in s["kv_cache_type"]["evidence"]

    def test_speculative_decoding_is_mtp_with_its_draft_length(self):
        spec = strata_settings()["speculative"]
        assert spec["value"] == {"method": "mtp", "draft_max": 4, "p_min": 0.5} and spec["source"] == E.SRC_MODEL_CONFIG

    def test_no_drafting_flags_means_none(self):
        cfg = {**STRATA_CONFIG, "args": ["--max-context", "131072"]}
        assert strata_settings(config=cfg)["speculative"]["source"] == E.SRC_NOT_SET

    def test_suffix_drafting_without_the_mtp_head_is_named_for_what_it_is(self):
        args = [a for a in STRATA_CONFIG["args"] if a != "--mtp" and not a.endswith("mtp/rt")]
        assert strata_settings(config={**STRATA_CONFIG, "args": args})["speculative"]["value"]["method"] == "suffix drafting"

    def test_sampling_is_the_configurations(self):
        s = strata_settings()
        assert (s["temperature"]["value"], s["top_p"]["value"], s["top_k"]["value"]) == (1.0, 0.95, 20)
        assert s["min_p"]["source"] == E.SRC_NOT_SET

    def test_the_quantisation_is_read_from_the_model_file_name(self):
        q = strata_settings()["quantisation"]
        assert q["value"] == "IQ3_XXS" and q["source"] == E.SRC_MODEL_NAME

    # Strata sizes its hot-expert cache to the VRAM that is free, so "--expert-cache auto" says nothing about what a
    # run actually had. Two runs of one combination can differ, and the record has to show it (A-045).
    def test_the_expert_cache_records_the_size_it_actually_took_not_just_auto(self):
        c = strata_settings()["expert_cache"]
        assert c["value"] == {"requested": "auto", "experts": 9094, "vram_gib": 14.73}
        assert c["source"] == E.SRC_ENGINE_START
        assert "9094 experts, 14.73 GiB" in c["evidence"]

    def test_a_fixed_expert_cache_still_records_what_it_took(self):
        args = list(STRATA_CONFIG["args"])
        args[args.index("--expert-cache") + 1] = "8000"
        c = strata_settings(config={**STRATA_CONFIG, "args": args})["expert_cache"]
        assert c["value"]["requested"] == "8000" and c["value"]["vram_gib"] == 14.73

    def test_no_startup_line_is_unknown_and_says_why_never_a_guess(self):
        c = strata_settings(startup="[strata] starting the engine: reading the model's weights ...\n")["expert_cache"]
        assert c["value"] == E.UNKNOWN and c["source"] == E.SRC_UNKNOWN
        assert "expert cache" in c["evidence"]

    def test_no_server_log_at_all_is_unknown_too(self):
        assert strata_settings(startup=None)["expert_cache"]["source"] == E.SRC_UNKNOWN

    def test_the_server_side_effort_is_from_the_shared_settings_and_is_the_effective_one(self):
        s = strata_settings()
        assert s["reasoning_effort"]["engine"]["value"] == "low"
        assert s["reasoning_effort"]["effective"]["value"] == "low"

    def test_thinking_mode_and_budget_are_not_invented(self):
        s = strata_settings()
        assert s["thinking_mode"]["source"] == E.SRC_UNKNOWN and s["thinking_mode"]["evidence"]
        assert s["thinking_budget"]["source"] == E.SRC_NOT_SET

    def test_a_configuration_that_could_not_be_read_makes_every_setting_unknown_with_why(self):
        s = strata_settings(config=None, shared=None)
        for k in ("context_size", "kv_cache_type", "speculative", "temperature", "quantisation"):
            assert s[k]["source"] == E.SRC_UNKNOWN and s[k]["evidence"], k

    def test_the_cli_reads_the_two_files_the_command_line_names(self, tmp_path, monkeypatch):
        root = tmp_path / "root"; root.mkdir()
        (root / "strata-run.json").write_text(json.dumps(STRATA_CONFIG))
        (root / "strata-run.shared-settings.json").write_text(json.dumps(STRATA_SHARED))
        argv = [*STRATA[:5], str(root / "strata-run.json"), *STRATA[6:]]
        cfg, shared = E._strata_files(argv)
        assert cfg["args"][cfg["args"].index("--max-context") + 1] == "131072" and shared == {"reasoning_effort": "low"}
        assert E._strata_files(["python", "x.py"]) == (None, None)
        assert E._strata_files([*argv[:5], str(tmp_path / "missing.json"), *argv[6:]]) == (None, None)
