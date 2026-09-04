#!/usr/bin/env bash
# install.sh -- install the combination that suits this machine.
#
#   ./install.sh                 pick and install the best fit
#   ./install.sh --list          what fits this machine, and what does not
#   ./install.sh --dry-run       show the choice, install nothing
#   ./install.sh llama           restrict to a model family
#   ./install.sh <combination>   install exactly this one
#
# Selection reads the combinations/ tree and probes the host; it does not carry
# a registry, so it keeps working as combinations are added. It narrows the
# field, then hands over to the combination's own installer, whose
# qualify_accel makes the real decision with measured thresholds and refuses
# with numbers if the machine falls short.

set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="${REPO_ROOT}/install.log"

# shellcheck source=lib/common.sh
. "${REPO_ROOT}/lib/common.sh"
# shellcheck source=lib/select.sh
. "${REPO_ROOT}/lib/select.sh"

DEFAULT_FAMILY="qwen"

usage() {
  cat <<'HELP'
install.sh -- install the combination that suits this machine.

USAGE
  ./install.sh [--list|--dry-run|--yes] [selector]

SELECTOR
  (none)              the best fit for this machine, default family
  <family>            e.g. qwen, llama -- best fit within that family
  <combination path>  e.g. qwen/3.8/27b/macos/64GB/mtplx-opencode
  all                 consider every family, not just the default

OPTIONS
  --list      show what fits this machine and what does not, then exit
  --dry-run   show what would be installed, then exit
  --yes       do not ask for confirmation
  --help      this text

Anything else is passed through to the combination's installer, so the
environment overrides documented there still work:

  QUANT=UD-Q3_K_XL ./install.sh
  SKIP_SMOKE_TEST=1 ./install.sh
HELP
}

ACTION="install"
ASSUME_YES=0
SELECTOR=""

while (( $# )); do
  case "$1" in
    --help|-h)  usage; exit 0 ;;
    --list)     ACTION="list"; shift ;;
    --dry-run)  ACTION="dry-run"; shift ;;
    --yes|-y)   ASSUME_YES=1; shift ;;
    -*)         echo "install.sh: unknown option '$1' (try --help)" >&2; exit 2 ;;
    *)
      [[ -n "$SELECTOR" ]] && { echo "install.sh: more than one selector given ('$SELECTOR', '$1')" >&2; exit 2; }
      SELECTOR="$1"; shift ;;
  esac
done

detect_host

# A selector containing a slash is a full combination path: the user has
# already decided, so selection steps out of the way entirely.
if [[ "$SELECTOR" == */* ]]; then
  [[ -d "${REPO_ROOT}/combinations/${SELECTOR}" ]] || err \
    "No such combination: ${SELECTOR}
       Available:
$(list_combinations | sed 's|^|         |')"
  CHOSEN="$SELECTOR"
  REASON="named explicitly"
else
  case "$SELECTOR" in
    ""|default) FAMILY="$DEFAULT_FAMILY" ;;
    all)        FAMILY="" ;;
    *)          FAMILY="$SELECTOR" ;;
  esac
  CHOSEN="$(best_for_host "$FAMILY")"
  REASON="best fit for this machine"
fi

if [[ "$ACTION" == "list" ]]; then
  echo "This machine"
  echo "  OS          ${HOST_OS_PRETTY} (${HOST_ARCH})"
  echo "  Accelerator ${HOST_ACCEL}"
  echo "  Memory      ${HOST_MEM_DESC}"
  echo
  echo "Combinations that fit${FAMILY:+ (family: ${FAMILY})}:"
  fits="$(candidates_for_host "${FAMILY:-}" || true)"
  if [[ -z "$fits" ]]; then
    echo "  (none)"
  else
    printf '%s\n' "$fits" | while IFS='|' read -r tier combo; do
      marker="  "; [[ "$combo" == "$CHOSEN" ]] && marker="->"
      printf '%s %-52s %s\n' "$marker" "$combo" "$(installer_script_for "$combo")"
    done
    echo
    echo "  -> is what ./install.sh would choose."
  fi
  echo
  echo "Everything in this repo:"
  list_combinations | sed 's|^|    |'
  exit 0
fi

if [[ -z "$CHOSEN" ]]; then
  explain_no_match "${FAMILY:-}"
  exit 1
fi

SCRIPT="$(installer_script_for "$CHOSEN")"
[[ -f "${REPO_ROOT}/${SCRIPT}" ]] || err \
  "Selected ${CHOSEN} but its installer ${SCRIPT} does not exist.
       Every combination needs a root pointer script; see docs/adding-a-combination.md."

echo "Machine   ${HOST_OS_PRETTY} (${HOST_ARCH}), ${HOST_MEM_DESC}"
echo "Selected  ${CHOSEN}"
echo "          (${REASON})"
echo "Installer ./${SCRIPT}"

# Say what else was possible, so an automatic choice is never a silent one.
others="$(candidates_for_host "${FAMILY:-}" | cut -d'|' -f2 | grep -vxF "$CHOSEN" || true)"
if [[ -n "$others" ]]; then
  echo
  echo "Also compatible with this machine:"
  printf '%s\n' "$others" | sed 's|^|  ./install.sh |'
fi

if [[ "$ACTION" == "dry-run" ]]; then
  echo
  echo "--dry-run: nothing was installed."
  exit 0
fi

if (( ! ASSUME_YES )) && [[ -t 0 ]]; then
  echo
  read -r -p "Install this combination? [Y/n] " reply
  case "${reply:-y}" in
    [Nn]*) echo "Nothing was installed."; exit 0 ;;
  esac
fi

echo
exec "${REPO_ROOT}/${SCRIPT}"
