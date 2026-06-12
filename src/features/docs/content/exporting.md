# Exporting

Export renders your timeline to a video file on your machine. Encoding runs in your browser using hardware acceleration where available — there is no cloud rendering and no upload.

## Direct export

1. Click **Export** in the toolbar.
2. Pick your settings:
   - **Codec**: H.264, VP9, or AV1. Only codecs your browser can actually encode are offered; the dialog explains any constraints (the **Why?** link opens the capability details).
   - **Container**: MP4 or WebM.
   - **Resolution / frame rate / bitrate**: defaults follow your source; override as needed.
   - **Range**: full timeline, the marked range, or custom in/out points.
3. Click **Start** and choose where to save. Progress and an ETA show in the dialog and status bar; **Cancel** works at any time.

## Which codec should I pick?

- **H.264 + MP4** — the safe default: fastest to encode on most hardware and plays everywhere.
- **VP9 / AV1 + WebM** — better compression, but encoding support depends on your browser and GPU; AV1 encoding in particular is only offered when your hardware supports it.

The offered list is probed from your actual browser and hardware, so it can differ between machines — that's expected. See [Browser limitations](/docs/browser-limitations).

## Presets

Save the current dialog settings with **Save Preset** and reuse them from the preset dropdown. Presets persist with the app on this machine.

## Render queue

To render several jobs back-to-back (different ranges, codecs, or marker-bounded segments):

1. Configure settings in the export dialog and click **Add to Queue** instead of Start.
2. The **Render Queue** panel appears under the timeline. Pick an output destination per job.
3. Click **Start** — jobs run sequentially with per-job progress, retry-on-failure, and an optional stop-on-error mode.

## Captions in exports

Caption tracks can be exported as separate SRT/VTT files from the Captions panel, or burned into the picture when the track's **burn-in** option is enabled.

## If an export fails or looks wrong

- **A warning about transitions or effects being skipped** means the reduced-compatibility export path is active; switch to a Chromium browser with WebGPU for full rendering.
- **Encoder errors mid-export** are usually memory or hardware-encoder pressure — close other GPU-heavy tabs and apps, lower the export resolution or bitrate, and retry.
- **No save dialog appeared**: some browsers download to the default folder instead of asking; check your downloads.
- More steps in [Troubleshooting](/docs/troubleshooting).
