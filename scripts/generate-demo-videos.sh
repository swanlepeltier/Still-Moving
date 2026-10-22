#!/usr/bin/env bash
# Generates a set of lightweight, silent, looping demo films for the gallery.
# These are placeholders: drop your own .mp4 files into public/videos and they
# will appear automatically alongside (or instead of) these.
#
# Each film is a single soft light field (a still gradient), then given a very
# slow breathing zoom and parallax drift with zoompan, plus 35mm grain and a
# gentle vignette. Because the source is static, the loop stays luminous for
# its whole duration instead of fading out the way an animated gradient does.
#
# Usage: npm run demo:media            # skips files that already exist
#        FORCE=1 npm run demo:media    # regenerates everything
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p public/videos public/posters

W=1280
H=800
SW=1600 # still is rendered larger than the output so zoompan can move
SH=1000
FPS=24
DUR=8
FRAMES=$((FPS * DUR))

tmp="$(mktemp -d "${TMPDIR:-/tmp}/still-moving.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT

# name | c0 (light) | c1 (mid) | c2 (deep) | type | x0 | y0 | x1 | y1
films=(
  "salt-flats|#fdf0d2|#d8b47e|#4e3520|radial|820|520|1600|1080"
  "night-swim|#d9f6ec|#5fb3a5|#0c3430|radial|420|640|1500|1000"
  "ember-hour|#ffd7a1|#d8641f|#3a1105|radial|860|430|1600|1050"
  "cold-front|#eaf3f9|#5f7f92|#0b141a|linear|0|100|1600|900"
  "bloom-study|#ffd6dc|#c96a78|#4a1a28|radial|560|380|1400|1050"
  "signal-fire|#f4ffb0|#9ccf36|#223305|radial|980|320|1600|1000"
  "dusk-ritual|#ffe1c6|#b18399|#331a2c|radial|760|620|1900|1400"
  "monolith|#f4f0e2|#8e8a7c|#16160f|radial|1160|520|0|0"
  "tidepool|#d9f6cf|#5fae7f|#052018|radial|380|620|1500|1000"
  "paper-moon|#fff8e6|#b8ad95|#100f0c|radial|330|700|1500|0"
  "slow-burn|#ffe0a8|#c25b1e|#1a0702|linear|1600|100|0|1000"
  "still-water|#e4f2f1|#6e969c|#07161a|radial|900|420|0|1000"
)

phase=0
for film in "${films[@]}"; do
  IFS='|' read -r name c0 c1 c2 type x0 y0 x1 y1 <<< "$film"
  out="public/videos/${name}.mp4"

  if [[ -f "$out" && "${FORCE:-0}" != "1" ]]; then
    echo "skip  ${out}"
    phase=$((phase + 1))
    continue
  fi

  echo "make  ${out}"
  still="$tmp/${name}.png"

  if [[ "$type" == "linear" ]]; then
    gradient="gradients=s=${SW}x${SH}:c0=${c0}:c1=${c1}:c2=${c2}:n=3:type=linear:x0=${x0}:y0=${y0}:x1=${x1}:y1=${y1}"
  else
    gradient="gradients=s=${SW}x${SH}:c0=${c0}:c1=${c1}:c2=${c2}:n=3:type=radial:x0=${x0}:y0=${y0}:x1=${x1}:y1=${y1}"
  fi

  # A still light field, already grained and vignetted, so motion later does
  # not have to re-render the gradient on every frame.
  ffmpeg -hide_banner -loglevel error -y \
    -f lavfi -i "$gradient" \
    -vf "noise=alls=6:allf=t+u,vignette=PI/9,eq=contrast=1.03:saturation=0.98" \
    -frames:v 1 "$still"

  # Breathing zoom (1.04 -> 1.10 -> 1.04) plus a slow parallax drift. Both
  # expressions are periodic over the clip, so the last frame meets the first.
  drift=26
  ph=$(awk "BEGIN { printf \"%.4f\", ${phase} * 1.5707963 }")
  zoom="1.07-0.03*cos(2*PI*on/${FRAMES})"
  px="iw/2-(iw/zoom/2)+${drift}*sin(2*PI*on/${FRAMES}+${ph})"
  py="ih/2-(ih/zoom/2)+${drift}*sin(4*PI*on/${FRAMES}+${ph})"

  ffmpeg -hide_banner -loglevel error -y \
    -loop 1 -framerate "$FPS" -i "$still" \
    -vf "zoompan=z='${zoom}':x='${px}':y='${py}':d=${FRAMES}:s=${W}x${H}:fps=${FPS},format=yuv420p" \
    -frames:v "$FRAMES" -t "$DUR" \
    -c:v libx264 -preset slow -crf 26 -profile:v high -pix_fmt yuv420p \
    -movflags +faststart -an "$out"

  phase=$((phase + 1))
done

echo "done. now generating missing posters..."
node scripts/make-posters.mjs
