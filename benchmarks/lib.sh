#!/usr/bin/env bash
# benchmarks/lib.sh -- resolve an installed combination for the probe scripts.
#
# The harnesses in this directory measure whatever awesome-local-ai has
# installed. Rather than hardcoding model paths, they read the install manifest
# the installer wrote, so the same probe runs against any combination.
#
#   LOCAL_AI_INSTALL_REL=.local/share/<install-id>   which install to measure
#   OUT=<dir>                                        where logs land (default ./results)
#   USABLE_MIB=<n>   device memory actually available to the process, for the
#                    headroom column. NOT the card's nameplate size: on the
#                    RTX 4090 these numbers were taken on, 24564 MiB total left
#                    24047 MiB usable with a desktop running.

LOCAL_AI_INSTALL_REL="${LOCAL_AI_INSTALL_REL:-.local/share/qwen38-27b}"
ROOT="${LOCAL_AI_ROOT:-$HOME/$LOCAL_AI_INSTALL_REL}"

if [[ -f "$ROOT/install.env" ]]; then
  # shellcheck disable=SC1091
  . "$ROOT/install.env"
  # A backend that fetches single files keeps them under the install root; one
  # with its own model cache records a $HOME-relative path to it instead. The
  # artefact is a file in the first case and a directory in the second.
  if [[ -n "${MODEL_CACHE_ENV_VAR:-}" && -n "${!MODEL_CACHE_ENV_VAR:-}" ]]; then
    M="${!MODEL_CACHE_ENV_VAR}"
  elif [[ -d "$HOME/$MODEL_SUBDIR" ]]; then
    M="$HOME/$MODEL_SUBDIR"
  else
    M="$ROOT/$MODEL_SUBDIR"
  fi
  MODEL="$M/$MODEL_FILE"
  MMPROJ="${MMPROJ_FILE:+$M/$MMPROJ_FILE}"
  MTP="${MTP_FILE:+$M/$MTP_FILE}"
  SERVER_CMD="${SERVER_CMD:-local-ai-${BACKEND:-llamacpp}-server}"
else
  echo "benchmarks: no install manifest at $ROOT/install.env" >&2
  echo "Run the combination's install-*.sh first, or set LOCAL_AI_INSTALL_REL." >&2
  exit 1
fi

OUT="${OUT:-$(cd "$(dirname "${BASH_SOURCE[1]:-$0}")" && pwd)/results}"
mkdir -p "$OUT"

USABLE_MIB="${USABLE_MIB:-24047}"

# niah.py reads the model id from the environment.
export MODEL_ALIAS_DEFAULT

export PATH="$HOME/.local/bin:$PATH"
