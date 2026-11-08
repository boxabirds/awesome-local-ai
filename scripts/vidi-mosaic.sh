#!/usr/bin/env bash
# vidi-mosaic.sh -- a zoom-out video wall of Vidi builds all playing the same story at once.
#
# It starts on one build (the "hero") filling the frame, then pulls back until every build is on screen in a
# grid, with a text strip in the cells left over, and holds there until the last clip has played out.
#
# Where the footage comes from: the gallery records each story's held-out tests with Playwright. A story with
# two people in it (live sync) has no video file, only a trace.zip holding screencast frames and their
# timestamps for each person's page. This script rebuilds a clip from those frames (one page above the other,
# or side by side), then composes the clips with ffmpeg. Nothing is re-run and nothing is scored.
#
# Needs: ffmpeg (with libx264 and drawtext), ffprobe, jq, unzip, awk.
set -euo pipefail

readonly PROG="${0##*/}"

# ---- defaults: every one is a flag ------------------------------------------------------------------------------
RECORDINGS="${VIDI_RECORDINGS:-}"  # the gallery's recordings folder: <recording>/artifacts/<test>/trace.zip
STORY=3                            # which story's clips (3 = live sync, the one with two people in it)
TEST="propagate"                   # keep tests whose folder name contains this ("" keeps every test of the story)
COLS=9
ROWS=6
COUNT=51                           # clips on the wall
TEXT_CELLS=""                      # cells kept free for the text; default: the cells the clips leave over
TEXT='51 Miro Clones\nover 3 weeks'
FONT="/System/Library/Fonts/Helvetica.ttc"
WIDTH=1920
HEIGHT=1080
FPS=30
ZOOM_SECONDS=5                     # the pull-back: from the hero filling the frame to the whole wall
SPEED=0.3                          # clip playback speed; the recorded story is about a second long
TAIL_SECONDS=0.6                   # how long a clip rests on its last frame, in clip time
SKIP_BLANK=1                       # start each clip once both pages have loaded, not on the blank page
BLANK_FRACTION=0.2                 # a frame under this share of its page's largest frame is a blank page
SKIP_LEAD=0                        # and drop this many more real seconds from the start of each clip
MAX_CLIP=4                         # cap on a clip's real length in seconds, 0 = none (a few runs wait for 10 s)
END_MODE="hold"                    # hold: a finished clip rests on its last frame; loop: it plays again
END_PAD_SECONDS=1.5                # the wall holds this long after the longest clip ends
MIN_HOLD_SECONDS=1.0               # and at least this long after the zoom, whatever the clips do
HERO="auto"                        # auto = the clip with the most frames; or a 0-based position in the sorted list
HERO_CELL="center"                 # center, or COL,ROW (0-based)
LAYOUT="stack"                     # stack: one page above the other, each cropped; side: side by side, padded
CROP_Y=0.3                         # stack only: where the crop sits in each page, 0 = top, 1 = bottom
GAP=8                              # pixels between cells, at the full-wall size
BG="0x0b0d12"
MIN_FRAMES=10                      # a page with fewer screencast frames is a blank or failed build and is skipped
MAX_PAGES=2
CAPTIONS=""                        # a file of lines "recording folder<TAB>caption" (\n starts a new line); see vidi-mosaic-captions.sh
KEEP_UNCAPTIONED=0                 # with --captions, use only recordings that have a caption unless this is set
CAPTION_SIZE=0.075                 # a caption line is at most this fraction of a clip's height
CAPTION_BAND_OPACITY=0.7           # the dark band behind a caption
CAPTION_CHAR_WIDTH=0.58            # an average glyph's width, as a fraction of the font size, to fit a line to the tile
CAPTION_LINE_HEIGHT=1.25           # line pitch, as a fraction of the font size
CAPTION_PAD_LINES=0.5              # padding above and below the text, in lines
REVEAL_START=0.1                  # neighbours fade in between these fractions of the zoom, nearest first
REVEAL_END=0.7
REVEAL_FADE_SECONDS=0.4
TEXT_FADE_START=0.7                # the text fades in from this fraction of the zoom, over the rest of it
TEXT_OVERSAMPLE=2                  # the text strip is drawn this many times larger than its final size
CRF=18
PRESET="medium"
OUT="vidi-mosaic.mp4"
WORK=""
KEEP_WORK=0
DRY_RUN=0
LIST_ONLY=0
PREVIEW=0
PREVIEW_WIDTH=960
PREVIEW_HEIGHT=540
PREVIEW_FPS=15
PREVIEW_CRF=30
PREVIEW_PRESET="ultrafast"

usage() {
  cat <<EOF
Usage: $PROG --recordings DIR [options]

Source
  --recordings DIR     the gallery's recordings folder (or set VIDI_RECORDINGS)
  --story N            story whose clips are used                          (default $STORY)
  --test TEXT          keep tests whose folder name contains TEXT          (default "$TEST")
  --min-frames N       skip a build with fewer frames than this on a page  (default $MIN_FRAMES)
  --list               list the usable and skipped recordings and stop

Wall
  --cols N --rows N    grid size                                           (default ${COLS}x${ROWS})
  --count N            clips on the wall                                   (default $COUNT)
  --text-cells N       cells kept free for the text; default = cols*rows - count, and at most one row
  --text TEXT          text in those cells, \\n starts a new line           (default "$TEXT")
  --font FILE          font for the text                                   (default $FONT)
  --captions FILE      caption each clip: lines of "recording folder<TAB>caption"; make one with
                       vidi-mosaic-captions.sh. A clip with no line has no caption.
  --caption-size F     a caption line is at most this fraction of a clip's height  (default $CAPTION_SIZE)
  --keep-uncaptioned   with --captions, also use clips that have no caption (default: only captioned ones)
  --hero auto|N        the clip the video opens on                       (default $HERO)
  --hero-cell center|COL,ROW   where the hero sits in the grid             (default $HERO_CELL)
  --layout stack|side  how a clip shows its two people                     (default $LAYOUT)
  --crop-y F           stack layout: crop position 0 (top) to 1 (bottom)   (default $CROP_Y)
  --gap PX             gutter between cells at full-wall size              (default $GAP)
  --bg COLOUR          background colour, ffmpeg syntax                    (default $BG)

Timing
  --zoom-seconds S     length of the pull-back                             (default $ZOOM_SECONDS)
  --speed X            clip playback speed, 0.3 = 30% of real time         (default $SPEED)
  --tail S             rest on a clip's last frame, in clip time           (default $TAIL_SECONDS)
  --keep-blank         keep the blank page a build shows while it loads    (default: dropped)
  --skip-lead S        drop S more real seconds from the start of a clip   (default $SKIP_LEAD)
  --max-clip S         cap a clip at S real seconds, 0 = no cap            (default $MAX_CLIP)
  --end hold|loop      what a finished clip does while others play         (default $END_MODE)
  --end-pad S          hold after the longest clip ends                    (default $END_PAD_SECONDS)
  --min-hold S         hold at least this long after the zoom              (default $MIN_HOLD_SECONDS)

Output
  --out FILE           output video                                        (default $OUT)
  --width PX --height PX --fps N                                           (default ${WIDTH}x${HEIGHT} at $FPS)
  --crf N --preset NAME  x264 quality and speed                            (default $CRF, $PRESET)
  --preview            small, fast, low quality: ${PREVIEW_WIDTH}x${PREVIEW_HEIGHT} at $PREVIEW_FPS fps
  --work DIR           working folder; rendered clips are reused from it between runs
  --keep-work          keep the working folder when done
  --dry-run            print the plan (cells, timing) and stop; renders nothing
  -h, --help           this text
EOF
}

die() { printf '%s: %s\n' "$PROG" "$*" >&2; exit 2; }
note() { printf '%s\n' "$*" >&2; }

# ---- arguments --------------------------------------------------------------------------------------------------
while [ $# -gt 0 ]; do
  opt="$1"
  case "$opt" in
    -h|--help) usage; exit 0 ;;
    --list) LIST_ONLY=1; shift; continue ;;
    --dry-run) DRY_RUN=1; shift; continue ;;
    --preview) PREVIEW=1; shift; continue ;;
    --keep-work) KEEP_WORK=1; shift; continue ;;
    --keep-blank) SKIP_BLANK=0; shift; continue ;;
    --keep-uncaptioned) KEEP_UNCAPTIONED=1; shift; continue ;;
    --recordings|--story|--test|--min-frames|--cols|--rows|--count|--text-cells|--text|--font|--hero|--hero-cell|\
    --layout|--crop-y|--gap|--bg|--zoom-seconds|--speed|--tail|--skip-lead|--max-clip|--end|--end-pad|--min-hold|--out|--width|--height|\
    --fps|--crf|--preset|--work|--captions|--caption-size)
      [ $# -ge 2 ] || die "$opt needs a value"
      val="$2"; shift 2
      case "$opt" in
        --recordings) RECORDINGS="$val" ;;   --story) STORY="$val" ;;         --test) TEST="$val" ;;
        --min-frames) MIN_FRAMES="$val" ;;   --cols) COLS="$val" ;;           --rows) ROWS="$val" ;;
        --count) COUNT="$val" ;;             --text-cells) TEXT_CELLS="$val" ;; --text) TEXT="$val" ;;
        --font) FONT="$val" ;;               --hero) HERO="$val" ;;           --hero-cell) HERO_CELL="$val" ;;
        --layout) LAYOUT="$val" ;;           --crop-y) CROP_Y="$val" ;;       --gap) GAP="$val" ;;
        --bg) BG="$val" ;;                   --zoom-seconds) ZOOM_SECONDS="$val" ;; --speed) SPEED="$val" ;;
        --tail) TAIL_SECONDS="$val" ;; --skip-lead) SKIP_LEAD="$val" ;; --max-clip) MAX_CLIP="$val" ;;       --end) END_MODE="$val" ;;        --end-pad) END_PAD_SECONDS="$val" ;;
        --min-hold) MIN_HOLD_SECONDS="$val" ;; --out) OUT="$val" ;;           --width) WIDTH="$val" ;;
        --height) HEIGHT="$val" ;;           --fps) FPS="$val" ;;             --crf) CRF="$val" ;;
        --preset) PRESET="$val" ;;           --work) WORK="$val" ;;
        --captions) CAPTIONS="$val" ;;       --caption-size) CAPTION_SIZE="$val" ;;
      esac ;;
    *) die "unknown option $opt (see --help)" ;;
  esac
done

is_int() { case "$1" in ''|*[!0-9]*) return 1 ;; *) return 0 ;; esac; }
is_num() { awk -v v="$1" 'BEGIN{exit !(v ~ /^[0-9]+(\.[0-9]+)?$/)}'; }
for v in STORY COLS ROWS COUNT WIDTH HEIGHT FPS MIN_FRAMES GAP CRF; do
  is_int "${!v}" || die "--$(printf '%s' "$v" | tr 'A-Z_' 'a-z-') must be a whole number, got '${!v}'"
done
for v in ZOOM_SECONDS SPEED SKIP_LEAD MAX_CLIP TAIL_SECONDS END_PAD_SECONDS MIN_HOLD_SECONDS CROP_Y CAPTION_SIZE; do
  is_num "${!v}" || die "--$(printf '%s' "$v" | tr 'A-Z_' 'a-z-') must be a number, got '${!v}'"
done
[ -z "$CAPTIONS" ] || [ -f "$CAPTIONS" ] || die "captions file not found: $CAPTIONS"
[ "$COLS" -ge 1 ] && [ "$ROWS" -ge 1 ] || die "--cols and --rows must be at least 1"
[ "$COUNT" -ge 1 ] || die "--count must be at least 1"
awk -v s="$SPEED" 'BEGIN{exit !(s>0)}' || die "--speed must be above 0"
awk -v c="$CROP_Y" 'BEGIN{exit !(c<=1)}' || die "--crop-y must be between 0 and 1"
case "$LAYOUT" in stack|side) ;; *) die "--layout must be stack or side" ;; esac
case "$END_MODE" in hold|loop) ;; *) die "--end must be hold or loop" ;; esac

if [ "$PREVIEW" = 1 ]; then
  WIDTH=$PREVIEW_WIDTH; HEIGHT=$PREVIEW_HEIGHT; FPS=$PREVIEW_FPS; CRF=$PREVIEW_CRF; PRESET=$PREVIEW_PRESET
fi

for c in ffmpeg ffprobe jq unzip awk; do command -v "$c" >/dev/null 2>&1 || die "$c is not installed"; done
[ -n "$RECORDINGS" ] || die "--recordings DIR is required (or set VIDI_RECORDINGS)"
[ -d "$RECORDINGS" ] || die "recordings folder not found: $RECORDINGS"

if [ -z "$WORK" ]; then WORK="$(mktemp -d "${TMPDIR:-/tmp}/vidi-mosaic.XXXXXX")"; else mkdir -p "$WORK"; WORK="$(cd "$WORK" && pwd)"; fi
if [ "$KEEP_WORK" = 0 ] && [ "$DRY_RUN" = 0 ]; then
  case "$WORK" in "${TMPDIR:-/tmp}"/vidi-mosaic.*) trap 'rm -rf "$WORK"' EXIT ;; esac
fi

# ---- reading a trace --------------------------------------------------------------------------------------------
# One line per screencast frame: page id, timestamp in ms, the frame's file name under resources/.
trace_frames() {
  { unzip -p "$1" '*-trace.trace' 2>/dev/null || true; } |
    jq -r 'select(.type == "screencast-frame") | [.pageId, .timestamp, .sha1] | @tsv' 2>/dev/null || true
}

# pages, frames on the page with the fewest, span in ms
trace_stats() {
  trace_frames "$1" | awk -F'\t' '
    { n[$1]++; if (!seen || $2 < lo) lo = $2; if (!seen || $2 > hi) hi = $2; seen = 1 }
    END { p = 0; m = -1; for (k in n) { p++; if (m < 0 || n[k] < m) m = n[k] }
          printf "%d\t%d\t%.0f\n", p, (m < 0 ? 0 : m), (seen ? hi - lo : 0) }'
}

# Milliseconds from a trace's first frame until every page has shown something other than a blank page. A frame
# smaller than BLANK_FRACTION of that page's largest frame is a page still loading. 0 when --keep-blank is given.
trace_lead_ms() {
  if [ "$SKIP_BLANK" = 0 ]; then echo 0; return; fi
  {
    { unzip -l "$1" 2>/dev/null || true; } | awk '$4 ~ /^resources\// { n = $4; sub(/^resources\//, "", n); print "S\t" n "\t" $1 }'
    trace_frames "$1" | awk -F'\t' '{ print "F\t" $0 }'
  } | awk -F'\t' -v frac="$BLANK_FRACTION" '
    $1 == "S" { size[$2] = $3; next }
    $1 == "F" { n++; pg[n] = $2; ts[n] = $3; nm[n] = $4
                if (!($2 in mx) || size[$4] > mx[$2]) mx[$2] = size[$4]
                if (n == 1 || $3 < lo) lo = $3 }
    END {
      for (i = 1; i <= n; i++) if (!(pg[i] in first) && size[nm[i]] >= frac * mx[pg[i]]) first[pg[i]] = ts[i]
      lead = 0
      for (p in mx) { f = (p in first) ? first[p] : lo; if (f - lo > lead) lead = f - lo }
      printf "%.0f\n", lead
    }'
}

TEST_GLOB="*/artifacts/story-$(printf '%02d' "$STORY")-*${TEST}*"
discover() { find "$RECORDINGS" -path "$TEST_GLOB" -name trace.zip 2>/dev/null | LC_ALL=C sort; }
rec_name() { local rel="${1#"$RECORDINGS"/}"; printf '%s' "${rel%%/*}"; }

ALL="$WORK/all.tsv"; USABLE="$WORK/usable.tsv"
: > "$ALL"; : > "$USABLE"
while IFS= read -r zip; do
  [ -n "$zip" ] || continue
  IFS=$'\t' read -r pages minf span < <(trace_stats "$zip")
  ok=skip; lead=0
  if [ "$pages" -ge 1 ] && [ "$minf" -ge "$MIN_FRAMES" ]; then ok=ok; lead="$(trace_lead_ms "$zip")"; fi
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$ok" "$(rec_name "$zip")" "$pages" "$minf" "$span" "$lead" "$zip" >> "$ALL"
  [ "$ok" = ok ] && printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$(rec_name "$zip")" "$pages" "$minf" "$span" "$lead" "$zip" >> "$USABLE"
done < <(discover)

TOTAL_FOUND=$(wc -l < "$ALL" | tr -d ' ')
USABLE_N=$(wc -l < "$USABLE" | tr -d ' ')
SKIPPED_N=$((TOTAL_FOUND - USABLE_N))

if [ "$LIST_ONLY" = 1 ]; then
  printf '%-6s %-20s %5s %10s %9s %8s\n' status recording pages min-frames span-ms lead-ms
  awk -F'\t' '{ printf "%-6s %-20s %5s %10s %9s %8s\n", $1, $2, $3, $4, $5, $6 }' "$ALL"
  printf '%d found, %d usable, %d skipped (fewer than %d frames on a page)\n' "$TOTAL_FOUND" "$USABLE_N" "$SKIPPED_N" "$MIN_FRAMES"
  exit 0
fi

[ "$TOTAL_FOUND" -gt 0 ] || die "no story $STORY traces matching '$TEST' under $RECORDINGS"
UNCAPTIONED_N=0
if [ -n "$CAPTIONS" ] && [ "$KEEP_UNCAPTIONED" = 0 ]; then
  awk -F'\t' 'NR==FNR{c[$1]=1; next} $1 in c' "$CAPTIONS" "$USABLE" > "$USABLE.captioned"
  UNCAPTIONED_N=$((USABLE_N - $(wc -l < "$USABLE.captioned" | tr -d ' ')))
  mv "$USABLE.captioned" "$USABLE"
  USABLE_N=$((USABLE_N - UNCAPTIONED_N))
  if [ "$USABLE_N" -lt "$COUNT" ]; then
    die "asked for $COUNT clips but only $USABLE_N are usable and have a caption ($UNCAPTIONED_N usable recordings have none; --keep-uncaptioned uses them)"
  fi
fi
if [ "$USABLE_N" -lt "$COUNT" ]; then
  die "asked for $COUNT clips but only $USABLE_N are usable ($SKIPPED_N of $TOTAL_FOUND skipped for having fewer than $MIN_FRAMES frames on a page). Lower --count or --min-frames, or record more builds"
fi

CELLS=$((COLS * ROWS))
[ "$COUNT" -le "$CELLS" ] || die "$COUNT clips do not fit a ${COLS}x${ROWS} grid ($CELLS cells)"
if [ -z "$TEXT_CELLS" ]; then TEXT_CELLS=$((CELLS - COUNT)); fi
is_int "$TEXT_CELLS" || die "--text-cells must be a whole number"
[ $((COUNT + TEXT_CELLS)) -le "$CELLS" ] || die "$COUNT clips and $TEXT_CELLS text cells do not fit $CELLS cells"
[ "$TEXT_CELLS" -le "$COLS" ] || die "the text needs $TEXT_CELLS cells but must fit in one row of $COLS. Raise --count or add columns"
if [ $((COUNT + TEXT_CELLS)) -lt "$CELLS" ]; then
  note "note: $((CELLS - COUNT - TEXT_CELLS)) cell(s) of the grid stay empty"
fi

# ---- geometry (world = output pixels at full-wall size) ---------------------------------------------------------
# Cell size, from the gutter. The hero's cell is scaled to fit the frame at the start, which sets the clip size.
read -r CELL_W CELL_H < <(awk -v W="$WIDTH" -v H="$HEIGHT" -v C="$COLS" -v R="$ROWS" -v G="$GAP" \
  'BEGIN{ printf "%.4f %.4f\n", (W-(C+1)*G)/C, (H-(R+1)*G)/R }')
awk -v w="$CELL_W" -v h="$CELL_H" 'BEGIN{exit !(w>=4 && h>=4)}' || die "cells would be under 4 pixels: lower --gap or the grid size"
read -r Z0 CLIP_W CLIP_H < <(awk -v W="$WIDTH" -v H="$HEIGHT" -v cw="$CELL_W" -v ch="$CELL_H" -v P="$MAX_PAGES" '
  function ceilmul(x, m) { return int((x + m - 1) / m) * m }
  BEGIN { z = (W/cw < H/ch) ? W/cw : H/ch; printf "%.6f %d %d\n", z, ceilmul(cw*z, 2*P), ceilmul(ch*z, 2*P) }')

# Which grid cell is the hero's, which cells carry text.
FIRST_TEXT_CELL=$((CELLS - TEXT_CELLS))
if [ "$HERO_CELL" = center ]; then
  HERO_COL=$((COLS / 2)); HERO_ROW=$((ROWS / 2))
else
  case "$HERO_CELL" in *,*) HERO_COL="${HERO_CELL%%,*}"; HERO_ROW="${HERO_CELL##*,}" ;; *) die "--hero-cell must be center or COL,ROW" ;; esac
  is_int "$HERO_COL" && is_int "$HERO_ROW" || die "--hero-cell must be center or COL,ROW"
fi
[ "$HERO_COL" -lt "$COLS" ] && [ "$HERO_ROW" -lt "$ROWS" ] || die "--hero-cell $HERO_COL,$HERO_ROW is outside the ${COLS}x${ROWS} grid"
HERO_INDEX=$((HERO_ROW * COLS + HERO_COL))
[ "$HERO_INDEX" -lt "$FIRST_TEXT_CELL" ] || die "--hero-cell $HERO_COL,$HERO_ROW is one of the text cells"

# The clips used, in recording order; the hero is the one with the most frames unless chosen.
SELECTED="$WORK/selected.tsv"
head -n "$COUNT" "$USABLE" > "$SELECTED"
if [ "$HERO" = auto ]; then
  HERO_CLIP=$(awk -F'\t' 'NR==1||$3>best{best=$3; at=NR} END{print at-1}' "$SELECTED")
else
  is_int "$HERO" || die "--hero must be auto or a whole number"
  [ "$HERO" -lt "$COUNT" ] || die "--hero $HERO is past the $COUNT clips"
  HERO_CLIP=$HERO
fi

# The plan: one line per clip, with its cell and its position and size in the world.
PLAN="$WORK/plan.tsv"
awk -F'\t' -v C="$COLS" -v G="$GAP" -v cw="$CELL_W" -v ch="$CELL_H" -v ft="$FIRST_TEXT_CELL" -v hi="$HERO_INDEX" \
    -v hc="$HERO_CLIP" -v skip="$SKIP_LEAD" -v cap="$MAX_CLIP" '
  # what is dropped from the start: the blank page loading plus --skip-lead
  function drop(blank) { return blank + skip * 1000 }
  # the clip'"'"'s real length once that is dropped and the cap applied
  function eff(span, blank,   e) { e = span - drop(blank); if (cap > 0 && e > cap*1000) e = cap*1000; return e < 0 ? 0 : e }
  { clip[NR-1] = $0 }
  END {
    n = NR; cell = 0
    for (k = 0; k < n; k++) {
      if (k == hc) { c = hi } else { if (cell == hi) cell++; c = cell++ }
      split(clip[k], f, "\t")
      col = c % C; row = int(c / C)
      printf "%d\t%d\t%d\t%.4f\t%.4f\t%s\t%.0f\t%.0f\t%s\n", k, col, row, G + col*(cw+G), G + row*(ch+G), f[1], eff(f[4], f[5]), drop(f[5]), f[6]
    }
  }' "$SELECTED" > "$PLAN"
# plan columns: clip, col, row, x, y, recording, length-ms, dropped-from-start-ms, zip

# Every clip lasts (span + tail) / speed seconds; the video outlasts the longest.
MAX_SPAN_MS=$(awk -F'\t' '$7>m{m=$7} END{printf "%d", m}' "$PLAN")
read -r CLIP_MAX TOTAL < <(awk -v span="$MAX_SPAN_MS" -v tail="$TAIL_SECONDS" -v sp="$SPEED" -v pad="$END_PAD_SECONDS" \
  -v z="$ZOOM_SECONDS" -v mh="$MIN_HOLD_SECONDS" 'BEGIN{
    c = (span/1000 + tail)/sp; t = c + pad; u = z + mh; if (u > t) t = u; printf "%.3f %.3f\n", c, t }')

# Text strip: the last TEXT_CELLS cells of the last row, from the right.
read -r TX TY TW TH < <(awk -v C="$COLS" -v R="$ROWS" -v G="$GAP" -v cw="$CELL_W" -v ch="$CELL_H" -v tc="$TEXT_CELLS" '
  BEGIN { if (tc < 1) { print "0 0 0 0"; exit }
          first = C - tc; printf "%.4f %.4f %.4f %.4f\n", G + first*(cw+G), G + (R-1)*(ch+G), tc*cw + (tc-1)*G, ch }')

HERO_X=$(awk -F'\t' -v h="$HERO_CLIP" '$1==h{print $4}' "$PLAN"); HERO_Y=$(awk -F'\t' -v h="$HERO_CLIP" '$1==h{print $5}' "$PLAN")
read -r HCX HCY HV0 < <(awk -v x="$HERO_X" -v y="$HERO_Y" -v cw="$CELL_W" -v ch="$CELL_H" -v H="$HEIGHT" -v z="$Z0" \
  'BEGIN{ printf "%.4f %.4f %.4f\n", x + cw/2, y + ch/2, H/z }')

print_plan() {
  printf 'wall: %dx%d cells, %d clips, %d text cells, canvas %dx%d at %d fps\n' "$COLS" "$ROWS" "$COUNT" "$TEXT_CELLS" "$WIDTH" "$HEIGHT" "$FPS"
  printf 'cell: %.1f x %.1f px at full-wall size; clips rendered at %dx%d\n' "$CELL_W" "$CELL_H" "$CLIP_W" "$CLIP_H"
  printf 'recordings: %d found, %d usable, %d skipped (under %d frames on a page)\n' "$TOTAL_FOUND" "$USABLE_N" "$SKIPPED_N" "$MIN_FRAMES"
  printf 'hero: clip %d (%s) in cell %d,%d\n' "$HERO_CLIP" "$(awk -F'\t' -v h="$HERO_CLIP" '$1==h{print $6}' "$PLAN")" "$HERO_COL" "$HERO_ROW"
  printf 'timing: zoom %ss, longest clip %ss at speed %s, video %ss\n' "$ZOOM_SECONDS" "$CLIP_MAX" "$SPEED" "$TOTAL"
  if [ "$TEXT_CELLS" -gt 0 ]; then printf 'text: cells %d..%d of the last row\n' $((COLS - TEXT_CELLS)) $((COLS - 1)); fi
  if [ "$UNCAPTIONED_N" -gt 0 ]; then printf '%d usable recordings have no caption and are not used\n' "$UNCAPTIONED_N"; fi
  if [ -n "$CAPTIONS" ]; then
    printf 'captions: %d of %d clips\n' "$(awk -F'\t' 'NR==FNR{c[$1]=1; next} $6 in c{n++} END{print n+0}' "$CAPTIONS" "$PLAN")" "$COUNT"
  fi
  awk -F'\t' '{ printf "  clip %-3d cell %d,%d  %s\n", $1, $2, $3, $6 }' "$PLAN"
}
if [ "$DRY_RUN" = 1 ]; then print_plan; exit 0; fi
print_plan >&2

# ---- clips: one mp4 per recording ------------------------------------------------------------------------------
SIG=$(printf '%s' "$FPS $SPEED $TAIL_SECONDS $SKIP_BLANK $BLANK_FRACTION $SKIP_LEAD $MAX_CLIP $LAYOUT $CROP_Y $CLIP_W $CLIP_H $BG $MAX_PAGES $END_MODE $TOTAL $CAPTION_SIZE $CAPTION_BAND_OPACITY $FONT" | cksum | cut -d' ' -f1)
CLIPS="$WORK/clips-$SIG"; mkdir -p "$CLIPS"

# A recording's caption, with \n for a line break; empty when there is none.
caption_of() { if [ -n "$CAPTIONS" ]; then awk -F'\t' -v r="$1" '$1 == r { print $2; exit }' "$CAPTIONS"; fi; }
# A clip with a caption is a different file from the same clip without one, and from one with another caption.
clip_file() {
  local cap; cap="$(caption_of "$1")"
  if [ -n "$cap" ]; then printf '%s/%s.%s.mp4' "$CLIPS" "$1" "$(printf '%s' "$cap" | cksum | cut -d' ' -f1)"; else printf '%s/%s.mp4' "$CLIPS" "$1"; fi
}
if [ -n "$CAPTIONS" ]; then [ -f "$FONT" ] || die "font not found: $FONT (use --font)"; fi

make_clip() { # zip out dropped-from-start-ms caption
  local zip="$1" out="$2" lead="$3" caption="$4" tmp T0 TEND pages p j half vlast=v0
  tmp="$(mktemp -d "$WORK/frames.XXXXXX")"
  unzip -q -o "$zip" 'resources/*' -d "$tmp"
  trace_frames "$zip" | LC_ALL=C sort -t$'\t' -k2,2n > "$tmp/frames.tsv"
  read -r T0 TEND < <(awk -F'\t' -v lead="$lead" -v cap="$MAX_CLIP" 'NR==1{lo=$2} {hi=$2} END{
    t0 = lo + lead; te = hi; if (cap > 0 && te > t0 + cap*1000) te = t0 + cap*1000; if (te < t0) te = t0; print t0, te }' "$tmp/frames.tsv")
  pages="$(awk -F'\t' '!s[$1]++{print $1}' "$tmp/frames.tsv" | head -n "$MAX_PAGES")"
  local inputs=() filters="" labels="" npages=0
  for p in $pages; do
    awk -F'\t' -v p="$p" -v dir="$tmp/resources" -v t0="$T0" -v tend="$TEND" -v tl="$TAIL_SECONDS" -v speed="$SPEED" '
      $1 == p { ts[++n] = $2; f[n] = $3 }
      END {
        print "ffconcat version 1.0"
        first = 1; last = 1
        for (i = 1; i <= n; i++) { if (ts[i] <= t0) first = i; if (ts[i] <= tend) last = i }
        if (last < first) last = first
        for (i = first; i <= last; i++) {
          s = (i == first) ? t0 : ts[i]; e = (i < last) ? ts[i+1] : tend + tl * 1000
          d = (e - s) / 1000 / speed; if (d < 0.001) d = 0.001
          printf "file '\''%s/%s'\''\nduration %.6f\n", dir, f[i], d
        }
        printf "file '\''%s/%s'\''\n", dir, f[last]
      }' "$tmp/frames.tsv" > "$tmp/page$npages.txt"
    inputs+=(-f concat -safe 0 -i "$tmp/page$npages.txt")
    npages=$((npages + 1))
  done
  if [ "$LAYOUT" = stack ]; then
    half=$((CLIP_H / npages))
    for ((j = 0; j < npages; j++)); do
      filters+="[$j:v]fps=$FPS,scale=w=$CLIP_W:h=$half:force_original_aspect_ratio=increase:flags=bicubic,"
      filters+="crop=$CLIP_W:$half:(in_w-out_w)/2:(in_h-out_h)*$CROP_Y[s$j];"
      labels+="[s$j]"
    done
    if [ "$npages" -gt 1 ]; then filters+="${labels}vstack=inputs=$npages[v0]"; else filters+="${labels}null[v0]"; fi
  else
    half=$((CLIP_W / npages))
    for ((j = 0; j < npages; j++)); do
      filters+="[$j:v]fps=$FPS,scale=w=$half:h=$CLIP_H:force_original_aspect_ratio=decrease:flags=bicubic,"
      filters+="pad=$half:$CLIP_H:(ow-iw)/2:(oh-ih)/2:color=$BG[s$j];"
      labels+="[s$j]"
    done
    if [ "$npages" -gt 1 ]; then filters+="${labels}hstack=inputs=$npages[v0]"; else filters+="${labels}null[v0]"; fi
  fi
  if [ -n "$caption" ]; then
    # A dark band along the bottom, and the caption on it. The font fits the longest line to the tile's width.
    local capfile="$tmp/caption.txt" fs bandh
    printf '%b' "$caption" > "$capfile"
    read -r fs bandh < <(awk -v w="$CLIP_W" -v h="$CLIP_H" -v sz="$CAPTION_SIZE" -v cw="$CAPTION_CHAR_WIDTH" \
      -v lh="$CAPTION_LINE_HEIGHT" -v pad="$CAPTION_PAD_LINES" -v f="$capfile" '
      BEGIN { while ((getline line < f) > 0) { lines++; if (length(line) > mx) mx = length(line) }
              if (lines < 1) lines = 1; if (mx < 1) mx = 1
              fs = h * sz; fit = w * 0.94 / (mx * cw); if (fit < fs) fs = fit
              printf "%d %d\n", fs, fs * (lines * lh + pad * 2) }')
    filters+=";[v0]drawbox=x=0:y=ih-$bandh:w=iw:h=$bandh:color=black@$CAPTION_BAND_OPACITY:t=fill,"
    filters+="drawtext=fontfile='$FONT':textfile='$capfile':fontsize=$fs:fontcolor=white:"
    filters+="line_spacing=$(awk -v fs="$fs" -v lh="$CAPTION_LINE_HEIGHT" 'BEGIN{printf "%d", fs * (lh - 1)}'):"
    filters+="x=$fs/2:y=h-$bandh+$fs*$CAPTION_PAD_LINES[vcap]"
    vlast=vcap
  fi
  # A clip that holds its last frame is made as long as the whole video. The wall resizes every tile every frame as the
  # camera pulls back, so a tile with no frames left would freeze at the size it had when its clip ended.
  local length=()
  if [ "$END_MODE" = hold ]; then
    filters+=";[$vlast]tpad=stop_mode=clone:stop_duration=$TOTAL[v]"; length=(-t "$TOTAL")
  else
    filters+=";[$vlast]null[v]"
  fi
  ffmpeg -nostdin -v error -y "${inputs[@]}" -filter_complex "$filters" -map '[v]' -an ${length[@]+"${length[@]}"} \
    -c:v libx264 -preset veryfast -crf 16 -pix_fmt yuv420p -r "$FPS" "$out.part.mp4"
  mv "$out.part.mp4" "$out"
  rm -rf "$tmp"
}

note "rendering clips..."
while IFS=$'\t' read -r k col row x y rec span lead zip; do
  out="$(clip_file "$rec")"
  if [ -s "$out" ]; then continue; fi
  make_clip "$zip" "$out" "$lead" "$(caption_of "$rec")"
done < "$PLAN"

# ---- the wall ------------------------------------------------------------------------------------------------------
# The camera: a smoothstep from the hero's cell filling the frame to the whole wall. The view's height shrinks
# geometrically (an even-feeling zoom); its centre moves in a straight line. A tile at world position X sits on
# screen at (X - centre) * zoom + half the frame, and is scaled by the same zoom, every frame.
U="min(max(t/$ZOOM_SECONDS,0),1)"
S="($U*$U*(3-2*$U))"
VIEW_H="(pow($HV0,1-$S)*pow($HEIGHT,$S))"
ZOOM="($HEIGHT/$VIEW_H)"
CAM_X="($HCX+($WIDTH/2-$HCX)*$S)"
CAM_Y="($HCY+($HEIGHT/2-$HCY)*$S)"

GRAPH="$WORK/graph.txt"; : > "$GRAPH"
INPUTS=(-f lavfi -i "color=c=$BG:s=${WIDTH}x${HEIGHT}:r=$FPS:d=$TOTAL")
prev="[0:v]"; idx=1; n=0
MAXDIST=$(awk -F'\t' -v hx="$HERO_COL" -v hy="$HERO_ROW" '{dx=$2-hx; dy=$3-hy; d=sqrt(dx*dx+dy*dy); if(d>m)m=d} END{print (m>0?m:1)}' "$PLAN")
while IFS=$'\t' read -r k col row x y rec span lead zip; do
  clip="$(clip_file "$rec")"
  if [ "$END_MODE" = loop ]; then INPUTS+=(-stream_loop -1 -t "$TOTAL" -i "$clip"); else INPUTS+=(-i "$clip"); fi
  reveal=$(awk -v c="$col" -v r="$row" -v hx="$HERO_COL" -v hy="$HERO_ROW" -v md="$MAXDIST" -v z="$ZOOM_SECONDS" \
    -v rs="$REVEAL_START" -v re="$REVEAL_END" 'BEGIN{dx=c-hx; dy=r-hy; d=sqrt(dx*dx+dy*dy)/md; printf "%.3f", z*(rs+(re-rs)*d)}')
  chain="[$idx:v]setpts=PTS-STARTPTS,"
  chain+="format=yuva444p,"
  if [ "$k" != "$HERO_CLIP" ]; then chain+="fade=t=in:st=$reveal:d=$REVEAL_FADE_SECONDS:alpha=1,"; fi
  chain+="scale=w='$CELL_W*$ZOOM':h='$CELL_H*$ZOOM':eval=frame:flags=area[t$n];"
  printf '%s\n' "$chain" >> "$GRAPH"
  printf "%s[t%s]overlay=x='(%s-%s)*%s+%s/2':y='(%s-%s)*%s+%s/2':format=yuv444:eof_action=repeat[o%s];\n" \
    "$prev" "$n" "$x" "$CAM_X" "$ZOOM" "$WIDTH" "$y" "$CAM_Y" "$ZOOM" "$HEIGHT" "$n" >> "$GRAPH"
  prev="[o$n]"; idx=$((idx + 1)); n=$((n + 1))
done < "$PLAN"

if [ "$TEXT_CELLS" -gt 0 ]; then
  [ -f "$FONT" ] || die "font not found: $FONT (use --font)"
  TEXT_FILE="$WORK/text.txt"; printf '%b' "$TEXT" > "$TEXT_FILE"
  read -r SW SH FS < <(awk -v w="$TW" -v h="$TH" -v o="$TEXT_OVERSAMPLE" -v f="$TEXT_FILE" '
    BEGIN { while ((getline line < f) > 0) { lines++; if (length(line) > mx) mx = length(line) }
            if (lines < 1) lines = 1; if (mx < 1) mx = 1
            fs = h * 0.7 / lines; fw = w * 0.9 / (mx * 0.6); if (fw < fs) fs = fw
            printf "%d %d %d\n", int(w*o/2)*2, int(h*o/2)*2, int(fs*o) }')
  INPUTS+=(-f lavfi -i "color=c=$BG:s=${SW}x${SH}:r=$FPS:d=$TOTAL")
  fadein=$(awk -v z="$ZOOM_SECONDS" -v s="$TEXT_FADE_START" 'BEGIN{printf "%.3f", z*s}')
  fadelen=$(awk -v z="$ZOOM_SECONDS" -v s="$TEXT_FADE_START" 'BEGIN{printf "%.3f", z*(1-s)}')
  printf "[%s:v]drawtext=fontfile='%s':textfile='%s':fontsize=%s:fontcolor=white:line_spacing=%s:x=(w-text_w)/2:y=(h-text_h)/2," \
    "$idx" "$FONT" "$TEXT_FILE" "$FS" "$((FS / 8))" >> "$GRAPH"
  printf "format=yuva444p,fade=t=in:st=%s:d=%s:alpha=1,scale=w='%s*%s':h='%s*%s':eval=frame:flags=area[txt];\n" \
    "$fadein" "$fadelen" "$TW" "$ZOOM" "$TH" "$ZOOM" >> "$GRAPH"
  printf "%s[txt]overlay=x='(%s-%s)*%s+%s/2':y='(%s-%s)*%s+%s/2':format=yuv444:eof_action=repeat[wall];\n" \
    "$prev" "$TX" "$CAM_X" "$ZOOM" "$WIDTH" "$TY" "$CAM_Y" "$ZOOM" "$HEIGHT" >> "$GRAPH"
  prev="[wall]"
fi
printf '%sformat=yuv420p[out]\n' "$prev" >> "$GRAPH"

note "composing the wall: $COUNT clips, ${TOTAL}s..."
mkdir -p "$(dirname "$OUT")"
ffmpeg -nostdin -v error $([ -t 2 ] && echo -stats) -y "${INPUTS[@]}" -filter_complex_script "$GRAPH" -map '[out]' -t "$TOTAL" \
  -c:v libx264 -preset "$PRESET" -crf "$CRF" -pix_fmt yuv420p -movflags +faststart -r "$FPS" "$OUT"
note "wrote $OUT"
