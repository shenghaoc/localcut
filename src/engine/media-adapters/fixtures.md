# Media Fixture Matrix

Phase 18 conformance tests use small generated fixtures where practical and descriptor-only/manual fixtures where a checked-in file would bloat the repo. All fixtures stay local; none require server-side media processing.

| Fixture                | Purpose                                     | Expected health                | Storage           | Reproduction                                                                       |
| ---------------------- | ------------------------------------------- | ------------------------------ | ----------------- | ---------------------------------------------------------------------------------- |
| Small MP4              | Baseline import, trim, preview, export      | `ok`                           | generated/manual  | `ffmpeg -f lavfi -i testsrc2=size=640x360:rate=30 -t 2 -pix_fmt yuv420p small.mp4` |
| Small MOV              | QTFF/MOV metadata and track starts          | `ok` or `non-zero-track-start` | generated/manual  | `ffmpeg -f lavfi -i testsrc2=size=640x360:rate=30 -t 2 -c:v libx264 small.mov`     |
| Small WebM             | Non-MP4 container path                      | `ok`                           | generated/manual  | `ffmpeg -f lavfi -i testsrc2=size=640x360:rate=30 -t 2 -c:v libvpx-vp9 small.webm` |
| VFR screen recording   | VFR warning and timestamp mapping           | `variable-frame-rate`          | manual/descriptor | Capture a short browser screen recording with uneven frame cadence.                |
| Rotated phone footage  | Rotation metadata and display dimensions    | `rotation-metadata`            | manual/descriptor | Import portrait phone footage carrying 90 degree rotation metadata.                |
| Mixed sample rates     | Import warning and export guard             | `mixed-audio-sample-rates`     | generated/manual  | Combine 48 kHz and 44.1 kHz audio tracks in one project.                           |
| Audio-only             | Audio descriptor and timeline placement     | `ok`                           | generated/manual  | `ffmpeg -f lavfi -i sine=frequency=440:sample_rate=48000 -t 2 tone.wav`            |
| Still image            | Existing still path through adapter facade  | `ok`                           | generated/manual  | `ffmpeg -f lavfi -i color=c=blue:s=640x360 -frames:v 1 still.png`                  |
| Long 4K media          | Lazy reads, no full-buffer import           | `ok` or performance warning    | manual only       | Use local 4K footage; do not check into git.                                       |
| Corrupt/truncated file | Blocking health report without worker crash | `corrupt-or-truncated-file`    | generated/manual  | `dd if=small.mp4 of=truncated.mp4 bs=1024 count=8`                                 |

Integration smoke subset:

1. Import small MP4, trim to the middle second, preview, and export MP4.
2. Import small WebM and confirm it enters the media bin with container metadata.
3. Import `tone.wav`, place it on an audio track, and export with a video source.
4. Import `still.png`, place it on a video track, and verify still duration/thumbnail behavior.
5. Import `truncated.mp4` and confirm the shell stays alive with a blocking health report.
