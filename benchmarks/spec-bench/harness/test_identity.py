"""identity.py: what a run actually ran, recorded at its start so variations can be compared over time."""
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

import identity as I

ENV = '''# Written by awesome-local-ai. Combination: qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi
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
    argv = ["/home/you/.local/share/x/llama.cpp/build/bin/llama-server", "-m", "/home/you/.local/share/x/models/m.gguf"]
    assert I.tilde(argv, "/home/you") == ["~/.local/share/x/llama.cpp/build/bin/llama-server", "-m",
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


# ---------- following the port into a container (gufo in Podman, SGLang in Docker) ----------

# the Strix Halo box, gufo-pi v2-r1 run.json identity.server_command: the host process on the port is Podman's network helper
PASTA = ["/usr/bin/pasta", "--config-net", "-t", "127.0.0.1/18010-18010:8080-8080", "--dns-forward", "169.254.1.1",
         "-u", "none", "-T", "none", "-U", "none", "--no-map-gw", "--quiet", "--netns",
         "/run/user/1000/netns/netns-e5abdf57-9e96-491c-c861-24eac8a45e1c", "--map-guest-addr", "169.254.1.2"]
GUFO_ARGS = ["serve", "--host", "0.0.0.0", "--port", "8080", "--sessions", "1", "llm", "--model",
             "/models/UD-Q4_K_XL/Qwen3.8-Flash-Next-UD-Q4_K_XL-00001-of-00004.gguf", "--context", "131072",
             "--think", "on", "--reasoning-effort", "low"]
IMAGE = "ghcr.io/gufo-org/toolboxes/gufo-runtime@sha256:51f3cae01632174f2f53e402beb817231b703e96dad822b4300e694bd8a388d5"
# `podman inspect <name>` (podman 4/5): Path + Args are what the container's process was started with
INSPECT = json.dumps([{"Id": "3f2a9c", "Name": "qwen38-flash-next-strix-gufo-18010", "Path": "gufo",
                       "Args": GUFO_ARGS, "ImageName": IMAGE, "Config": {"Cmd": ["gufo", *GUFO_ARGS]}}])
# `podman ps --format json`
PS = json.dumps([{"Id": "aaa", "Names": ["other-9000"], "Ports": [{"host_ip": "127.0.0.1", "container_port": 80,
                                                                  "host_port": 9000, "range": 1, "protocol": "tcp"}]},
                 {"Id": "3f2a9c", "Names": ["qwen38-flash-next-strix-gufo-18010"],
                  "Ports": [{"host_ip": "127.0.0.1", "container_port": 8080, "host_port": 18010, "range": 1,
                             "protocol": "tcp"}]}])


@pytest.mark.parametrize("argv, helper", [
    (PASTA, True), (["/usr/bin/slirp4netns", "--disable-host-loopback"], True),
    (["/usr/bin/conmon", "--api-version", "1"], True), (["/usr/libexec/podman/rootlessport"], True),
    (["/usr/bin/docker-proxy", "-proto", "tcp", "-host-port", "18010"], True),
    (["~/.local/share/x/llama.cpp/build/bin/llama-server", "-m", "m.gguf"], False), (None, False), ([], False)])
def test_a_container_network_helper_is_not_the_engine(argv, helper):
    assert I.is_container_helper(argv) is helper


def test_the_container_runtime_follows_the_backend_first_then_the_helper():
    assert I.container_runtime(PASTA, "gufo") == "podman"
    assert I.container_runtime(["/usr/libexec/docker/rootlessport"], "sglang") == "docker"
    assert I.container_runtime(["/usr/bin/docker-proxy"], None) == "docker"
    assert I.container_runtime(PASTA, None) == "podman"
    assert I.container_runtime(["llama-server"], "llamacpp") is None


def test_the_container_publishing_a_port_is_found_in_podman_ps():
    assert I.container_for_port(PS, 18010) == "qwen38-flash-next-strix-gufo-18010"
    assert I.container_for_port(PS, 18011) is None
    assert I.container_for_port("", 18010) is None and I.container_for_port("not json", 18010) is None


def test_the_engine_command_is_read_from_podman_inspect():
    e = I.engine_from_inspect(INSPECT)
    assert e == {"argv": ["gufo", *GUFO_ARGS], "name": "qwen38-flash-next-strix-gufo-18010", "image": IMAGE}


def test_docker_inspect_names_start_with_a_slash_and_the_image_is_under_config():
    out = json.dumps([{"Name": "/sglang-18010", "Path": "python3", "Args": ["-m", "sglang.launch_server"],
                       "Config": {"Image": "lmsysorg/sglang:v0.5"}}])
    assert I.engine_from_inspect(out) == {"argv": ["python3", "-m", "sglang.launch_server"], "name": "sglang-18010",
                                          "image": "lmsysorg/sglang:v0.5"}


def test_an_empty_or_failed_inspect_gives_none():
    assert I.engine_from_inspect("") is None and I.engine_from_inspect("[]") is None
    assert I.engine_from_inspect("Error: no such container") is None


def test_the_version_is_asked_of_the_engine_not_its_wrapper():
    ctr = {"runtime": "podman", "name": "g-18010"}
    assert I.version_command("gufo", ["gufo", "serve"], ctr) == ["podman", "exec", "g-18010", "gufo", "--version"]
    # the MTPLX listener is a Python interpreter: its own --version would say "Python 3.12"
    assert I.version_command("mtplx", ["/opt/homebrew/bin/Python", "-m", "mtplx.server.openai"]) == ["mtplx", "--version"]
    assert I.version_command("llamacpp", ["/x/llama-server", "-m", "m"]) == ["/x/llama-server", "--version"]
    assert I.version_command("llamacpp", None) is None


def test_a_version_line_without_digits_is_kept_when_the_command_succeeded():
    assert I.first_version_line("gufo b722a61\n", ok=True) == "gufo b722a61"
    assert I.first_version_line("Error: unknown flag\n", ok=False) is None
    assert I.first_version_line("ggml_init\nversion: 0.5.0 (build 1)\n", ok=True) == "version: 0.5.0 (build 1)"


def test_keys_on_a_recorded_command_line_are_masked():
    argv = ["mlx-serve", "--api-key", "sk-123", "--port", "1", "--hf-token=abc"]
    assert I.redact(argv) == ["mlx-serve", "--api-key", "***", "--port", "1", "--hf-token=***"]


def _fake_host(monkeypatch, listener, runs):
    """identity() with the OS answers replaced: a listener argv, and each command's stdout by its first words."""
    monkeypatch.setattr(I, "listening_pid", lambda port: 4242)
    monkeypatch.setattr(I, "argv_of", lambda pid: listener)
    calls = []

    def run(cmd, timeout=I.TOOL_TIMEOUT_S):
        calls.append(cmd)
        for prefix, out in runs.items():
            if tuple(cmd[:len(prefix)]) == prefix:
                return out
        return ""
    monkeypatch.setattr(I, "_run_rc", lambda cmd, timeout=I.TOOL_TIMEOUT_S: (run(cmd, timeout), 0))
    monkeypatch.setattr(I, "_run", run)
    return calls


def test_gufo_identity_is_the_gufo_process_in_its_container_not_pasta(tmp_path, monkeypatch):
    env = tmp_path / "install.env"
    env.write_text('BACKEND="gufo"\nINSTALL_ID="qwen38-flash-next-strix-gufo"\n')
    calls = _fake_host(monkeypatch, PASTA, {
        ("podman", "inspect", "qwen38-flash-next-strix-gufo-18010"): INSPECT,
        ("podman", "exec", "qwen38-flash-next-strix-gufo-18010", "gufo", "--version"): "gufo b722a61\n"})
    rec = I.identity(env, 18010)
    assert rec["server_command"] == ["gufo", *GUFO_ARGS]
    assert rec["engine_version"] == "gufo b722a61"
    assert rec["listener_command"] == PASTA
    assert rec["container"] == {"runtime": "podman", "name": "qwen38-flash-next-strix-gufo-18010", "image": IMAGE}
    assert ["podman", "ps", "--format", "json"] not in calls   # found by the launcher's own name first


def test_a_container_under_another_name_is_found_by_its_published_port(tmp_path, monkeypatch):
    env = tmp_path / "install.env"
    env.write_text('BACKEND="gufo"\nINSTALL_ID="renamed"\n')
    _fake_host(monkeypatch, PASTA, {("podman", "ps"): PS,
                                    ("podman", "inspect", "qwen38-flash-next-strix-gufo-18010"): INSPECT})
    assert I.identity(env, 18010)["container"]["name"] == "qwen38-flash-next-strix-gufo-18010"


def test_a_helper_whose_container_cant_be_found_records_no_engine_command(tmp_path, monkeypatch):
    env = tmp_path / "install.env"
    env.write_text('BACKEND="gufo"\nINSTALL_ID="x"\n')
    _fake_host(monkeypatch, PASTA, {})
    rec = I.identity(env, 18010)
    assert rec["server_command"] is None and rec["engine_version"] is None
    assert rec["listener_command"] == PASTA and rec["container"] is None


def test_a_host_process_is_its_own_engine(tmp_path, monkeypatch):
    env = tmp_path / "install.env"
    env.write_text('BACKEND="llamacpp"\n')
    argv = ["/x/llama-server", "-m", "m.gguf"]
    _fake_host(monkeypatch, argv, {("/x/llama-server", "--version"): "version: 1 (commit a)\n"})
    monkeypatch.setattr(I.os, "access", lambda p, m: True)
    rec = I.identity(env, 18010)
    assert rec["server_command"] == argv and rec["listener_command"] is None and rec["container"] is None
    assert rec["engine_version"] == "version: 1 (commit a)"
