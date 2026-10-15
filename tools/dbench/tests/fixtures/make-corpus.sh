#!/bin/bash
# Writes the corpus of run file names the collector's classification check stands on (collect.rs, mod name_check).
#
#   git ls-files combinations benchmarks/reference > tracked.txt
#   make-corpus.sh --commit SHA --tracked tracked.txt [--node-names FILE]...     corpus on stdout
#   make-corpus.sh --list-node-runs DIR                    on a node: every file name of every run under DIR
#
# The first form reads the list of tracked files (the output of the command above), adds the names listed in each
# --node-names FILE (the output of the second form, captured on a live node), normalises them and prints the distinct
# names, with a header that names the commit and the counts. The script runs no version-control command itself. The
# test never runs this script; its output is committed as run-file-names.txt and regenerated on purpose.
#
# Normalisation: a story number becomes NN; a re-score or spoiled re-score folder name becomes V; the folder name under
# superseded/ becomes NAME; everything below an artifacts, screenshots, pre-suite-fix, scoring or base folder, and
# below superseded/NAME/, becomes NAME segment by segment (the last keeps its extension), which keeps the depth and
# drops the content; workspace/ and control/ become one line each. In-flight temporaries (a dot, a name, then .tmp or
# .partial) are dropped: they exist for moments and the classification names them as a class.
#
# Capture on a live node (read-only):
#   ssh NODE 'bash -s -- --list-node-runs REPO_DIR' < make-corpus.sh > node-NAME.names

set -u

TREE_ROOTS='artifacts|screenshots|pre-suite-fix|scoring-[0-9]+'
RUN_MARKER='run.json'

normalise() {
  awk -v tree_roots="$TREE_ROOTS" '
    function generic(rest,    n, parts, i, out, seg) {
      n = split(rest, parts, "/")
      out = ""
      for (i = 1; i <= n; i++) {
        seg = "NAME"
        if (i == n && match(parts[i], /\.[A-Za-z0-9]+$/)) seg = "NAME" substr(parts[i], RSTART)
        out = out (i > 1 ? "/" : "") seg
      }
      return out
    }
    {
      name = $0
      if (name ~ /(^|\/)\.[^\/]*\.(tmp|partial)$/) next
      if (name ~ /^workspace\//) { print "workspace/NAME"; next }
      if (name ~ /^control\//) { print "control/NAME"; next }
      while (match(name, /(^|\/)stories\/[0-9]+\//)) {
        name = substr(name, 1, RSTART - 1) (RSTART > 1 ? "/" : "") "stories/NN/" substr(name, RSTART + RLENGTH)
      }
      if (name ~ /^(prompts|agent-reports)\/story-[0-9]+\.md$/) sub(/story-[0-9]+/, "story-NN", name)
      if (name ~ /^rescore\//) sub(/^rescore\/[^\/]+\//, "rescore/V/", name)
      if (name ~ /^rescore-spoiled\//) sub(/^rescore-spoiled\/[^\/]+\//, "rescore-spoiled/V/", name)
      if (name ~ /^superseded\//) {
        rest = name; sub(/^superseded\/[^\/]+\/?/, "", rest)
        print "superseded/NAME" (rest == "" ? "" : "/" generic(rest)); next
      }
      if (name ~ /^base\//) { rest = name; sub(/^base\//, "", rest); print "base/" generic(rest); next }
      if (match(name, "stories/NN/(" tree_roots ")/")) {
        prefix = substr(name, 1, RSTART + RLENGTH - 1); rest = substr(name, RSTART + RLENGTH)
        sub(/scoring-[0-9]+\/$/, "scoring-N/", prefix)
        print prefix generic(rest); next
      }
      print name
    }'
}

# Every file name of every run directory under a repository checkout (node side). Needs only find and sed.
list_node_runs() {
  local repo="$1" marker dir top
  for top in "$repo/combinations" "$repo/benchmarks/reference"; do
    [ -d "$top" ] || continue
    find "$top" -path '*/workspace' -prune -o -type f -name "$RUN_MARKER" -print | while read -r marker; do
      dir=$(dirname "$marker")
      case "$dir" in
        */benchmarks/*/*) ;;
        *) continue ;;
      esac
      find "$dir" -path "$dir/workspace" -prune -o -type f -print | sed "s#^$dir/##"
      [ -d "$dir/workspace" ] && echo "workspace/x"
    done
  done
}

# The run-relative names of every tracked file under a run directory, one per line.
tracked_names() {
  awk '
    /^combinations\/.*\/benchmarks\/[^\/]+\/[^\/]+\/./ { sub(/^combinations\/.*\/benchmarks\/[^\/]+\/[^\/]+\//, ""); print; next }
    /^benchmarks\/reference\/[^\/]+\/[^\/]+\/[^\/]+\/./ { sub(/^benchmarks\/reference\/[^\/]+\/[^\/]+\/[^\/]+\//, ""); print }' "$1"
}

# "<kind> <run directory>" for every run directory with a tracked file; kind is combination or reference.
tracked_run_dirs() {
  awk '
    /^combinations\/.*\/benchmarks\/[^\/]+\/[^\/]+\/./ {
      d = $0; sub(/\/[^\/]+$/, "", d)
      while (d !~ /\/benchmarks\/[^\/]+\/[^\/]+$/) sub(/\/[^\/]+$/, "", d)
      print "combination", d; next
    }
    /^benchmarks\/reference\/[^\/]+\/[^\/]+\/[^\/]+\/./ { split($0, p, "/"); print "reference", p[1] "/" p[2] "/" p[3] "/" p[4] "/" p[5] }' "$1" | sort -u
}

main() {
  local tracked="" commit="unknown"
  local node_files=()
  while [ $# -gt 0 ]; do
    case "$1" in
      --list-node-runs) list_node_runs "$2"; return 0 ;;
      --tracked) tracked="$2"; shift 2 ;;
      --commit) commit="$2"; shift 2 ;;
      --node-names) node_files+=("$2"); shift 2 ;;
      *) echo "make-corpus.sh: unknown argument $1" >&2; return 2 ;;
    esac
  done
  [ -n "$tracked" ] || { echo "make-corpus.sh: --tracked FILE is required" >&2; return 2; }

  local dirs combos refs records_c records_r
  dirs=$(tracked_run_dirs "$tracked")
  combos=$(printf '%s\n' "$dirs" | grep -c '^combination ')
  refs=$(printf '%s\n' "$dirs" | grep -c '^reference ')
  records_c=$(grep -c "^combinations/.*/benchmarks/[^/]*/[^/]*/$RUN_MARKER\$" "$tracked")
  records_r=$(grep -c "^benchmarks/reference/[^/]*/[^/]*/[^/]*/$RUN_MARKER\$" "$tracked")

  echo "# Distinct run-relative file names (normalised, see make-corpus.sh). Regenerate on purpose; the tests never do."
  echo "# commit: $commit"
  echo "# tracked run directories: $((combos + refs)) (combination $combos, reference $refs)"
  echo "# tracked run records (run.json): $((records_c + records_r)) (combination $records_c, reference $records_r)"
  echo "# node listings merged: ${#node_files[@]}"
  {
    tracked_names "$tracked"
    for f in ${node_files[@]+"${node_files[@]}"}; do cat "$f"; done
  } | normalise | LC_ALL=C sort -u
}

main "$@"
