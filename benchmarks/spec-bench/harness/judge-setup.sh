#!/usr/bin/env bash
# judge-setup.sh <package-name> [--ref origin/main] -- prepare a blinded grading package for an independent judge.
#
#   benchmarks/spec-bench/harness/judge-setup.sh vidi-v1
#
# Extracts gradings/<name> from the private pack repo (at --ref, fetched first) into
#   <private repo>/judging/<name>/
# without moving the checkout, which benchmark runs read their held-out suite from and must stay on
# its tag. judging/ is git-ignored locally, and every harness version hides the private repo from
# agents, so the package (spec, held-out tests, both builds) is never readable by a running agent.
# Writes <private repo>/judging/<name>.kickoff.md: the message to give the judge.
# When the judge is done: judge_collect.py <name> [--transcript FILE] --audit <build>=<audit.jsonl> ...
set -euo pipefail
HARNESS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[[ $# -ge 1 && "$1" != -h && "$1" != --help ]] || { sed -n '2,13p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0; }
NAME="$1"; shift
REF=origin/main
while [[ $# -gt 0 ]]; do
  case "$1" in
    --ref) REF="$2"; shift 2 ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done
# Ports the judge must avoid: a benchmark run on this machine serves the app on these.
JUDGE_ACCEPT_PORT=19787
BUSY_PORTS="8787, 18787 and 18788"

PRIVATE="$(cd "$HARNESS" && python3 -c 'import packdir; from pathlib import Path; r = packdir.private_root(packdir.resolve()); print(r or "")')"
[[ -n "$PRIVATE" ]] || { echo "no private pack repo next to this one (awesome-local-ai-bench-private); ask the owner for access" >&2; exit 1; }
DEST="$PRIVATE/judging/$NAME"
[[ -e "$DEST" ]] && { echo "$DEST already exists; the judge's work may be in it. Move it aside first." >&2; exit 1; }

git -C "$PRIVATE" fetch -q origin
git -C "$PRIVATE" cat-file -e "$REF:gradings/$NAME" 2>/dev/null || { echo "no gradings/$NAME at $REF" >&2; exit 1; }
EXCLUDE="$(git -C "$PRIVATE" rev-parse --path-format=absolute --git-path info/exclude)"
grep -qx '/judging/' "$EXCLUDE" 2>/dev/null || echo '/judging/' >> "$EXCLUDE"
mkdir -p "$DEST"
git -C "$PRIVATE" archive "$REF" "gradings/$NAME" | tar -x -C "$DEST" --strip-components=2
[[ -f "$DEST/GRADING.md" ]] || { echo "extraction failed: no GRADING.md in $DEST" >&2; exit 1; }

cat > "$PRIVATE/judging/$NAME.kickoff.md" <<EOF
Read \`GRADING.md\` in this folder and follow it exactly. Work only from files in this folder; don't
read anything outside it, including any other repository. Write your output files (\`build-A.jsonl\`,
\`build-B.jsonl\`, \`test-faults.jsonl\`, \`summary.md\`) in this folder. When you run a build or the
held-out tests (step 5), set \`ACCEPT_PORT=$JUDGE_ACCEPT_PORT\` and don't use ports $BUSY_PORTS for
anything you start: a benchmark may be running on this machine.
EOF

echo "package ready:  $DEST"
echo "  brief:        $(grep -c '' "$DEST/GRADING.md") lines, from $REF ($(git -C "$PRIVATE" rev-parse --short "$REF"))"
echo "  builds:       $(ls -d "$DEST"/build-* | xargs -n1 basename | tr '\n' ' ')"
echo
echo "1. Start the judge in $DEST, with access to that folder only if its tool allows it."
echo "2. Give it this message ($PRIVATE/judging/$NAME.kickoff.md):"
echo
sed 's/^/     /' "$PRIVATE/judging/$NAME.kickoff.md"
echo
echo "3. Keep its session transcript. Then: benchmarks/spec-bench/harness/judge_collect.py $NAME --transcript <file> --audit <build>=<audit.jsonl> ..."
