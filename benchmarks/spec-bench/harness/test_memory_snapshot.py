"""What the model server is holding when a story starts: the parsers, against real log lines.

The footprint that decides what fits on a machine was recorded in one place (the conditions sampler's total, every
30 s) and shown nowhere, and there was no breakdown at all. Each engine says different things about itself, so a
snapshot reports what THAT engine volunteers, names it, and leaves the rest absent: never a derived figure dressed as
a measurement (a KV cache that is secretly context length times a constant would sit in the same column as a real one).

The lines below are real: llama.cpp's from the 3-bit run on the M5 Max, gufo's from the Strix Halo box, 7 Oct 2026.
"""
import json

import memory_snapshot as ms

MIB = 1024 * 1024

# llama.cpp, build with MTP support. At this verbosity it logs two things about memory: each prompt-cache EVICTION
# (the size of the entry thrown out) and each erased context checkpoint. It prints no "cache state" line, so the
# current size of the cache is not available from the log; the evictions are.
LLAMACPP = """\
0.00.000.251 I srv  llama_server: initializing ...
0.09.388.309 I srv    load_model: initializing, n_slots = 1, n_ctx_slot = 131072, kv_unified = 'false'
29.54.000.527 W slot create_check: id  0 | task 18096 | erasing old context checkpoint (pos_min = 1601, pos_max = 1601, n_tokens = 1602, size = 115.730 MiB)
54.22.017.378 W srv         alloc:  - making room for prompt cache entry, removing oldest entry (size = 5678.568 MiB)
123.20.375.713 W srv         alloc:  - making room for prompt cache entry, removing oldest entry (size = 3086.496 MiB)
123.20.385.762 W srv         alloc:  - making room for prompt cache entry, removing oldest entry (size = 3111.221 MiB)
141.45.659.432 W slot create_check: id  0 | task 69837 | erasing old context checkpoint (pos_min = 1601, pos_max = 1601, n_tokens = 1602, size = 115.730 MiB)
"""

# gufo 0.5.0 and the Qwen3.6 fork. Its own accounting is rich: a [cache] line carries what the snapshot cache holds
# against what it may hold, a [loader] line the GPU's use at load, and every completed request the process's RSS and
# the host's free memory.
GUFO = """\
2026-10-07 05:15:40 [INFO] [loader] event=load_completed kind=text elapsed_ms=15754 model=qwen3.6-35b-a3b sessions=2 context_tokens=131072 speculative=mtp draft_limit=7 disk_cache=off rss_mib=2148 host_available_mib=86856 gpu_device_used_mib=35285 gpu_device_total_mib=122880
2026-10-06 19:11:40 [INFO] [http] request=r2470 event=completed method=POST path=/v1/chat/completions status=200 duration_ms=8656.3 outcome=completed prompt_tokens=66339 prefill_tokens=629 generated_tokens=257 finish=stop cache=memory cached_tokens=65710 cache_restore_ms=0.0 queue_depth=1 plan=serial-c1 cache_snapshot_bytes=3864534496 rss_mib=16626 host_available_mib=16629
2026-10-06 19:11:42 [WARN] [cache] event=snapshot action=skipped reason=byte_capacity bytes=1954364428 tokens=66829 retained_bytes=16846596992 reserved_bytes=0 capacity_bytes=17914744832
2026-10-06 19:12:26 [INFO] [http] request=r2472 event=received method=POST path=/v1/chat/completions body_bytes=253341
2026-10-06 19:12:28 [WARN] [cache] event=snapshot action=skipped reason=byte_capacity bytes=1969381016 tokens=67376 retained_bytes=16872178176 reserved_bytes=0 capacity_bytes=17914744832
2026-10-06 19:12:30 [INFO] [http] request=r2472 event=completed method=POST path=/v1/chat/completions status=200 outcome=completed cache_snapshot_bytes=3902144352 rss_mib=16662 host_available_mib=16769
"""


# ---------- llama.cpp ----------

def test_llamacpp_reports_its_evictions_not_a_cache_size_it_never_printed():
    snap = ms.parse_engine_log(LLAMACPP.splitlines())
    assert snap["engine"] == "llama.cpp"
    cache = snap["prompt_cache"]
    assert cache["evictions"] == 3
    assert cache["evicted_mib"] == round(5678.568 + 3086.496 + 3111.221, 1)
    assert cache["last_evicted_mib"] == 3111.2
    assert "retained_mib" not in cache and "capacity_mib" not in cache      # not offered, so not invented


def test_llamacpp_counts_the_erased_checkpoints_separately_from_cache_evictions():
    cache = ms.parse_engine_log(LLAMACPP.splitlines())["prompt_cache"]
    assert cache["checkpoints_erased"] == 2


def test_a_llamacpp_server_that_has_evicted_nothing_says_zero_not_nothing():
    snap = ms.parse_engine_log(LLAMACPP.splitlines()[:2])
    assert snap["engine"] == "llama.cpp"
    assert snap["prompt_cache"]["evictions"] == 0 and snap["prompt_cache"]["evicted_mib"] == 0


# ---------- gufo ----------

def test_gufo_reports_what_the_cache_holds_against_what_it_may_hold():
    snap = ms.parse_engine_log(GUFO.splitlines())
    assert snap["engine"] == "gufo"
    cache = snap["prompt_cache"]
    assert cache["retained_mib"] == round(16872178176 / MIB, 1)      # the LATEST [cache] line, not the first
    assert cache["capacity_mib"] == round(17914744832 / MIB, 1)
    assert cache["skipped_for_capacity"] == 2
    assert cache["last_snapshot_mib"] == round(3902144352 / MIB, 1)


def test_gufo_extras_are_named_for_what_gufo_said():
    extras = ms.parse_engine_log(GUFO.splitlines())["extras"]
    assert extras["gpu_device_used_mib"] == 35285 and extras["gpu_device_total_mib"] == 122880
    assert extras["host_available_mib"] == 16769 and extras["engine_rss_mib"] == 16662     # the latest request's


# ---------- neither ----------

def test_an_engine_that_says_nothing_about_memory_gives_an_empty_snapshot_not_a_guess():
    assert ms.parse_engine_log(["some other server", "started"]) == {}
    assert ms.parse_engine_log([]) == {}


# ---------- the model's size on disk ----------

def test_the_weights_are_the_exact_bytes_of_every_shard_and_the_draft_head(tmp_path):
    d = tmp_path / "UD-IQ3_XXS"
    d.mkdir()
    (d / "m-00001-of-00003.gguf").write_bytes(b"a" * 10)
    (d / "m-00002-of-00003.gguf").write_bytes(b"b" * 200)
    (d / "m-00003-of-00003.gguf").write_bytes(b"c" * 3000)
    (d / "other-quant-00001-of-00002.gguf").write_bytes(b"x" * 99999)     # a different model in the same folder
    mtp = tmp_path / "MTP"
    mtp.mkdir()
    (mtp / "head.gguf").write_bytes(b"h" * 40000)
    got = ms.weights_bytes([d / "m-00001-of-00003.gguf", mtp / "head.gguf"])
    assert got == 10 + 200 + 3000 + 40000


def test_a_single_file_is_just_its_size(tmp_path):
    f = tmp_path / "model.gguf"
    f.write_bytes(b"z" * 1234)
    assert ms.weights_bytes([f]) == 1234


def test_weights_that_cannot_be_found_are_unknown_not_zero(tmp_path):
    assert ms.weights_bytes([tmp_path / "nope.gguf"]) is None
    assert ms.weights_bytes([]) is None


# ---------- the snapshot itself ----------

def test_a_snapshot_has_the_total_the_weights_and_the_engine_s_own_account(tmp_path):
    log = tmp_path / "server.log"
    log.write_text(LLAMACPP)
    w = tmp_path / "model.gguf"
    w.write_bytes(b"w" * 4096)
    snap = ms.take(resident_gb=96.9, server_log=log, weights=[w], at=1791360656.0)
    assert snap["at"] == 1791360656.0
    assert snap["resident_mib"] == round(96.9 * 1024, 1)
    assert snap["model_bytes"] == 4096
    assert snap["engine"] == "llama.cpp" and snap["prompt_cache"]["evictions"] == 3
    json.dumps(snap)                                                      # it goes into a JSON record


def test_a_snapshot_with_no_log_and_no_weights_still_has_the_total_and_nothing_made_up(tmp_path):
    snap = ms.take(resident_gb=88.0, server_log=tmp_path / "missing.log", weights=[], at=1.0)
    assert snap["resident_mib"] == round(88.0 * 1024, 1)
    assert snap["model_bytes"] is None
    assert "prompt_cache" not in snap and "engine" not in snap


def test_a_total_that_could_not_be_read_is_none_never_zero(tmp_path):
    # A containerised engine once read 0.0 GB for 2,381 readings. Unknown has to look unknown.
    snap = ms.take(resident_gb=None, server_log=tmp_path / "x.log", weights=[], at=1.0)
    assert snap["resident_mib"] is None


# ---------- finding the weights from the install manifest ----------
# The installer writes install.env with printf %q, so a value can be bare, quoted or backslash-escaped. The layouts
# differ by backend and are the launchers' own (lib/runtime/server-*.sh): llama.cpp points at
# $HOME/$MODEL_SUBDIR/$MODEL_FILE (the first shard) and MTP_FILE beside it; gufo, and the Qwen3.6 fork, at
# $HOME/$MODEL_SUBDIR/$MODEL_FILE/$GUFO_MODEL_REL with the draft head at $GUFO_MTP_REL under the same directory.

def test_the_manifest_is_read_whatever_way_printf_q_wrote_the_value(tmp_path):
    f = tmp_path / "install.env"
    f.write_text('# a comment\nMODEL_FILE="UD-IQ3_XXS/m-00001-of-00003.gguf"\nGUFO_MODEL_REL=Q.gguf\n'
                 "ODD=a\\ b\nEMPTY=''\nMTP_FILE=\n")
    env = ms.read_manifest(f)
    assert env["MODEL_FILE"] == "UD-IQ3_XXS/m-00001-of-00003.gguf"
    assert env["GUFO_MODEL_REL"] == "Q.gguf"
    assert env["ODD"] == "a b"
    assert env["EMPTY"] == "" and env["MTP_FILE"] == ""


def test_a_missing_manifest_is_empty_not_an_error(tmp_path):
    assert ms.read_manifest(tmp_path / "nope.env") == {}


def test_llamacpp_weights_are_the_model_file_and_its_draft_head(tmp_path):
    home = tmp_path
    base = home / ".local/share/x/models"
    (base / "Q").mkdir(parents=True)
    (base / "MTP").mkdir()
    (base / "Q/m-00001-of-00002.gguf").write_bytes(b"1" * 10)
    (base / "Q/m-00002-of-00002.gguf").write_bytes(b"2" * 20)
    (base / "MTP/h.gguf").write_bytes(b"3" * 5)
    env = {"MODEL_SUBDIR": ".local/share/x/models", "MODEL_FILE": "Q/m-00001-of-00002.gguf", "MTP_FILE": "MTP/h.gguf"}
    assert ms.weights_bytes(ms.weights_from_manifest(env, home)) == 35


def test_gufo_weights_are_under_the_weights_directory_the_manifest_names(tmp_path):
    home = tmp_path
    w = home / ".local/share/x/gufo/models/qwen3.6-35b-a3b"
    w.mkdir(parents=True)
    (w / "Q6.gguf").write_bytes(b"q" * 777)
    env = {"MODEL_SUBDIR": ".local/share/x/gufo/models", "MODEL_FILE": "qwen3.6-35b-a3b", "GUFO_MODEL_REL": "Q6.gguf"}
    assert ms.weights_bytes(ms.weights_from_manifest(env, home)) == 777


def test_an_override_for_where_the_weights_live_is_honoured(tmp_path):
    # Launchers let the weights directory be moved (MODEL_CACHE_ENV_VAR); the snapshot has to look where they do.
    elsewhere = tmp_path / "bigdisk"
    elsewhere.mkdir()
    (elsewhere / "model.gguf").write_bytes(b"e" * 50)
    env = {"MODEL_SUBDIR": "ignored", "MODEL_FILE": "model.gguf", "MODEL_CACHE_ENV_VAR": "MY_MODELS"}
    got = ms.weights_from_manifest(env, tmp_path, environ={"MY_MODELS": str(elsewhere)})
    assert ms.weights_bytes(got) == 50


def test_a_manifest_that_names_no_weights_gives_unknown(tmp_path):
    assert ms.weights_bytes(ms.weights_from_manifest({}, tmp_path)) is None


# ---------- the layouts the real manifests turned out to have (checked on the benchmark machines, 7 Oct 2026) ----------
# llama.cpp resolves $ROOT/$MODEL_SUBDIR, ROOT being the install's own directory; gufo and mlx-serve resolve
# $HOME/$MODEL_SUBDIR. The first version assumed the second for all of them and found nothing for llama.cpp.
# Rather than a rule per backend, each candidate base is tried and the one that holds the file is used.

def test_llamacpp_weights_are_found_under_the_install_root_not_home(tmp_path):
    home, root = tmp_path / "home", tmp_path / "home/.local/share/x"
    (root / "models/G/Q").mkdir(parents=True)
    (root / "models/G/Q/m-00001-of-00002.gguf").write_bytes(b"1" * 11)
    (root / "models/G/Q/m-00002-of-00002.gguf").write_bytes(b"2" * 22)
    env = {"MODEL_SUBDIR": "models/G", "MODEL_FILE": "Q/m-00001-of-00002.gguf"}
    assert ms.weights_bytes(ms.weights_from_manifest(env, home, environ={}, root=root)) == 33


def test_a_model_that_is_a_directory_is_the_sum_of_its_files_following_links(tmp_path):
    # MLX models are a directory of safetensors, often links into a cache of blobs.
    home = tmp_path
    blobs = tmp_path / "blobs"
    blobs.mkdir()
    (blobs / "b1").write_bytes(b"a" * 100)
    (blobs / "b2").write_bytes(b"b" * 900)
    model = home / ".mlx-serve/models/org/M"
    model.mkdir(parents=True)
    (model / "w1.safetensors").symlink_to(blobs / "b1")
    (model / "w2.safetensors").symlink_to(blobs / "b2")
    (model / "config.json").write_bytes(b"{}")
    env = {"MODEL_SUBDIR": ".mlx-serve/models/org", "MODEL_FILE": "M"}
    assert ms.weights_bytes(ms.weights_from_manifest(env, home, environ={}, root=tmp_path / "root")) == 100 + 900 + 2


def test_the_same_blob_linked_twice_is_counted_once(tmp_path):
    blob = tmp_path / "blob"
    blob.write_bytes(b"x" * 500)
    d = tmp_path / "m"
    d.mkdir()
    (d / "a").symlink_to(blob)
    (d / "b").symlink_to(blob)
    assert ms.weights_bytes([d]) == 500


def test_the_first_base_that_holds_the_file_wins(tmp_path):
    home, root = tmp_path / "home", tmp_path / "root"
    for base, size in ((home / "models", 1), (root / "models", 2)):
        base.mkdir(parents=True)
        (base / "m.gguf").write_bytes(b"z" * size)
    env = {"MODEL_SUBDIR": "models", "MODEL_FILE": "m.gguf"}
    assert ms.weights_bytes(ms.weights_from_manifest(env, home, environ={}, root=root)) == 1


# ---------- two ways the first resolver gave a believable wrong answer, found on the real manifests ----------

def test_a_draft_head_alone_is_not_the_model_it_is_unknown(tmp_path):
    # The 4-bit llama.cpp install on the M5 Max has its draft head and image projector but no longer its model
    # shards, and reported 3.44 GiB: a small number that looked like a small model. Without the model itself
    # there is no size to report.
    base = tmp_path / "models"
    (base / "MTP").mkdir(parents=True)
    (base / "MTP/h.gguf").write_bytes(b"h" * 3000)
    env = {"MODEL_SUBDIR": "models", "MODEL_FILE": "Q/m-00001-of-00002.gguf", "MTP_FILE": "MTP/h.gguf"}
    assert ms.weights_bytes(ms.weights_from_manifest(env, tmp_path, environ={})) is None


def test_a_gufo_weights_directory_counts_only_the_files_the_manifest_names(tmp_path):
    # MODEL_FILE is the directory, and other quants can sit in it. Only GUFO_MODEL_REL and GUFO_MTP_REL are the model.
    w = tmp_path / "m/qwen"
    (w / "Q4").mkdir(parents=True)
    (w / "MTP").mkdir()
    (w / "Q8").mkdir()
    (w / "Q4/model.gguf").write_bytes(b"4" * 400)
    (w / "MTP/head.gguf").write_bytes(b"h" * 30)
    (w / "Q8/other-quant.gguf").write_bytes(b"8" * 90000)               # not the model this install runs
    env = {"MODEL_SUBDIR": "m", "MODEL_FILE": "qwen", "GUFO_MODEL_REL": "Q4/model.gguf", "GUFO_MTP_REL": "MTP/head.gguf"}
    assert ms.weights_bytes(ms.weights_from_manifest(env, tmp_path, environ={})) == 430


# ---------- run.sh hands the driver the manifest ----------
# The snapshot finds the weights from the install manifest. The driver does not know the install, so run.sh, which
# already reads that manifest, passes its path. Without this the weights are silently unknown on every story.

def test_run_sh_passes_the_install_manifest_to_the_driver():
    from pathlib import Path
    sh = Path(__file__).with_name("run.sh").read_text()
    call = sh[sh.index("uv run --quiet drive.py"):]
    call = call[:call.index("\n\n")] if "\n\n" in call else call
    assert '--install-env "$ENV_FILE"' in call
