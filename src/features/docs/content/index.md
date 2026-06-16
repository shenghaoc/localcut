# LocalCut Studio User Guide

LocalCut Studio is a video editor that runs entirely in your browser. There is no account, no upload, and no cloud rendering: your media files, your project, and every export stay on your computer. The app uses your machine's own hardware — the GPU for preview and effects, the media engine built into your browser for decoding and encoding — which is why a modern Chromium browser gives the best experience.

## What you can do

- **Import** video, audio, and image files straight from your disk.
- **Edit** on a multi-track timeline: split, trim, move, ripple, transitions, titles, markers.
- **Grade and mix**: per-clip effects, LUTs, keyframes, per-track gain/pan, fades, scopes.
- **Caption**: import SRT/VTT subtitles, edit them inline, restyle them with animated presets, burn them in or export them — or auto-transcribe a clip on-device with the experimental Auto Captions (LiteRT Whisper) feature. See [Captions](/docs/captions).
- **Export** H.264, VP9, or AV1 in MP4 or WebM, with presets and a render queue.
- **Stream** the program output live to a WHIP ingest endpoint.

## Where to start

- New to the app? Read [Getting started](/docs/getting-started).
- Bringing in footage? See [Importing media](/docs/importing-media) and what to expect from different files.
- Cutting your project? [Timeline editing](/docs/timeline-editing) covers tools and keyboard shortcuts.
- Polishing a tutorial? [Screencast Post Pack](/docs/screencast-post-pack) adds zoom presets, auto-zoom proposals, callouts, and padded backgrounds; [Silence detection](/docs/silence-detection) finds dead air, [Keystroke overlay](/docs/keystroke-overlay) adds keycap clips, and [YouTube chapters](/docs/youtube-chapters) generates a chapter list from your markers.
- Ready to render? [Exporting](/docs/exporting) explains codecs, presets, and the render queue.
- Something looks limited or broken? Check [Browser limitations](/docs/browser-limitations) and [Troubleshooting](/docs/troubleshooting).

## Your data stays local

LocalCut Studio is a static web app. Once it has loaded, core editing works without an internet connection at all:

- Imported media is read directly from your disk and kept in browser-managed storage on your machine. Nothing is uploaded.
- Projects autosave to your browser's local storage (IndexedDB) on your computer.
- Exports are encoded on your machine and saved wherever you choose.
- There is no telemetry and no server-side media processing.

The only times the app touches the network are: loading the app itself, fetching optional on-device model files when you explicitly ask for them (for example Audio Cleanup), and live streaming — which sends your stream directly to the ingest server _you_ configure.

## About this alpha

LocalCut Studio is alpha software. Features are honest about their limits: when your browser can't run the full accelerated pipeline, the app tells you and falls back to a clearly labeled reduced mode instead of failing silently. If something behaves unexpectedly, the [Troubleshooting](/docs/troubleshooting) page and the in-app **Diagnostics** panel are the best places to look first.
