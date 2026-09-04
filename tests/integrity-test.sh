#!/usr/bin/env bash
# Model integrity: do the "is this already downloaded?" checks actually work?
#
# These guard the expensive failure modes -- re-pulling 107 GB that is already
# on disk, or serving from a pack whose shards never arrived.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DIR/.." && pwd)"
LOG_FILE="$(mktemp)"; export LOG_FILE
. "$DIR/lib.sh"
. "$REPO_ROOT/lib/common.sh"
INSTALL_ROOT="$(mktemp -d)"
. "$REPO_ROOT/lib/model.sh"
. "$REPO_ROOT/lib/mtplx.sh"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK" "$INSTALL_ROOT" "$LOG_FILE"' EXIT

echo "single-file assets: complete vs truncated"
dd if=/dev/zero of="$WORK/full" bs=1024 count=1024 2>/dev/null   # 1 MiB
dd if=/dev/zero of="$WORK/part" bs=1024 count=512  2>/dev/null   # 0.5 MiB
: > "$WORK/empty"
assert_ok    "a full file is complete"                   _asset_is_complete "$WORK/full"  "1 MiB"
assert_fails "a half file is not"                        _asset_is_complete "$WORK/part"  "1 MiB"
assert_fails "an empty file is not"                      _asset_is_complete "$WORK/empty" "1 MiB"
assert_fails "an absent file is not"                     _asset_is_complete "$WORK/gone"  "1 MiB"
assert_ok    "larger than declared is still complete"    _asset_is_complete "$WORK/full"  "0.9 MiB"
assert_fails "a 1 MiB file is not a 16.7 GiB model"      _asset_is_complete "$WORK/full"  "16.7 GiB"
assert_ok    "an unparseable size skips the check"       _asset_is_complete "$WORK/full"  "unknown"

echo
echo "sharded packs: the index must be backed by its shards"
PACK="$WORK/pack"; mkdir -p "$PACK"
cat > "$PACK/model.safetensors.index.json" <<'JSON'
{"weight_map": {"a.weight": "model-00001-of-00002.safetensors",
                "b.weight": "model-00002-of-00002.safetensors"}}
JSON
assert_fails "an index with no shards is incomplete"     _mtplx_shards_present "$PACK"
: > "$PACK/model-00001-of-00002.safetensors"
assert_fails "a zero-byte shard does not count"          _mtplx_shards_present "$PACK"
echo x > "$PACK/model-00001-of-00002.safetensors"
assert_fails "one shard of two is still incomplete"      _mtplx_shards_present "$PACK"
echo x > "$PACK/model-00002-of-00002.safetensors"
assert_ok   "both shards present is complete"            _mtplx_shards_present "$PACK"

NOIDX="$WORK/single"; mkdir -p "$NOIDX"
assert_ok   "a single-file pack has nothing to cross-check" _mtplx_shards_present "$NOIDX"

BADIDX="$WORK/bad"; mkdir -p "$BADIDX"
echo 'not json' > "$BADIDX/model.safetensors.index.json"
assert_fails "an unreadable index is incomplete"         _mtplx_shards_present "$BADIDX"

echo
echo "version comparison"
assert_ok    "2.10.1 >= 2.10.0"  _version_ge 2.10.1 2.10.0
assert_ok    "2.10.0 >= 2.10.0"  _version_ge 2.10.0 2.10.0
assert_fails "2.9.9  >= 2.10.0"  _version_ge 2.9.9  2.10.0
assert_ok    "3.0    >= 2.10.0"  _version_ge 3.0    2.10.0
assert_fails "2.1.0  >= 2.10.0"  _version_ge 2.1.0  2.10.0
assert_ok    "2.10   >= 2.10.0"  _version_ge 2.10   2.10.0

# The 2.10 -> 2.11 step is the case a naive string or single-digit compare gets
# wrong, and it is the floor every MTPLX combination currently ships. Pinned
# here so a rewrite of _version_ge cannot regress it silently.
assert_ok    "2.11.1 >= 2.10.0"  _version_ge 2.11.1 2.10.0
assert_ok    "2.11   >= 2.10.0"  _version_ge 2.11   2.10.0
assert_fails "2.10.1 >= 2.11.0"  _version_ge 2.10.1 2.11.0
assert_ok    "2.11.1 >= 2.11.0"  _version_ge 2.11.1 2.11.0
assert_fails "2.11.0 >= 2.11.1"  _version_ge 2.11.0 2.11.1
assert_ok    "2.11.1 >= 2.11.1"  _version_ge 2.11.1 2.11.1

finish
