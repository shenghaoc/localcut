#!/usr/bin/env bash
# Generate deterministic tiny test fixtures using ffmpeg lavfi sources.
# All outputs are under 100 KB and use universally-supported codecs.
# Prerequisites: ffmpeg with libx264, libvpx-vp9

set -euo pipefail
cd "$(dirname "$0")"

echo "Generating test fixtures..."

# 1s 320x240 H.264 Baseline + AAC mono, ~30 KB
ffmpeg -y -f lavfi -i "color=c=blue:size=320x240:duration=1:rate=24" \
  -f lavfi -i "sine=frequency=440:duration=1:sample_rate=48000" \
  -c:v libx264 -profile:v baseline -level 3.0 -preset ultrafast -crf 28 \
  -c:a aac -b:a 48k -ac 1 \
  -movflags +faststart \
  tiny-h264.mp4

# 1s 320x240 VP9 + Opus, ~20 KB
ffmpeg -y -f lavfi -i "color=c=red:size=320x240:duration=1:rate=24" \
  -f lavfi -i "sine=frequency=880:duration=1:sample_rate=48000" \
  -c:v libvpx-vp9 -crf 40 -b:v 0 -cpu-used 8 \
  -c:a libopus -b:a 48k -ac 1 \
  tiny-vp9.webm

# 720p still image, ~5 KB
ffmpeg -y -f lavfi -i "color=c=green:size=1280x720:duration=1:rate=1" \
  -frames:v 1 \
  still-720p.png

# 1s 48 kHz mono WAV tone, ~96 KB
ffmpeg -y -f lavfi -i "sine=frequency=440:duration=1:sample_rate=48000" \
  -ac 1 \
  tone-48k.wav

echo "Done. Generated fixtures:"
ls -lh tiny-h264.mp4 tiny-vp9.webm still-720p.png tone-48k.wav
