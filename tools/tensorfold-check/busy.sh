#!/usr/bin/env bash
# busy.sh -- is this Mac doing benchmark work that the TensorFold checks must not run beside? Sourced by
# run-checks.sh. `tfc_busy_reasons` prints one line per reason, nothing when the machine is free.
#
#   * a harness agent run: drive.py ("[d]rive.py" so pgrep does not match its own command line)
#   * a dbench job running, or queued on a node that is not held (dbench would start it in the middle of the checks;
#     `dbench hold` stops that). dbench keeps each job as <home>/jobs/<id>.json, its state under "state.status", and
#     a hold as <home>/hold.json (tools/dbench/src/store.rs, job.rs, control.rs).
#   * a model server already resident: two servers of this size on one 128 GB Mac is how the 24 Sep 2026 kernel
#     panic happened.

tfc_busy_reasons() {
  local dbench_home="${DBENCH_HOME:-$HOME/.dbench}" pids snapshot servers
  pids="$(pgrep -fl '[d]rive\.py' 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    printf '%s\n' "$pids" | head -3 | sed 's/^/a benchmark agent run is in progress (drive.py): /'
  fi
  if [[ -d "$dbench_home/jobs" ]]; then
    python3 - "$dbench_home" <<'PY'
import json, pathlib, sys
home = pathlib.Path(sys.argv[1])
held = (home / "hold.json").exists()
for p in sorted((home / "jobs").glob("*.json")):
    if p.name.startswith("."):
        continue
    try:
        job = json.loads(p.read_text())
    except Exception:
        continue
    status = ((job.get("state") or {}).get("status") or "")
    if status == "running":
        print(f"dbench job {job.get('id', p.stem)} is running")
    elif status == "queued" and not held:
        print(f"dbench job {job.get('id', p.stem)} is queued and the node is not held: it would start during the "
              f"checks (dbench hold <node> first)")
PY
  fi
  snapshot="$(ps -axo pid=,command= 2>/dev/null || true)"
  servers="$(printf '%s\n' "$snapshot" | awk '
    /mtplx\.server|mtplx +serve|mlx-serve .*--serve|mlx-serve +serve|llama-server|mlx_lm\.server|tensorfold +serve|MLX-Serve\.app|ollama +serve|LM Studio/ {
      sub(/^ +/, ""); print substr($0, 1, 160) }')"
  if [[ -n "$servers" ]]; then
    printf '%s\n' "$servers" | sed 's/^/a model server is running: /'
  fi
  return 0
}
