#!/usr/bin/env bash
# scripts/vidi-mosaic.sh: reading recorded traces, choosing and placing clips, the refusals, and one small real render
# whose pixels are checked (the hero alone at the start, the whole wall with its text at the end). The recordings
# are synthetic: tiny traces built here, so nothing private and nothing slow is needed.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DIR/.." && pwd)"
. "$DIR/lib.sh"

SCRIPT="${VIDI_MOSAIC_SCRIPT:-$REPO_ROOT/scripts/vidi-mosaic.sh}"   # the override lets a broken copy prove the tests can fail
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
REC="$WORK/recordings"
TEST_DIR_NAME="story-03-story-3-s03-creat-92a12-rson-ref-prd-live-propagate-chromium"
OTHER_TEST_DIR_NAME="story-03-story-3-s03-late--69178-tes-ref-prd-live-join-state-chromium"
FRAME_SPACING_MS=100
SRC_W=320
SRC_H=200

# Two images: a blank page (a small file) and an app screen (a bigger one, so the blank detector can tell them apart).
mkdir -p "$WORK/img"
ffmpeg -v error -y -f lavfi -i "color=c=white:s=${SRC_W}x${SRC_H}" -frames:v 1 "$WORK/img/blank.jpg"
ffmpeg -v error -y -f lavfi -i "testsrc2=s=${SRC_W}x${SRC_H}:r=1" -frames:v 1 "$WORK/img/app.jpg"

# fixture NAME FRAMES_PER_PAGE BLANK_LEADING_FRAMES [TEST_DIR]: a trace.zip for two pages whose frames arrive every
# FRAME_SPACING_MS; the first BLANK_LEADING_FRAMES of each page are the blank page.
fixture() {
  local name="$1" frames="$2" blanks="$3" testdir="${4:-$TEST_DIR_NAME}" d p i t src
  d="$(mktemp -d "$WORK/fx.XXXXXX")"; mkdir -p "$d/resources"
  for ((p = 0; p < ${FIXTURE_PAGES:-2}; p++)); do
    : > "$d/$p-trace.trace"
    for ((i = 0; i < frames; i++)); do
      t=$((1000 + i * FRAME_SPACING_MS + p * 7))
      src="$WORK/img/app.jpg"; [ "$i" -lt "$blanks" ] && src="$WORK/img/blank.jpg"
      cp "$src" "$d/resources/page@P$p-$i.jpeg"
      printf '{"type":"screencast-frame","pageId":"page@P%s","sha1":"page@P%s-%s.jpeg","width":%s,"height":%s,"timestamp":%s}\n' \
        "$p" "$p" "$i" "$SRC_W" "$SRC_H" "$t" >> "$d/$p-trace.trace"
    done
  done
  mkdir -p "${FIXTURE_REC:-$REC}/$name/artifacts/$testdir"
  (cd "$d" && zip -q -r "${FIXTURE_REC:-$REC}/$name/artifacts/$testdir/trace.zip" . )
  rm -rf "$d"
}

# Six recordings that count: 40 frames (a 3.9 s clip), 30, 25 (with 3 blank leading frames), 20, 15, 12. Two that do
# not: 4 frames (a blank or failed build). One of another test of the same story, which must not be picked up.
fixture ra 40 0
fixture rb 30 0
fixture rc 25 3
fixture rd 20 0
fixture re 15 0
fixture rf 12 0
fixture rg 4 0
fixture rh 4 0
fixture ri 40 0 "$OTHER_TEST_DIR_NAME"

run() { "$SCRIPT" --recordings "$REC" "$@"; }

echo "listing"
OUT="$(run --list 2>&1)"
assert_ok "finds the traces of the named test only (8, not the 9th of another test)" grep -q '^8 found, 6 usable, 2 skipped' <<<"$OUT"
assert_eq "a build with 4 frames is skipped" "skip" "$(awk '$2=="rg"{print $1}' <<<"$OUT")"
# The lead runs from the first frame of either page to when both have left the blank page; page 1 here starts 7 ms late.
assert_eq "the blank lead of 3 frames at 100 ms, plus page 1 starting 7 ms late, is 307 ms" "307" "$(awk '$2=="rc"{print $6}' <<<"$OUT")"
assert_eq "a build with no blank frames has only the 7 ms page 1 starts late" "7" "$(awk '$2=="ra"{print $6}' <<<"$OUT")"
OUT_ALL="$(run --test "" --list 2>&1)"
assert_ok "an empty --test takes every test of the story" grep -q '^9 found' <<<"$OUT_ALL"
OUT_KB="$(run --keep-blank --list 2>&1)"
assert_eq "--keep-blank leaves the lead at 0" "0" "$(awk '$2=="rc"{print $6}' <<<"$OUT_KB")"

echo "plan"
PLAN="$(run --cols 3 --rows 2 --count 4 --hero-cell 0,1 --dry-run 2>&1)"
assert_ok "text cells are what the clips leave over" grep -q '^wall: 3x2 cells, 4 clips, 2 text cells' <<<"$PLAN"
assert_ok "the text sits in the last two cells of the last row" grep -q 'text: cells 1..2 of the last row' <<<"$PLAN"
assert_eq "the hero is the clip with the most frames (the first, 40 frames)" "0" "$(sed -n 's/^hero: clip \([0-9]*\) .*/\1/p' <<<"$PLAN")"
assert_eq "four clips are placed" "4" "$(grep -c '^  clip ' <<<"$PLAN")"
assert_eq "the hero is in the cell asked for" "0,1" "$(sed -n 's/^hero: .* in cell \(.*\)$/\1/p' <<<"$PLAN")"
CELLS_USED="$(sed -n 's/^  clip [0-9]* *cell \([0-9]*,[0-9]*\).*/\1/p' <<<"$PLAN" | sort | uniq | wc -l | tr -d ' ')"
assert_eq "no two clips share a cell" "4" "$CELLS_USED"
assert_eq "no clip sits in a text cell (row 1, columns 1 and 2)" "0" "$(sed -n 's/^  clip [0-9]* *cell \([0-9]*,[0-9]*\).*/\1/p' <<<"$PLAN" | grep -c -E '^(1,1|2,1)$')"
# 39 frames at 100 ms is a 3.9 s span; the 4 s cap leaves it, speed 1 plays it in real time plus the 0.6 s tail.
TIMING="$(run --cols 3 --rows 2 --count 4 --hero-cell 0,1 --speed 1 --zoom-seconds 1 --end-pad 1 --dry-run 2>&1 | sed -n 's/^timing: .*video \(.*\)s$/\1/p')"
assert_eq "the video lasts the longest clip plus the end pad" "5.500" "$TIMING"
CAPPED="$(run --cols 3 --rows 2 --count 4 --hero-cell 0,1 --speed 1 --zoom-seconds 1 --max-clip 2 --end-pad 1 --dry-run 2>&1 | sed -n 's/^timing: .*video \(.*\)s$/\1/p')"
assert_eq "--max-clip caps the longest clip at 2 s (+0.6 tail +1 pad)" "3.600" "$CAPPED"

echo "refusals"
assert_fails "more clips than usable recordings" "$SCRIPT" --recordings "$REC" --count 7 --cols 4 --rows 2 --dry-run
MSG="$(run --count 7 --cols 4 --rows 2 --dry-run 2>&1)"
assert_ok "it says how many are usable and why the rest were skipped" grep -q 'only 6 are usable (2 of 8 skipped' <<<"$MSG"
assert_fails "more clips than cells" "$SCRIPT" --recordings "$REC" --count 6 --cols 2 --rows 2 --dry-run
assert_fails "a text strip wider than one row" "$SCRIPT" --recordings "$REC" --count 2 --cols 2 --rows 2 --dry-run
assert_fails "the hero in a text cell" "$SCRIPT" --recordings "$REC" --cols 3 --rows 2 --count 4 --hero-cell 2,1 --dry-run
assert_fails "no recordings folder given" env -u VIDI_RECORDINGS "$SCRIPT" --dry-run
assert_fails "a folder that does not exist" "$SCRIPT" --recordings "$WORK/nope" --dry-run
assert_fails "a story with no traces" "$SCRIPT" --recordings "$REC" --story 9 --dry-run
assert_fails "a bad number" "$SCRIPT" --recordings "$REC" --cols x --dry-run
assert_fails "a zero speed" "$SCRIPT" --recordings "$REC" --speed 0 --dry-run
assert_fails "an unknown option" "$SCRIPT" --recordings "$REC" --bogus --dry-run

echo "render"
OUTFILE="$WORK/wall.mp4"
W=320; H=180; F=10
run --cols 3 --rows 2 --count 4 --hero-cell 0,1 --width $W --height $H --fps $F --crf 35 --preset ultrafast \
    --speed 1 --zoom-seconds 1 --end-pad 1 --bg 0x0b0d12 --font /System/Library/Fonts/Helvetica.ttc \
    --work "$WORK/render" --out "$OUTFILE" >/dev/null 2>"$WORK/render.err"
assert_ok "the render succeeds" test $? -eq 0
assert_ok "the video exists" test -s "$OUTFILE"
GOT="$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,width,height -of csv=p=0 "$OUTFILE")"
assert_eq "an h264 video of the size asked for" "h264,$W,$H" "$GOT"
DUR="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUTFILE")"
assert_ok "it lasts the planned 5.5 s (within a frame or two)" awk -v d="$DUR" 'BEGIN{exit !(d > 5.3 && d < 5.7)}'


# region_mean FILE SECONDS X Y W H: the mean grey level (0..255) of a rectangle of one frame.
region_mean() {
  ffmpeg -v error -ss "$2" -i "$1" -vf "crop=$5:$6:$3:$4,format=gray" -frames:v 1 -f rawvideo - 2>/dev/null |
    od -An -tu1 | tr -s ' ' '\n' | awk 'NF{s += $1; n++} END{printf "%d", n ? s / n : -1}'
}
# bright_pixels FILE SECONDS X Y W H: how many pixels in a rectangle are near white.
bright_pixels() {
  ffmpeg -v error -ss "$2" -i "$1" -vf "crop=$5:$6:$3:$4,format=gray" -frames:v 1 -f rawvideo - 2>/dev/null |
    od -An -tu1 | tr -s ' ' '\n' | awk '$1 > 200{n++} END{print n+0}'
}
BG_MAX_MEAN=25   # the background 0x0b0d12 is about 13 in grey; the synthetic app screen is far brighter
CLIP_MIN_MEAN=50
# Geometry at 320x180, 3x2, gap 8: cells are 96x78. The hero (cell 0,1) fills the frame's height at the start, so it
# spans x 49..271; the cell to its right is a text cell and the cell above it is out of view. The top-right cell (2,0)
# spans x 208..304, y 8..86 at the end. The text strip (cells 1..2 of the last row) spans x 112..320, y 102..180.
START_RIGHT="$(region_mean "$OUTFILE" 0 275 20 25 50)"
START_HERO="$(region_mean "$OUTFILE" 0 130 70 60 40)"
END_RIGHT="$(region_mean "$OUTFILE" 5.3 275 20 25 50)"
assert_ok "at the start the neighbours are hidden: right of the hero is background (mean $START_RIGHT)" test "$START_RIGHT" -lt "$BG_MAX_MEAN"
assert_ok "at the start the hero fills the middle of the frame (mean $START_HERO)" test "$START_HERO" -gt "$CLIP_MIN_MEAN"
assert_ok "at the end the same place shows a clip (mean $END_RIGHT)" test "$END_RIGHT" -gt "$CLIP_MIN_MEAN"
BRIGHT_END="$(bright_pixels "$OUTFILE" 5.3 112 102 208 78)"
assert_ok "at the end the text strip has near-white pixels, the text ($BRIGHT_END)" test "$BRIGHT_END" -gt 20


# A clip that ends before the pull-back does must keep shrinking with the camera. If its tile has no frames left it
# freezes at the size it had when the clip ended, and covers the gutters and the neighbouring cells. Here every clip
# is at most 1 s plus the 0.6 s tail and the pull-back lasts 3 s.
echo "render: clips shorter than the pull-back"
LONGZOOM="$WORK/wall-longzoom.mp4"
run --cols 3 --rows 2 --count 4 --hero-cell 0,1 --width $W --height $H --fps $F --crf 35 --preset ultrafast \
    --speed 1 --max-clip 1 --zoom-seconds 3 --min-hold 1 --end-pad 0 --bg 0x0b0d12 \
    --font /System/Library/Fonts/Helvetica.ttc --work "$WORK/render2" --out "$LONGZOOM" >/dev/null 2>"$WORK/render2.err"
assert_ok "the render succeeds" test $? -eq 0
# gutters at the end: x 104..112 between columns 0 and 1 (and 208..216 between 1 and 2), y 86..94 between the rows
LZ_AT=3.6
GUTTER_V1="$(region_mean "$LONGZOOM" $LZ_AT 105 10 6 60)"
GUTTER_V2="$(region_mean "$LONGZOOM" $LZ_AT 209 10 6 60)"
GUTTER_H="$(region_mean "$LONGZOOM" $LZ_AT 10 87 60 6)"
assert_ok "the gutter between columns 0 and 1 is background at the end (mean $GUTTER_V1)" test "$GUTTER_V1" -lt "$BG_MAX_MEAN"
assert_ok "the gutter between columns 1 and 2 is background at the end (mean $GUTTER_V2)" test "$GUTTER_V2" -lt "$BG_MAX_MEAN"
assert_ok "the gutter between the rows is background at the end (mean $GUTTER_H)" test "$GUTTER_H" -lt "$BG_MAX_MEAN"

# A test that runs one browser (a single-user story) has one page per trace. The tile is that page alone, with no
# second page to stack it on.
echo "render: single-page recordings"
REC1="$WORK/rec1"
for n in sa sb sc sd; do FIXTURE_REC="$REC1" FIXTURE_PAGES=1 fixture "$n" 30 0; done
ONEPAGE="$WORK/wall-onepage.mp4"
"$SCRIPT" --recordings "$REC1" --cols 3 --rows 2 --count 4 --hero-cell 0,1 --width $W --height $H --fps $F --crf 35 \
    --preset ultrafast --speed 1 --zoom-seconds 1 --end-pad 1 --bg 0x0b0d12 --font /System/Library/Fonts/Helvetica.ttc \
    --work "$WORK/render3" --out "$ONEPAGE" >/dev/null 2>"$WORK/render3.err"
assert_ok "a render of single-page recordings succeeds" test $? -eq 0
assert_ok "the video exists" test -s "$ONEPAGE"
ONE_END="$(region_mean "$ONEPAGE" 3.2 275 20 25 50)"
assert_ok "at the end a single-page clip shows in its cell (mean $ONE_END)" test "$ONE_END" -gt "$CLIP_MIN_MEAN"


# The concat lists name each frame by path, and ffmpeg reads them from another directory, so a relative --work must
# be made absolute.
echo "render: relative work folder"
(cd "$WORK" && "$SCRIPT" --recordings "$REC" --cols 3 --rows 2 --count 4 --hero-cell 0,1 --width $W --height $H --fps $F \
    --crf 35 --preset ultrafast --speed 1 --zoom-seconds 1 --end-pad 1 --bg 0x0b0d12 \
    --font /System/Library/Fonts/Helvetica.ttc --work rel-work --out rel.mp4 >/dev/null 2>"$WORK/render4.err")
assert_ok "a render with a relative --work and --out succeeds" test $? -eq 0
assert_ok "the video exists" test -s "$WORK/rel.mp4"

# The wall is composited in a format with full-resolution colour. In 4:2:0 the overlay snaps every tile's position to an
# even pixel, so a tile moves in 2 px jumps and its per-frame step jitters (16, 16, 14, 16...): a steppy zoom. Follow
# the left edge of the hero along one scanline through the pull-back: with whole-pixel positions about half of them are
# odd; with the snap none are.
echo "render: smooth zoom"
SMOOTH="$WORK/wall-smooth.mp4"
SW_=640; SH_=360; SF_=20; SZ_=3
run --cols 3 --rows 2 --count 4 --hero-cell 0,1 --width $SW_ --height $SH_ --fps $SF_ --crf 18 --preset ultrafast \
    --speed 1 --zoom-seconds $SZ_ --min-hold 0.5 --end-pad 0 --bg 0x0b0d12 --font /System/Library/Fonts/Helvetica.ttc \
    --work "$WORK/render5" --out "$SMOOTH" >/dev/null 2>"$WORK/render5.err"
assert_ok "the render succeeds" test $? -eq 0
EDGE_MIN_BRIGHT=30   # above the background (about 13), below the synthetic app screen
# One line per frame: the x of the first pixel brighter than EDGE_MIN_BRIGHT on the scanline, or -1 if none.
ffmpeg -v error -y -t $SZ_ -i "$SMOOTH" -vf "format=gray,crop=$SW_:1:0:270" -f rawvideo "$WORK/scan.raw" 2>/dev/null
EDGES="$(od -An -v -tu1 "$WORK/scan.raw" | awk -v w=$SW_ -v m=$EDGE_MIN_BRIGHT '
  { for (i = 1; i <= NF; i++) { v[n % w] = $i; n++
      if (n % w == 0) { e = -1; for (x = 0; x < w; x++) if (v[x] > m) { e = x; break }; print e } } }')"
EDGE_SAMPLES="$(awk '$1 > 0' <<<"$EDGES" | wc -l | tr -d ' ')"
EDGE_ODD="$(awk '$1 > 0 && $1 % 2 == 1' <<<"$EDGES" | wc -l | tr -d ' ')"
assert_ok "the hero's edge is followed for most of the pull-back ($EDGE_SAMPLES frames)" test "$EDGE_SAMPLES" -gt 20
assert_ok "its positions are not snapped to even pixels ($EDGE_ODD odd of $EDGE_SAMPLES)" test $((EDGE_ODD * 4)) -ge "$EDGE_SAMPLES"


# --captions FILE: a recording's caption is drawn on its tile, over a dark band along the bottom, and grows and shrinks
# with the tile. The hero (ra, the longest clip) fills the frame's height at the start, spanning x 103..537.
echo "captions"
CAPFILE="$WORK/captions.tsv"
printf 'ra\tMinisforum Strix Halo\\nGufo 0.5.0\n' > "$CAPFILE"
CAP_ARGS=(--cols 3 --rows 2 --count 4 --hero-cell 0,1 --width 640 --height 360 --fps 10 --crf 18 --preset ultrafast
          --speed 1 --zoom-seconds 1 --end-pad 1 --bg 0x0b0d12 --font /System/Library/Fonts/Helvetica.ttc)
PLAIN="$WORK/wall-nocap.mp4"; CAPPED_V="$WORK/wall-cap.mp4"
run "${CAP_ARGS[@]}" --work "$WORK/render6" --out "$PLAIN" >/dev/null 2>&1
run "${CAP_ARGS[@]}" --captions "$CAPFILE" --keep-uncaptioned --work "$WORK/render7" --out "$CAPPED_V" >"$WORK/render7.out" 2>"$WORK/render7.err"
assert_ok "a render with captions succeeds" test $? -eq 0
assert_ok "the plan says how many clips have a caption" grep -q 'captions: 1 of 4 clips' "$WORK/render7.err"
STRIP_PLAIN="$(region_mean "$PLAIN" 0 120 322 400 34)"
STRIP_CAP="$(region_mean "$CAPPED_V" 0 120 322 400 34)"
assert_ok "the caption's dark band lowers the brightness of the tile's bottom strip ($STRIP_CAP against $STRIP_PLAIN)" \
  test "$STRIP_CAP" -ge 0 -a "$STRIP_CAP" -lt $((STRIP_PLAIN - 20))
TEXT_PIXELS="$(bright_pixels "$CAPPED_V" 0 120 322 400 34)"
assert_ok "white text sits in that strip ($TEXT_PIXELS near-white pixels)" test "$TEXT_PIXELS" -gt 150
ABOVE_PLAIN="$(region_mean "$PLAIN" 0 120 60 400 100)"
ABOVE_CAP="$(region_mean "$CAPPED_V" 0 120 60 400 100)"
assert_eq "above the band the tile is unchanged" "$ABOVE_PLAIN" "$ABOVE_CAP"
assert_ok "a captions file that does not exist is refused by name" grep -q "captions file not found" <(run --captions "$WORK/nope.tsv" --dry-run 2>&1)


# With --captions, only recordings that have a caption are used: a tile with no name could be anything, and the wall
# is of named local builds. --keep-uncaptioned lifts that.
echo "captions: only named recordings"
SEL="$WORK/sel.tsv"
printf 'ra\tMachine\\nEngine\nrb\tMachine\\nEngine\nzz\tNo such recording\n' > "$SEL"
SELPLAN="$(run --cols 2 --rows 2 --count 2 --hero-cell 0,0 --captions "$SEL" --dry-run 2>&1)"
assert_ok "two usable recordings have a caption" grep -q 'captions: 2 of 2 clips' <<<"$SELPLAN"
assert_ok "the plan says how many were set aside for having no caption" grep -q '4 usable recordings have no caption and are not used' <<<"$SELPLAN"
assert_eq "only the captioned recordings are placed" "ra rb" "$(sed -n 's/^  clip [0-9]* *cell [0-9,]*  \(.*\)$/\1/p' <<<"$SELPLAN" | sort | paste -sd' ' -)"
SELMSG="$(run --cols 3 --rows 2 --count 3 --captions "$SEL" --dry-run 2>&1)"
assert_ok "asking for more clips than are captioned is refused, with the numbers" grep -q 'only 2 are usable and have a caption' <<<"$SELMSG"
KEPT="$(run --cols 3 --rows 2 --count 4 --hero-cell 0,0 --captions "$SEL" --keep-uncaptioned --dry-run 2>&1)"
assert_ok "--keep-uncaptioned uses recordings with no caption too" grep -q 'captions: 2 of 4 clips' <<<"$KEPT"


finish
