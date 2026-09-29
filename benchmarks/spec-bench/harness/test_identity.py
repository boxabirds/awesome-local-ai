"""identity.py: what a run actually ran, recorded at its start so variations can be compared over time."""
import json
import os
import subprocess
import sys
from pathlib import Path

import identity as I

ENV = '''# Written by awesome-local-ai. Combination: qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-opencode
INSTALL_ID="swift15-qwen38-27b"
BACKEND="llamacpp"
MODEL_SUBDIR="models"
MODEL_FILE="Swift-1.5-Qwen3.8-27B-Q4_K_M.gguf"
MMPROJ_FILE="mmproj-Swift-1.5-Qwen3.8-27B-F16.gguf"
MTP_FILE=""
SAMPLING_THINKING="--temp 1.0 --top-p 0.95 --top-k 20 --min-p 0.0"
SPEC_DRAFT_N_MAX="4"
GUFO_SAMPLING_INSTRUCT=--temperature\\ 0.7\\ --top-p\\ 0.80
'''


def test_the_install_manifest_is_recorded_whole_with_shell_quoting_undone():
    m = I.parse_env(ENV)
    assert m["SPEC_DRAFT_N_MAX"] == "4"
    assert m["SAMPLING_THINKING"] == "--temp 1.0 --top-p 0.95 --top-k 20 --min-p 0.0"
    assert m["GUFO_SAMPLING_INSTRUCT"] == "--temperature 0.7 --top-p 0.80"
    assert m["MTP_FILE"] == ""
    assert "# Written" not in "".join(m)


def test_a_model_file_is_identified_by_the_revision_and_hash_saved_at_download(tmp_path):
    install = tmp_path / ".local/share/swift15-qwen38-27b"
    models = install / "models"
    meta = models / ".cache/huggingface/download"
    meta.mkdir(parents=True)
    (models / "Swift-1.5-Qwen3.8-27B-Q4_K_M.gguf").write_bytes(b"x" * 10)
    (meta / "Swift-1.5-Qwen3.8-27B-Q4_K_M.gguf.metadata").write_text(
        "a1614465cfa35d04d3e8575d713fa779662b5eab\n2ebba0ff1e63c1ac3fadd4e83efcea189f47f33ec72c91877af94de6ebe30590\n1790706286.4\n")
    files = I.model_files(I.parse_env(ENV), install, home=tmp_path)
    assert files == [{"role": "MODEL_FILE", "name": "Swift-1.5-Qwen3.8-27B-Q4_K_M.gguf", "bytes": 10,
                      "revision": "a1614465cfa35d04d3e8575d713fa779662b5eab",
                      "sha256": "2ebba0ff1e63c1ac3fadd4e83efcea189f47f33ec72c91877af94de6ebe30590"},
                     {"role": "MMPROJ_FILE", "name": "mmproj-Swift-1.5-Qwen3.8-27B-F16.gguf", "bytes": None,
                      "revision": None, "sha256": None}]


def test_a_pinned_model_directory_is_identified_by_its_verified_marker(tmp_path):
    env = I.parse_env('MODEL_SUBDIR=".mlx-serve/models/ddalcu"\nMODEL_FILE="Qwen3.8-Flash-Next-MLX-Serve-mixed-4-8bit"\n')
    d = tmp_path / ".mlx-serve/models/ddalcu/Qwen3.8-Flash-Next-MLX-Serve-mixed-4-8bit"
    d.mkdir(parents=True)
    (d / "model-00001.safetensors").write_bytes(b"y" * 7)
    (d / ".awesome-local-ai-verified").write_text(json.dumps({"revision": "abc123", "sizes": {"model-00001.safetensors": 7}}))
    files = I.model_files(env, tmp_path / ".local/share/x", home=tmp_path)
    assert files == [{"role": "MODEL_FILE", "name": "Qwen3.8-Flash-Next-MLX-Serve-mixed-4-8bit", "bytes": 7,
                      "revision": "abc123", "sha256": None}]


def test_the_listening_process_is_found_from_ss_or_lsof_output():
    ss = 'LISTEN 0 512 127.0.0.1:18010 0.0.0.0:* users:(("llama-server",pid=3899301,fd=15))\n'
    assert I.pid_from_ss(ss) == 3899301
    assert I.pid_from_ss("") is None
    assert I.pid_from_lsof("85166\n85170\n") == 85166


def test_home_is_never_written_into_the_record():
    argv = ["/home/julian/.local/share/x/llama.cpp/build/bin/llama-server", "-m", "/home/julian/.local/share/x/models/m.gguf"]
    assert I.tilde(argv, "/home/julian") == ["~/.local/share/x/llama.cpp/build/bin/llama-server", "-m",
                                            "~/.local/share/x/models/m.gguf"]


def test_the_engine_version_comes_from_the_serving_binary_itself(tmp_path):
    fake = tmp_path / "llama-server"
    fake.write_text("#!/bin/sh\necho 'version: 0.4.1-dev (build 1, commit 6a2743f)'\necho 'built with GNU 11.4.0' >&2\n")
    fake.chmod(0o755)
    assert I.engine_version([str(fake), "--port", "1"]) == "version: 0.4.1-dev (build 1, commit 6a2743f)"
    assert I.engine_version([]) is None


def test_a_run_without_a_local_server_still_gets_a_record(tmp_path):
    env_file = tmp_path / "install.env"
    env_file.write_text('BACKEND="anthropic"\n')
    out = subprocess.run([sys.executable, str(Path(I.__file__)), "--env-file", str(env_file), "--port", "0"],
                         capture_output=True, text=True, check=True).stdout
    rec = json.loads(out)
    assert rec["backend"] == "anthropic" and rec["server_command"] is None
    assert rec["install_manifest"] == {"BACKEND": "anthropic"}
    assert "os" in rec and "drivers" in rec


def test_gufo_model_files_are_found_inside_the_model_folder(tmp_path):
    env = I.parse_env('MODEL_SUBDIR="gufo/models"\nMODEL_FILE="qwen3.8-flash-next"\n'
                      'GUFO_MODEL_REL=UD-Q4_K_XL/m-00001-of-00004.gguf\n')
    part = tmp_path / "gufo/models/qwen3.8-flash-next/UD-Q4_K_XL/m-00001-of-00004.gguf"
    part.parent.mkdir(parents=True)
    part.write_bytes(b"z" * 5)
    files = I.model_files(env, tmp_path / ".local/share/x", home=tmp_path)
    assert files[1] == {"role": "GUFO_MODEL_REL", "name": "UD-Q4_K_XL/m-00001-of-00004.gguf", "bytes": 5,
                        "revision": None, "sha256": None}
