#!/usr/bin/env bash
# Mini project: a shell script that commits and pushes a run's records (an audit hit in the shell category).
set -euo pipefail
run="$1"
git add "runs/$run"
git commit -m "run $run: records"
git push origin HEAD:main
