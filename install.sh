#!/usr/bin/env bash
# install.sh -- install the combination that suits this machine.
#
#   ./install.sh                 pick and install the best fit
#   ./install.sh --list          what fits this machine, and what does not
#   ./install.sh --dry-run       show the choice, install nothing
#   ./install.sh llama           restrict to a model family
#   ./install.sh <combination>   install exactly this one
#   ./install.sh --client pi     make Pi the default client for the install
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
  (none)              on a terminal: an interactive menu; otherwise the best fit
  <family>            e.g. qwen, llama -- best fit within that family
  <combination path>  e.g. qwen/3.8/27b/macos/64GB/mtplx-opencode
  all                 consider every family, not just the default

OPTIONS
   --list             show what fits this machine and what does not, then exit
   --dry-run          show what would be installed, then exit
   --yes              do not ask for confirmation
   --client <name>    which coding agent to make the default (pi, opencode)
   --help             this text

Every client adapter is installed either way; --client only picks the default
(the one `./start.sh <id>` launches with no client name). Any client can be
selected at run time, e.g. `./start.sh <id> --pi`. The environment form
`CLIENT=pi ./install.sh` is equivalent.

Anything else is passed through to the combination's installer, so the
environment overrides documented there still work:

  QUANT=UD-Q3_K_XL ./install.sh
  SKIP_SMOKE_TEST=1 ./install.sh
HELP
}

# Interactive menu for a bare `./install.sh` (no selector, a TTY, not --yes).
# Lists every combination, annotates each against this machine, and lets the
# user pick one by number. The best fit is line 1 and the default; 'q' cancels.
# Sets PICKED_COMBO and returns 0 on a pick, 1 on cancel. Picking something
# that won't fit is allowed -- the combination's own installer then refuses
# with measured numbers (selection narrows, qualification decides).
pick_combination_interactive() {
  local best compatible combo default
  local -a ordered=()
  best="$(best_for_host '' || true)"
  compatible="$(candidates_for_host '' | cut -d'|' -f2 || true)"

  # Order: best fit, then the rest of the compatible set, then everything else.
  if [[ -n "$best" ]]; then ordered+=("$best"); fi
  while IFS= read -r combo; do
    if [[ -n "$combo" && "$combo" != "$best" ]]; then ordered+=("$combo"); fi
  done < <(printf '%s\n' "$compatible")
  while IFS= read -r combo; do
    [[ -n "$combo" ]] || continue
    if ! grep -qxF "$combo" <<<"$compatible"; then ordered+=("$combo"); fi
  done < <(list_combinations)

  default="${ordered[0]:-}"
  printf 'Combinations for %s (%s)\n\n' "$HOST_OS_PRETTY" "$HOST_MEM_DESC"
  local i=1
  for combo in "${ordered[@]}"; do
    local fit="won't fit"
    if [[ "$combo" == "$best" ]]; then
      fit="best fit"
    elif grep -qxF "$combo" <<<"$compatible"; then
      fit="compatible"
    fi
    local note="$fit"
    if [[ "$combo" == "$default" ]]; then note="$fit, default"; fi
    printf '  %2d) %-58s [%s]\n' "$i" "$combo" "$note"
    i=$((i+1))
  done
  printf '\n'

  local choice
  read -r -p "Install which? [1-$((i-1)), default 1, q to cancel] " choice
  case "$choice" in
    '')        PICKED_COMBO="$default" ;;
    [qQ]*)     return 1 ;;
    *[!0-9]*)  echo "install.sh: enter a number (1-$((i-1))) or q" >&2; return 1 ;;
    *)
      if (( choice >= 1 && choice <= i-1 )); then
        PICKED_COMBO="${ordered[choice-1]}"
      else
        echo "install.sh: $choice is out of range (1-$((i-1)))" >&2; return 1
      fi
      ;;
  esac
  return 0
}

ACTION="install"
ASSUME_YES=0
SELECTOR=""
CLIENT_CHOICE=""

while (( $# )); do
  case "$1" in
    --help|-h)  usage; exit 0 ;;
    --list)     ACTION="list"; shift ;;
    --dry-run)  ACTION="dry-run"; shift ;;
    --yes|-y)   ASSUME_YES=1; shift ;;
    --client)
      [[ $# -ge 2 ]] || { echo "install.sh: --client needs a name (e.g. pi, opencode)" >&2; exit 2; }
      CLIENT_CHOICE="$2"; shift 2 ;;
    -*)         echo "install.sh: unknown option '$1' (try --help)" >&2; exit 2 ;;
    *)
      [[ -n "$SELECTOR" ]] && { echo "install.sh: more than one selector given ('$SELECTOR', '$1')" >&2; exit 2; }
      SELECTOR="$1"; shift ;;
  esac
done

# The client to make the default for this install. Validated now, exported so
# the combination's config.sh (CLIENT="${CLIENT:-opencode}") picks it up. The
# CLIENT=pi ./install.sh environment form works too; --client is just sugar.
if [[ -n "$CLIENT_CHOICE" ]]; then
  [[ -f "${REPO_ROOT}/lib/clients/${CLIENT_CHOICE}.sh" ]] || err \
    "No client adapter for --client '${CLIENT_CHOICE}' (expected lib/clients/${CLIENT_CHOICE}.sh)."
  export CLIENT="$CLIENT_CHOICE"
fi

detect_host

PICKED_VIA_MENU=0
PICKED_COMBO=""

# A selector containing a slash is a full combination path: the user has
# already decided, so selection steps out of the way entirely.
if [[ "$SELECTOR" == */* ]]; then
  [[ -d "${REPO_ROOT}/combinations/${SELECTOR}" ]] || err \
    "No such combination: ${SELECTOR}
       Available:
$(list_combinations | sed 's|^|         |')"
  CHOSEN="$SELECTOR"
  REASON="named explicitly"
elif [[ -z "$SELECTOR" && "$ACTION" == "install" && -t 0 ]] && (( ASSUME_YES == 0 )); then
  # Bare `./install.sh` on a terminal: show a menu instead of picking silently.
  # A selector, --yes, --dry-run or --list keeps the automatic (scriptable) path.
  if pick_combination_interactive; then
    CHOSEN="$PICKED_COMBO"
    REASON="chosen from the menu"
    PICKED_VIA_MENU=1
    FAMILY=""
  else
    echo "Nothing was installed."
    exit 0
  fi
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

if (( ! ASSUME_YES )) && [[ -t 0 ]] && (( ! PICKED_VIA_MENU )); then
  echo
  read -r -p "Install this combination? [Y/n] " reply
  case "${reply:-y}" in
    [Nn]*) echo "Nothing was installed."; exit 0 ;;
  esac
fi

echo
exec "${REPO_ROOT}/${SCRIPT}"
