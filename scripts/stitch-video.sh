#!/usr/bin/env bash
# Stitch the demo video clips into one YouTube-ready file.
#
# Usage:
#   scripts/stitch-video.sh [CLIPDIR] [narration.m4a]
#
# CLIPDIR defaults to the repository video/ folder.
#
# CLIPDIR holds the raw screen recordings and a manifest called clips.txt.
# Each manifest line is four fields separated by spaces; use - to skip one:
#
#   filename  start  end  speed
#
#   clip1.mov  -     -    -        # the whole clip, normal speed
#   clip3.mov  2.5   14   -        # keep 2.5s to 14s only
#   clip4.mov  0:04  0:31 1.5      # trim, then play 1.5x faster
#
# Times are seconds or mm:ss. Lines starting with # are ignored.
#
# Captions: an optional captions.txt beside clips.txt burns lower-third
# text onto the picture. Each line is:
#
#   filename  start  end  the caption text (a | becomes a line break)
#
#   clip1.mov  0    5    Fediverse Hashtag Activity Index · live
#   clip1.mov  7    -    The agent and the person are looking at the same URL
#
# start and end are relative to the clip AS IT APPEARS IN THE FINAL CUT,
# after its trim and speed are applied; - as end means until the clip ends.
# Same filename in clips.txt twice? The captions apply to every use.
#
# Clips are normalised to 1920x1080 at 30fps, so recordings of different
# windows concatenate cleanly. Segment video is kept without its own audio:
# the narration file, when given, becomes the entire soundtrack, which is
# how the production plan says the video is built. Output: CLIPDIR/final.mp4
set -euo pipefail

CLIPDIR="${1:-video}"
NARRATION="${2:-}"
MANIFEST="$CLIPDIR/clips.txt"
CAPTIONS="$CLIPDIR/captions.txt"
RENDER="$(dirname "$0")/render-caption.py"
WORK="$CLIPDIR/.segments"
OUT="$CLIPDIR/final.mp4"

command -v ffmpeg >/dev/null || { echo "ffmpeg not found; brew install ffmpeg" >&2; exit 1; }
[ -f "$MANIFEST" ] || { echo "no manifest at $MANIFEST" >&2; exit 1; }

to_seconds() { # accepts 90, 90.5 or 1:30
  case "$1" in
    *:*) awk -F: '{ print $1 * 60 + $2 }' <<<"$1" ;;
    *)   printf '%s\n' "$1" ;;
  esac
}

mkdir -p "$WORK"
: > "$WORK/concat.txt"

n=0
while read -r file start end speed _; do
  case "$file" in ''|\#*) continue ;; esac
  n=$((n + 1))
  src="$CLIPDIR/$file"
  [ -f "$src" ] || { echo "missing clip: $src" >&2; exit 1; }
  seg="$WORK/seg$(printf '%02d' "$n").mp4"

  seek=()
  [ "${start:--}" != "-" ] && seek+=(-ss "$(to_seconds "$start")")
  if [ "${end:--}" != "-" ]; then
    s=0; [ "${start:--}" != "-" ] && s=$(to_seconds "$start")
    dur=$(awk -v a="$(to_seconds "$end")" -v b="$s" 'BEGIN { print a - b }')
    seek+=(-t "$dur")
  fi

  vf="scale=1920:1080:force_original_aspect_ratio=decrease"
  vf="$vf,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p"
  [ "${speed:--}" != "-" ] && vf="$vf,setpts=PTS/$speed"

  # Captions become transparent PNGs (this ffmpeg build has no drawtext)
  # overlaid near the bottom of the frame. Times are relative to the clip
  # as it appears in the final cut, after trim and speed.
  capinputs=()
  fc="[0:v]$vf[v0]"
  last="v0"
  ci=0
  if [ -f "$CAPTIONS" ]; then
    while read -r cfile cstart cend ctext; do
      case "$cfile" in ''|\#*) continue ;; esac
      [ "$cfile" = "$file" ] || continue
      [ -n "$ctext" ] || { echo "captions.txt: no text for $cfile" >&2; exit 1; }
      ci=$((ci + 1))
      png="$WORK/cap_${n}_${ci}.png"
      python3 "$RENDER" "$png" "$ctext"
      capinputs+=(-i "$png")
      cs=$(to_seconds "$cstart")
      ce=9999; [ "$cend" != "-" ] && ce=$(to_seconds "$cend")
      fc="$fc;[$last][${ci}:v]overlay=(W-w)/2:H-h-90:enable='between(t,$cs,$ce)'[v$ci]"
      last="v$ci"
    done < "$CAPTIONS"
    [ "$ci" -gt 0 ] && echo "  $ci caption(s) burned onto $file"
  fi

  echo "segment $n: $file (start=${start:--} end=${end:--} speed=${speed:--})"
  ffmpeg -nostdin -hide_banner -loglevel error -y ${seek[@]+"${seek[@]}"} -i "$src" \
    ${capinputs[@]+"${capinputs[@]}"} \
    -filter_complex "$fc" -map "[$last]" -an -c:v libx264 -preset medium -crf 18 "$seg"
  echo "file 'seg$(printf '%02d' "$n").mp4'" >> "$WORK/concat.txt"
done < "$MANIFEST"

[ "$n" -gt 0 ] || { echo "manifest listed no clips" >&2; exit 1; }

if [ -n "$NARRATION" ]; then
  [ -f "$NARRATION" ] || { echo "missing narration: $NARRATION" >&2; exit 1; }
  ffmpeg -nostdin -hide_banner -loglevel error -y \
    -f concat -safe 0 -i "$WORK/concat.txt" -i "$NARRATION" \
    -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k "$OUT"
else
  ffmpeg -nostdin -hide_banner -loglevel error -y \
    -f concat -safe 0 -i "$WORK/concat.txt" -map 0:v -c:v copy -an "$OUT"
  echo "note: no narration given, so the output is silent"
fi

vdur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT")
echo
echo "wrote $OUT (${vdur%.*}s)"
if [ -n "$NARRATION" ]; then
  adur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$NARRATION")
  echo "narration is ${adur%.*}s; the output ends when the longer one does,"
  echo "so if these differ by much, adjust the trims and run again"
fi
awk -v d="$vdur" 'BEGIN { if (d >= 180) print "WARNING: over the 3:00 limit" ; else printf "%.0fs under the 3:00 limit\n", 180 - d }'
