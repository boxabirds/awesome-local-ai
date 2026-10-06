#!/usr/bin/env bash
# installed-config.sh -- is the combination on this machine the one in this checkout?
#
# A harness release carries the harness. A combination's launcher (lib/runtime/server-<backend>.sh) and its
# profile (combinations/<combination>/profiles.tsv) are copied onto a machine by that combination's installer
# and by nothing else, so a fix to either can be committed, released, pulled by the node, and still not be
# running. On 5 October 2026 (A-046) exactly that happened: the Strata VRAM gate was fixed on main, the node
# had the new profile in its checkout, and the run failed twice against the old installed copy, quoting a figure
# that no longer existed in the repository. Nothing compared the two.
#
# The comparison is of the files themselves, not of a recorded hash. The installer copies both verbatim
# (`install -m 644 profiles.tsv`, `install -m 755 server-<backend>.sh`), so a byte comparison is exact; it needs
# no new manifest field, it works on every machine that is already installed, and it also catches an installed
# copy that was edited in place, which a hash written at install time would not.

# Report every installed file that differs from this checkout's copy. Prints the report on stdout and returns 1
# when anything differs, 0 when everything that can be compared matches.
#
#   installed_config_drift <install_id> <backend> <combo_dir> <repo_root>
#
# A pair is compared only when the checkout has the file: a cloud stack has no launcher in lib/runtime, and a
# reference stack has no combinations/ directory, and neither is drift. A file the checkout has and the machine
# does not IS drift -- whatever is installed, it is not this.
installed_config_drift() {
  local install_id="$1" backend="$2" combo_dir="$3" repo_root="$4"
  local share="${HOME}/.local/share/${install_id}" bin="${HOME}/.local/bin"
  local -a differs=()

  _installed_same "${share}/profiles.tsv" "${combo_dir}/profiles.tsv" \
    || differs+=("profiles.tsv: ${share}/profiles.tsv is not ${combo_dir}/profiles.tsv")
  _installed_same "${bin}/local-ai-${backend}-server" "${repo_root}/lib/runtime/server-${backend}.sh" \
    || differs+=("server-${backend}.sh: ${bin}/local-ai-${backend}-server is not ${repo_root}/lib/runtime/server-${backend}.sh")

  (( ${#differs[@]} )) || return 0

  echo "the combination installed on this machine is not the one in this checkout:"
  local d; for d in "${differs[@]}"; do echo "  ${d}"; done
  echo
  echo "A harness release does not carry a combination's launcher or profile; only its installer does."
  echo "Re-run the installer for ${install_id} on this machine -- it is idempotent and repairs in place:"
  echo
  echo "  ./$(_installer_for "$combo_dir")"
  return 1
}

# Two files are "the same" when both exist and their bytes match. A target the checkout does not have is not
# compared at all, which the caller distinguishes by asking first.
_installed_same() {
  local installed="$1" source="$2"
  [[ -f "$source"    ]] || return 0          # nothing to compare against
  [[ -f "$installed" ]] || return 1          # the checkout has it and the machine does not
  cmp -s "$installed" "$source"
}

# combinations/<a>/<b>/... -> install-a-b-....sh, the same rule as lib/run.sh's installer_for.
_installer_for() {
  local combo="${1##*/combinations/}"
  printf 'install-%s.sh' "$(printf '%s' "$combo" | tr '/' '-')"
}
