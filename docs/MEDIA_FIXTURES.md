# LocalCut Studio — Media Fixture Checklist

Use this checklist to validate media handling across different file types and edge cases. Each fixture describes expected behavior at every stage of the editing pipeline.

Do not commit copyrighted or large media files to the repository. Testers should source or generate their own fixtures locally. Generation hints are provided where applicable.

## Fixture Categories

### 1. Short H.264/AAC MP4

**Description**: Standard MP4, H.264 video + AAC audio, 5–15 seconds, 1080p, constant frame rate.

**Generation**: `ffmpeg -f lavfi -i testsrc2=duration=10:size=1920x1080:rate=30 -f lavfi -i sine=frequency=440:duration=10 -c:v libx264 -c:a aac -shortest fixture-h264.mp4`

| Stage       | Expected Behavior                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------ |
| Import      | Appears in Media Bin. No warnings. Auto-placed on timeline if first import.                      |
| Diagnostics | Media Details shows: resolution, 30fps, H.264 video codec, AAC audio codec, duration, file size. |
| Preview     | Plays smoothly at native or adaptive resolution. Audio audible.                                  |
| Timeline    | Clip shows on video track. Waveform renders on audio track. Split/trim/move work.                |
| Export      | Exports as H.264 MP4. Output duration matches timeline. Audio present in output.                 |

### 2. iPhone MOV with Rotation

**Description**: QuickTime MOV from iPhone, H.264/AAC, portrait mode (90° or 270° rotation metadata).

**Generation**: `ffmpeg -f lavfi -i testsrc2=duration=5:size=1080x1920:rate=30 -f lavfi -i sine=frequency=440:duration=5 -c:v libx264 -c:a aac -metadata:s:v rotate=90 fixture-iphone.mov`

| Stage       | Expected Behavior                                                               |
| ----------- | ------------------------------------------------------------------------------- |
| Import      | Appears in Media Bin. Rotation metadata warning shown in bin and Media Details. |
| Diagnostics | Media Details shows rotation value (e.g. "90°").                                |
| Preview     | Clip appears upright (rotation applied automatically).                          |
| Timeline    | Placed with rotation pre-applied. Inspector shows rotation value.               |
| Export      | Output respects the rotation — content appears upright in the exported file.    |

### 3. WebM VP9/Opus

**Description**: WebM container, VP9 video + Opus audio, 5–10 seconds, 720p.

**Generation**: `ffmpeg -f lavfi -i testsrc2=duration=8:size=1280x720:rate=30 -f lavfi -i sine=frequency=880:duration=8 -c:v libvpx-vp9 -c:a libopus fixture-vp9.webm`

| Stage       | Expected Behavior                                                         |
| ----------- | ------------------------------------------------------------------------- |
| Import      | Appears in Media Bin. No warnings if browser supports VP9 decode.         |
| Diagnostics | Media Details shows VP9 video codec, Opus audio codec.                    |
| Preview     | Plays smoothly. Audio audible.                                            |
| Timeline    | Clip on video track, waveform on audio track. Editing works.              |
| Export      | Can export as WebM (VP9) if encoder available, or re-encode to H.264 MP4. |

### 4. Variable Frame Rate (VFR) Screen Recording

**Description**: MP4 with variable frame rate, common from screen recording tools.

**Generation**: Create with a screen recording tool, or simulate with: `ffmpeg -f lavfi -i testsrc2=duration=10:size=1920x1080:rate=30 -vf "setpts='PTS+if(gt(N\,50)\,0.5\,0)*TB'" -c:v libx264 -vsync vfr fixture-vfr.mp4`

| Stage       | Expected Behavior                                                |
| ----------- | ---------------------------------------------------------------- |
| Import      | Appears in Media Bin. VFR warning shown ("Variable frame rate"). |
| Diagnostics | Media Details shows "variable" frame rate badge.                 |
| Preview     | Plays back honoring actual frame durations. No systematic drift. |
| Timeline    | Clip placed with correct total duration.                         |
| Export      | Export uses actual frame timing. Output duration matches source. |

### 5. Audio-Only File

**Description**: WAV, MP3, M4A, or OGG file with no video track.

**Generation**: `ffmpeg -f lavfi -i sine=frequency=440:duration=10:sample_rate=48000 -c:a pcm_s16le fixture-audio.wav`

| Stage       | Expected Behavior                                                                      |
| ----------- | -------------------------------------------------------------------------------------- |
| Import      | Appears in Media Bin as audio source. No video thumbnail expected.                     |
| Diagnostics | Media Details shows audio codec, sample rate, channels, duration. No video track info. |
| Preview     | No video frame displayed. Audio plays during playback.                                 |
| Timeline    | Placed on an audio track. Waveform renders.                                            |
| Export      | Audio included in export output. No video-only export failure.                         |

### 6. SRT Subtitle File

**Description**: SubRip `.srt` caption file.

**Example content**:

```
1
00:00:01,000 --> 00:00:04,000
Hello, this is a test caption.

2
00:00:05,000 --> 00:00:08,000
Second caption line.
```

| Stage       | Expected Behavior                                                                  |
| ----------- | ---------------------------------------------------------------------------------- |
| Import      | Loaded via the Transcript panel import. Segments appear in the caption track.      |
| Diagnostics | N/A (captions are not media sources).                                              |
| Preview     | Captions render over video when burn-in or overlay is enabled.                     |
| Timeline    | Caption segments appear in the transcript panel with editable text and timing.     |
| Export      | Captions can be exported as SRT or VTT. Burn-in renders text into the video frame. |

### 7. WebVTT Subtitle File

**Description**: Web Video Text Tracks `.vtt` caption file.

**Example content**:

```
WEBVTT

00:00:01.000 --> 00:00:04.000
Hello, this is a test caption.

00:00:05.000 --> 00:00:08.000
Second caption line.
```

| Stage    | Expected Behavior                                                             |
| -------- | ----------------------------------------------------------------------------- |
| Import   | Loaded via the Transcript panel import. Segments appear in the caption track. |
| Preview  | Captions render over video when enabled.                                      |
| Timeline | Segments editable in the transcript panel.                                    |
| Export   | Captions can be exported as SRT or VTT.                                       |

### 8. Long 1080p File

**Description**: H.264/AAC MP4, 5+ minutes, 1080p, constant frame rate. Tests performance and memory.

**Generation**: `ffmpeg -f lavfi -i testsrc2=duration=300:size=1920x1080:rate=30 -f lavfi -i sine=frequency=440:duration=300 -c:v libx264 -preset ultrafast -c:a aac fixture-long.mp4`

| Stage       | Expected Behavior                                                                                           |
| ----------- | ----------------------------------------------------------------------------------------------------------- |
| Import      | Imports without freezing the UI. Progress may be shown for metadata parsing.                                |
| Diagnostics | Media Details shows full duration. No memory warnings for metadata import alone.                            |
| Preview     | Seeking across the full duration works. Frame cache handles sparse access.                                  |
| Timeline    | Clip spans the full duration. Zoom/scroll handle the longer timeline.                                       |
| Export      | Full export may take significant time. Progress and ETA are shown. Backpressure prevents memory exhaustion. |

### 9. Unsupported or Corrupt File

**Description**: A file that is not valid media (e.g. a renamed `.txt` file, a truncated MP4, or a format the browser cannot decode).

**Generation**: `echo "this is not a video file" > fixture-corrupt.mp4`

| Stage       | Expected Behavior                                                                                                           |
| ----------- | --------------------------------------------------------------------------------------------------------------------------- |
| Import      | Import fails with a specific error message identifying the problem (e.g. "unsupported container" or "corrupt file header"). |
| Diagnostics | Recent errors log shows the import failure with an error code.                                                              |
| Preview     | No preview rendered. No crash.                                                                                              |
| Timeline    | No clip placed. Existing timeline is not affected.                                                                          |
| Export      | N/A (nothing to export from this source).                                                                                   |

## Still Image Fixtures

### 10. PNG/JPG Still Image

**Description**: A static image file (PNG, JPG, WebP).

| Stage    | Expected Behavior                                                         |
| -------- | ------------------------------------------------------------------------- |
| Import   | Appears in Media Bin as an image source. Thumbnail generated.             |
| Timeline | Placed on a video track with a default still duration.                    |
| Preview  | Image displays at the correct aspect ratio. Transforms and effects apply. |
| Export   | Image composited into the video output for its timeline duration.         |

## Validation Notes

- **No network required**: All fixtures are local files. No server upload or cloud processing.
- **Privacy**: Diagnostics reports must not include file names, paths, or media content from fixtures.
- **Capability skips**: If a fixture requires a codec the browser does not support, the import should show a clear unsupported-codec message rather than a generic error.
- **Frame closure**: After import/preview/export, no `VideoFrame` objects should remain unclosed (verify via DevTools memory snapshot if needed).
