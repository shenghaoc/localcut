# Importing media

LocalCut Studio reads media files directly from your disk. Nothing is uploaded — importing a file registers it with the editor and keeps working data in browser-managed storage on your machine.

## How to import

- **Drag and drop** files anywhere onto the editor window.
- Click **Import** in the toolbar and pick files (multi-select works).
- Imported items appear in the **Media Bin**. Click **+** on a bin entry to place it on the timeline, **ⓘ** for full details, or the trash icon to remove it.

## Supported formats

| Type   | Formats that generally work                                      |
| ------ | ---------------------------------------------------------------- |
| Video  | MP4, MOV, WebM (H.264, VP8/VP9, AV1 — depending on your browser) |
| Audio  | MP3, M4A/AAC, WAV, OGG                                           |
| Images | PNG, JPG, WebP, GIF, AVIF                                        |

"Depending on your browser" matters: decoding is done by your browser's built-in media engine (WebCodecs), so the exact codec list varies by browser and operating system. A file that plays in one browser may not decode in another — see [Browser limitations](/docs/browser-limitations). Codecs that browsers don't license, such as AC-3 audio or some professional camera formats, won't decode anywhere on the web.

## Media details and import health

Click **ⓘ** on a bin entry to open **Media Details**: resolution, frame rate, rotation, codecs, channel layout, sample rate, duration, and file size, plus the full text of any actionable warning.

Files with unusual but supported characteristics are handled as metadata, not warnings:

- **Variable frame rate (VFR)** — typical for phone recordings. Playback and export honour each frame's real duration, so audio stays in sync. Informational only.
- **Rotation metadata** — portrait phone clips carry a rotation flag; the clip is placed already rotated upright. You can override it in the Inspector.
- **Audio/video offset** — the engine compensates automatically.
- **Mixed audio sample rates** — sources at 44.1 kHz and 48 kHz can share a timeline; everything is resampled to a common rate automatically.

Visible health warnings are reserved for actionable problems such as unsupported codecs, rejected Lottie zip containers, unavailable cleaned-audio assets, or missing duration/corrupt files. If the _primary_ track can't decode, the clip is unusable in this browser; secondary tracks (for example a second audio language) are skipped silently.

## If an import fails

1. Check the warning text in the Media Bin or the Media Details popover — it names the codec, missing asset, or file problem at fault.
2. Try a Chromium browser; codec support is widest there.
3. Re-encode the file to H.264 MP4 with a tool like HandBrake or ffmpeg; that format imports virtually everywhere.
4. See [Troubleshooting](/docs/troubleshooting) for more recovery steps.

## Files can go "offline"

Your project references files on disk. If a source file is moved, renamed, or deleted, the project loads with that source marked **offline**, and a banner offers to **re-link** it — click Re-link and pick the file at its new location. The **Collect media** bundle action (toolbar, next to Export) copies every referenced file into one folder so projects stay portable.
