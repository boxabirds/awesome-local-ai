#!/usr/bin/env bash
# The cuts project's shell script: one function with two cuts, a guard and a use. Usage: cutsh.sh add|amend REPO RUN
set -u

vcs() {
  case "$2" in */) return 1 ;; esac
  return 0
}

publish_run() {
  local mode="$1" path="$2/$3" done
  if [[ "$mode" == "amend" ]]; then
    vcs amend "$path"
    done=$?
  else
    vcs add "$path"
    done=$?
  fi
  if [[ $done -ne 0 ]]; then
    echo "failed"
    return 1
  fi
  echo "ok:$path"
}

publish_run "$@"
