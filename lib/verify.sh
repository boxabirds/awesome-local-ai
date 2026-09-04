#!/usr/bin/env bash
# lib/verify.sh -- turn the smoke test into a gate, and keep a way back.
#
# This repo deliberately floats on upstream. "The best configuration for this
# hardware" is a moving target: new kernels, new quant support and fixes land
# in the backend continuously, and pinning would freeze a user to whatever was
# best on the day the combination was written.
#
# The risk that creates is not drift, it is breakage: a backend that moved
# forward this morning can fail on the machine in front of you this afternoon.
# So verification here is not advisory.
#
#   * a failed smoke test fails the install -- non-zero exit, and no banner
#     claiming the thing is ready
#   * if a NEWER backend broke what an older one served, the older one is
#     rebuilt and verified instead, so the user is left with a configuration
#     that works rather than one that is merely current
#
# The known-good marker is written ONLY after verification passes, so it can
# never point at a build that was not observed working on this machine.
#
# Recovery is optional: a backend opts in by defining backend_current_ref and
# backend_rollback_to. One that cannot go back (a prebuilt package, say) simply
# does not, and verification fails without pretending otherwise.

VERIFY_STATUS="skipped"        # skipped | passed | recovered | failed
ROLLED_BACK_FROM=""
ROLLED_BACK_TO=""

_known_good_file() { printf '%s/.known-good-backend' "$INSTALL_ROOT"; }

_record_known_good() {
  declare -F backend_current_ref >/dev/null || return 0
  local ref; ref="$(backend_current_ref)"
  [[ -n "$ref" ]] || return 0
  printf '%s\n' "$ref" > "$(_known_good_file)"
}

_known_good_ref() {
  local f ref
  f="$(_known_good_file)"
  [[ -f "$f" ]] || return 1
  ref="$(cat "$f" 2>/dev/null || true)"
  [[ -n "$ref" ]] || return 1
  printf '%s' "$ref"
}

# smoke_test reports through globals, so clear them before a second attempt --
# otherwise the summary could describe the failed run.
_reset_smoke_state() {
  SMOKE_CTX=""; SMOKE_MEM=""; SMOKE_FREE=""; SMOKE_GEN=""; SMOKE_ACC=""; SMOKE_RSS=""
}

_can_recover() {
  declare -F backend_rollback_to >/dev/null && declare -F backend_current_ref >/dev/null
}

verify_install() {
  if [[ "${SKIP_SMOKE_TEST:-0}" == "1" ]]; then
    VERIFY_STATUS="skipped"
    warn "SKIP_SMOKE_TEST=1 -- nothing was verified on this machine."
    return 0
  fi

  if smoke_test; then
    VERIFY_STATUS="passed"
    _record_known_good
    return 0
  fi

  warn "Verification failed; see ${INSTALL_ROOT}/smoke.log"

  local good current
  if ! _can_recover; then
    VERIFY_STATUS="failed"; return 1
  fi
  if ! good="$(_known_good_ref)"; then
    info "No previously verified ${BACKEND} build to fall back to."
    VERIFY_STATUS="failed"; return 1
  fi
  current="$(backend_current_ref)"
  if [[ "$good" == "$current" ]]; then
    # The build that used to work IS the one that just failed, so the backend
    # is not the variable. Something else changed -- the device is busy, the
    # weights are damaged, the profile no longer fits. Rebuilding the same
    # commit would cost ten minutes and prove nothing.
    warn "The last verified ${BACKEND} build is the one that just failed; not rebuilding it."
    VERIFY_STATUS="failed"; return 1
  fi

  warn "=============================================================="
  warn " A newer ${BACKEND} did not pass verification on this machine."
  warn " Returning to the last build that did, and verifying again."
  warn "=============================================================="

  if ! backend_rollback_to "$good"; then
    VERIFY_STATUS="failed"; return 1
  fi

  # Only the binary changed; the manifest and shims still describe this
  # combination. But nothing is trusted here that was not just observed, so
  # the whole thing is verified again rather than assumed.
  _reset_smoke_state
  if smoke_test; then
    ROLLED_BACK_FROM="$current"
    ROLLED_BACK_TO="$good"
    VERIFY_STATUS="recovered"
    return 0
  fi

  VERIFY_STATUS="failed"
  return 1
}
