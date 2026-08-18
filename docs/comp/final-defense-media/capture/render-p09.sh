#!/usr/bin/env sh
set -eu

capture_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
media_dir=$(CDPATH= cd -- "$capture_dir/.." && pwd)
work_dir=$(mktemp -d)
trap 'rm -rf "$work_dir"' EXIT HUP INT TERM

for scene in 1 2 3; do
  magick -background none "$capture_dir/p09-scene-$scene.svg" "$work_dir/p09-scene-$scene.png"
done
cp "$capture_dir/p09-scenes.ffconcat" "$work_dir/p09-scenes.ffconcat"

ffmpeg -y \
  -f concat -safe 0 -i "$work_dir/p09-scenes.ffconcat" \
  -vf "fps=30,format=yuv420p" \
  -t 18 \
  -c:v libx264 -preset medium -crf 18 -movflags +faststart \
  "$media_dir/videos/p09-kernel-debug.mp4"

ffmpeg -y -sseof -0.25 -i "$media_dir/videos/p09-kernel-debug.mp4" \
  -frames:v 1 "$media_dir/frames/p09-kernel-debug.png"
