#!/usr/bin/env bash
# Serial A/B between two installed MTPLX combinations.
#
# Two rules, both learned the hard way and both non-negotiable:
#
#   Blocks are serial, never interleaved. The packs cannot be co-resident
#   (30 GB + 115 GB on a 128 GB machine), and interleaving turns thermal
#   recovery into a fake model effect -- it produced a 3x error in earlier
#   work on this hardware.
#
#   Each block cools to nominal before measuring. Sustained inference leaves
#   this class of machine at `heavy` for minutes after the load stops.
#
# Both arms serve on the SAME port with --model-id pinned. The request log is
# per-port, but every line carries served_model_id, so one log holds both arms
# and mtplx_session_report.py separates them. Same port also avoids the
# port-collision failure (errno 48) that produced a run with no results at all.
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

PORT="${PORT:-18093}"
CONTEXTS="${CONTEXTS:-1000,32000}"
OUT="${OUT:-$SCRIPT_DIR/results}"
mkdir -p "$OUT"

usage() {
  cat <<'HELP'
mtplx-ab.sh -- serial A/B between two installed MTPLX combinations.

USAGE
  ./mtplx-ab.sh <install-id-a> <install-id-b>
  ./mtplx-ab.sh --list

  e.g. ./mtplx-ab.sh mtplx-qwen38-27b mtplx-qwen38-flash-next

ENVIRONMENT
  PORT=18093        both arms serve here, one at a time
  CONTEXTS=1000,32000
  OUT=<dir>         default benchmarks/results (gitignored)
HELP
}

case "${1:-}" in
  -h|--help|"") usage; exit 0 ;;
  --list) ls -1 "$HOME/.local/share"/*/install.env 2>/dev/null \
            | sed 's|.*/share/||; s|/install.env||'; exit 0 ;;
esac
[[ $# -eq 2 ]] || { usage; exit 2; }

block() { # $1 install-id
  local id="$1"
  echo "=== BLOCK $id ==="
  echo "  cooling to thermal nominal first"
  python3 -c "
import sys; sys.path.insert(0, '$SCRIPT_DIR')
from thermal import wait_for_thermal
print('    reached thermal=' + wait_for_thermal('nominal', timeout_s=900))
"
  LOCAL_AI_INSTALL_REL=".local/share/$id" PORT="$PORT" CONTEXTS="$CONTEXTS" \
    OUT="$OUT" LABEL="$id" bash "$SCRIPT_DIR/mtplx-throughput.sh"
  echo "  block $id done"
  echo
}

block "$1"
block "$2"

echo "=== session-log comparison (both arms, one log) ==="
python3 "$SCRIPT_DIR/mtplx_session_report.py" --port "$PORT" --since 1d --compare || true
echo ALLDONE
