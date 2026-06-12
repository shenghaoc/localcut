# Troubleshooting

Work top-down: most problems are explained by the capability tier, the source file, or browser resource pressure. The **Diagnostics** panel (status-bar button) shows recent errors with recovery actions and is referenced throughout.

## Import fails or a clip is unusable

1. Read the warning on the Media Bin entry (or the **ⓘ** Media Details popover) — it names the codec or track at fault.
2. If the codec is unsupported (for example AC-3 audio), no browser can decode it; re-encode to H.264 MP4 + AAC with HandBrake or ffmpeg.
3. Try a Chromium browser — codec coverage is widest there. See [Browser limitations](/docs/browser-limitations).
4. Zero-byte or truncated files (interrupted phone transfers) fail metadata parsing; re-copy the file.

## Preview is black or playback won't start

- Check the pipeline strip: **Limited shell / Blocked** means the pipeline isn't running — open **Capabilities** for the reason.
- If the tier is Accelerated but the preview is black, the pipeline worker may have crashed; the app restarts it automatically and the status bar says so. If restarts are exhausted, reload the page — autosave restores your timeline.
- A clip whose primary track failed to decode shows a named codec warning at import; the clip can't play. Replace or re-encode the source.

## Playback stutters or drops frames

That's load, not corruption: the app drops video frames to keep audio continuous. Work through [Performance](/docs/performance) — close GPU-heavy tabs, plug in, check hardware acceleration, and let the adaptive preview resolution help.

## Export fails or stops mid-way

- **Starts then fails**: usually encoder/memory pressure. Close other apps using the GPU encoder, lower resolution or bitrate, retry. The error text in the export dialog and the Diagnostics panel's recent errors narrow it down.
- **A codec is greyed out or missing**: your browser/hardware can't encode it; the **Why?** link explains. Pick H.264 — it's available almost everywhere.
- **Warnings about skipped transitions/effects**: the reduced-compatibility export path is active; use a WebGPU-capable Chromium browser for full rendering.
- **No file appeared**: some browsers save to the default downloads folder without asking.

## "Offline media" / re-linking

If a source moved, renamed, or permissions were lost, a banner lists the offline sources. Click **Re-link** next to each and select the file at its new location. The file name, size, and duration must match the original recording for the project to pick it up cleanly.

## The app says my browser is limited

Open **Capabilities** in the pipeline strip — each row says what was probed and what's missing (WebGPU, WebCodecs, cross-origin isolation…). On a Chromium browser, the usual fixes are enabling hardware acceleration in browser settings and updating GPU drivers. Background and full explanations in [Browser limitations](/docs/browser-limitations).

## Worker crashed / "restart available"

The editing engine runs in a background worker. If it crashes, the shell stays alive, the worker restarts automatically (up to a limit), and your timeline is restored from autosave. If the status bar says the restart limit was reached, reload the page.

## Storage pressure

Captures, caches, and cleaned-audio assets live in browser storage with a quota. The Diagnostics panel shows usage; the storage cleanup dialog can clear reclaimable data. Exported files on your disk are never touched.

## Still stuck?

Open **Diagnostics**, check **Recent Errors** for an error code and suggested recovery action (restart worker, retry audio, reload). Error reports are redacted of file contents by design — only metadata about the failure is recorded, locally.
