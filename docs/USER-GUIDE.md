# LocalCut Studio — User Guide

LocalCut Studio is a browser-native non-linear video editor. It runs entirely on your computer — no uploads, no cloud processing, no account required. Import media, edit on a timeline, apply effects, mix audio, and export — all in your browser.

## Browser Requirements

LocalCut Studio uses your browser's hardware acceleration for real-time video processing. There are four capability tiers:

| Tier                  | What You Get                             | Requirements                                                           |
| --------------------- | ---------------------------------------- | ---------------------------------------------------------------------- |
| **Accelerated**       | Full WebGPU preview, effects, and export | Chromium browser (Chrome/Edge/Brave) with WebGPU + COOP/COEP isolation |
| **Compatibility GPU** | Reduced GPU preview and export           | Chromium browser with compatibility WebGPU adapter                     |
| **Limited WebCodecs** | Canvas2D preview, limited export         | Browser with WebCodecs decode but no WebGPU                            |
| **Shell Only**        | App loads but preview/export unavailable | Any modern browser                                                     |

The status bar at the bottom shows your current tier. Click **Capabilities** in the toolbar for details about what your browser supports and what's missing.

## Getting Started

1. Open LocalCut Studio in a Chromium browser (Chrome, Edge, or Brave recommended).
2. Check the status bar — it should show **Accelerated** or **Compatibility GPU**.
3. Import media to begin editing.

## Importing Media

You can import video, audio, and image files:

- **Drag and drop** files directly onto the editor window.
- **Click Import** in the toolbar and select files from your computer.
- **Supported formats**: MP4, MOV, WebM (video), MP3, M4A, WAV, OGG (audio), PNG, JPG, WebP, GIF, AVIF (images).

Imported media appears in the **Media Bin** on the left side of the workspace. When the timeline is empty, the first playable import is also placed on the timeline so you can press **Play** immediately. To add another source to the timeline, click the **+** button next to it in the Media Bin.

### Media Details

Each bin entry has three action buttons:

| Button | Action                                                                                                                                                                                                                                                                                   |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ⓘ**  | Open the **Media Details** popover — full filename, resolution, frame rate (with a _variable_ badge for VFR sources), rotation metadata, video/audio codecs, channel layout, sample rate, duration, file size, the proxy recommendation, and every source-health warning at full length. |
| **+**  | Place the clip on the timeline.                                                                                                                                                                                                                                                          |
| **🗑** | Remove the entry from the bin.                                                                                                                                                                                                                                                           |

The Media Details popover is the place to look when a clip shows a warning in the bin list — it has the full message text untruncated and identifies the exact codec, track, or timing issue.

### Source Health Warnings

When a file has unusual characteristics, the bin item shows them inline (truncated only by available width) and the Media Details popover shows them in full. Common warnings:

- **Variable frame rate** — phone recordings often vary frame timing. Preview and export honour each frame's actual duration so playback stays synced; the warning is informational.
- **Rotation metadata** — a portrait-mode phone clip carries a 90° or 270° rotation flag. The clip is placed on the timeline with that rotation already applied so it appears upright; you can override it from the Inspector if needed.
- **Audio/video offset** — when the audio track starts a few milliseconds before or after the video. The engine compensates automatically (inserting silence ahead of the audio when needed).
- **Mixed audio sample rates** — when audio tracks in the timeline use different sample rates (e.g. 44.1 kHz and 48 kHz). The engine resamples every source to a common output rate automatically — the playback engine rate during preview, and the export's chosen rate when rendering — so mixed-rate timelines stay in tune. No action is required.
- **Unsupported audio/video codec** — the message names the codec (e.g. `(ac-3)` or `(unknown codec)` when the container does not advertise one). If the **primary** track uses an unsupported codec the clip cannot decode; secondary tracks are silently skipped.

### Compatibility Imports

If your browser is in a limited tier, importing still works — it loads a reduced compatibility preview so you can inspect a clip. Timeline editing and export may be constrained.

## Timeline Editing

The timeline is where you arrange and edit your clips. Each track holds clips of a single type (video or audio).

### Transport Controls

| Control      | Shortcut | Action                                  |
| ------------ | -------- | --------------------------------------- |
| Play         | `L`      | Start playback from the playhead        |
| Pause        | `K`      | Pause playback                          |
| Step Back    | `J`      | Move one frame backward                 |
| Step Forward | —        | Move one frame forward (toolbar button) |

### Editing Operations

| Action        | Shortcut                       | How It Works                                        |
| ------------- | ------------------------------ | --------------------------------------------------- |
| **Split**     | `S`                            | Cuts the selected clip at the playhead position     |
| **Delete**    | `Delete` or `Backspace`        | Removes selected clip(s) from the timeline          |
| **Trim**      | Drag clip edges                | Drag the left or right edge of a clip to trim it    |
| **Move**      | Drag clip body                 | Drag a clip horizontally to move it on the timeline |
| **Undo**      | `Ctrl+Z` / `Cmd+Z`             | Undo the last action                                |
| **Redo**      | `Ctrl+Shift+Z` / `Cmd+Shift+Z` | Redo the last undone action                         |
| **Copy**      | `Ctrl+C` / `Cmd+C`             | Copy selected clip(s)                               |
| **Paste**     | `Ctrl+V` / `Cmd+V`             | Paste copied clip(s) at the playhead                |
| **Duplicate** | `Ctrl+D` / `Cmd+D`             | Duplicate selected clip(s)                          |

### Timeline Navigation

- **Zoom**: Use the **+** / **−** zoom buttons in the timeline toolbar, or press `Ctrl+=` / `Ctrl+-` (`Cmd` on Mac).
- **Scroll**: The timeline scrolls horizontally with a scrollbar or trackpad swipe.
- **Seek**: Click anywhere on the timeline ruler to jump the playhead.
- **Snapping**: Clips snap to the playhead, other clip edges, and markers when moved.

### Track Management

- **Add Track**: Click the **+** button in the timeline header to add a video or audio track.
- **Remove Track**: Click the remove control in the track header.
- **Reorder**: Use the up/down controls in the track header.
- **Lock**: Lock a track to prevent accidental edits.
- **Visibility**: Toggle track visibility to hide it from preview/export.
- **Sync Lock**: When enabled, edits on other tracks preserve this track's sync relationship.

### Multi-Select

- **Click** a clip to select it.
- **Ctrl+Click** (or **Cmd+Click**) to add or remove clips from the selection.
- Operations like delete, move, copy, and duplicate work on all selected clips.

### Markers

Markers are reference points on the timeline:

- **Add Marker**: Click the marker add control at the playhead position.
- **Delete Marker**: Click the delete control on the marker.
- Markers appear on the timeline ruler and can be used as export range boundaries.

## Preview

The preview panel shows your video at the playhead position:

- **Safe Area Guides**: Toggle title/action safe areas with the **Safe areas** button.
- **Transform Gizmo**: When a video clip is selected, drag the gizmo handles to adjust position, scale, and rotation. Hold **Shift** to constrain proportions.
- **Adaptive Resolution**: Preview resolution adapts to your machine's performance — the current resolution is shown in the toolbar.

## Side Panel

The right sidebar hosts four tabs — **Inspector**, **Captions**, **Replay**, and **Audio** (Live Audio Chain) — with one panel visible at a time so each gets the full sidebar height, even on smaller laptop screens. The panel switches to Inspector automatically when you select a clip or transition, and to Captions after a caption import. Use the **›** button at the right end of the tab bar to collapse the whole sidebar (handy on small screens — the preview and timeline get the extra width) and the **‹** strip to bring it back; the choice is remembered between sessions.

## Inspector Panel

When you select a clip on the timeline, the **Inspector** (right sidebar) shows its properties:

### Video Clips

- **Transform**: Position (X/Y), scale, rotation, and opacity.
- **Fit Modes**: Fill, Fit, or Letterbox.
- **Effects**: Brightness, contrast, saturation, temperature, temperature strength, and LUT strength.
- **LUT**: Import a `.cube` color grading LUT and adjust its strength.

### Audio Clips

- **Track Mix**: Gain (volume), pan (left/right balance), mute, solo.
- **Fades**: Set fade-in and fade-out durations for smooth audio transitions.

### Keyframes

Most effect and transform parameters support keyframes for animated changes over time:

- Click the diamond icon next to a parameter to add a keyframe at the current playhead position.
- Move the playhead and adjust the value to create animation.
- Delete individual keyframes by clicking them in the keyframe track.

## Effects & Color

Effects are applied per-clip and processed in real-time on your GPU:

1. Select a clip on the timeline.
2. In the Inspector, adjust effect sliders under the **Effects** section.
3. Effects include: **Brightness**, **Contrast**, **Saturation**, **Temperature**, **Temp Strength**, and **LUT Strength**.

### LUT Import

Import a `.cube` LUT file for professional color grading:

1. Select a video clip.
2. In the Inspector, click **Import LUT** and choose a `.cube` file.
3. Adjust the **LUT Strength** slider to blend between the original and graded look.

### Skin Smoothing (Beauty)

An edge-preserving skin-smoothing effect that softens skin texture while preserving edges like hairlines, eyelids, and jaw lines. The effect uses a guided filter on luma, gated by a chroma-based skin-probability mask, so non-skin regions (text, foliage, fabric) are left untouched.

1. Select a video clip.
2. In the Inspector, adjust the **Skin Smoothing** slider (range 0–1, default 0). At 0 the effect is bypassed with zero GPU cost.
3. The effect is keyframable — use the diamond button to set keyframes at different times.
4. **A/B Bypass**: when strength > 0, an "A/B Bypass" toggle appears. This lets you compare before and after without losing your settings. Bypass affects preview only — export always uses the stored strength.
5. **Skin Mask (advanced)**: expand the "Skin mask (advanced)" disclosure to fine-tune the chroma mask parameters (`Cb min`, `Cb max`, `Cr min`, `Cr max`, `Softness`). These control which colors are classified as skin. The defaults work well for most skin tones. Use "Reset mask" to restore defaults.

**Tier requirement**: Skin smoothing requires the WebGPU effect chain (Accelerated or Compatibility-GPU tier). On tiers without WebGPU the slider is still visible but the effect has no impact on preview or export.

**Note**: This effect does not include face detection or geometry warps (face slimming, eye enlargement). Those features are planned for a future phase.

## Video Transitions

Add a transition between two adjacent clips on the same video track:

1. Split or arrange two clips so they share a cut point on the same track.
2. A **diamond** icon appears at the cut boundary — click it to select the transition.
3. In the Inspector, choose a **Kind** (Cross Dissolve, Dip to Black, Wipe, Slide) and adjust the **Duration** slider.
4. The duration slider maximum reflects how much source headroom each clip has on either side of the cut.
5. Click **Remove Transition** to delete it.

> **Compatibility note**: Video transitions require the full-performance (WebGPU) export path. If your browser uses the reduced-compatibility export path, transitions are skipped and a warning is shown in the export dialog. Switch to a Chromium-based browser with WebGPU support for full transition rendering.

## Titles & Text

Add title cards to your project:

1. Click **Add Title** in the timeline toolbar.
2. A title clip is created at the playhead position.
3. Select the title clip and use the Inspector to edit:
   - **Text**: The title content.
   - **Font Size**, **Color**, **Alignment**.
   - **Background**: Optional background with adjustable opacity.
   - **Outline**: Adjustable outline width and color around the text.
   - **Shadow**: Drop shadow with adjustable blur, X/Y offset, and color.

Title clips are rasterized at 1920×1080 and composited like any video clip — they support transforms, effects, and keyframes.

## Audio Mixing

LocalCut Studio includes a multi-track audio mixer:

- **Master Gain**: The master fader in the toolbar controls overall output volume. The meter strip shows real-time peak and RMS levels.
- **Track Gain/Pan**: Select an audio clip and use the Inspector to adjust per-track volume and stereo pan.
- **Mute/Solo**: Mute a track to silence it, or solo it to hear only that track.
- **Clip Fades**: Set fade-in and fade-out durations on individual audio clips for smooth transitions.
- **Waveforms**: Audio tracks display waveform visualizations for precise editing.

Audio runs through an AudioWorklet graph and is the master clock for A/V sync — video frames are dropped if they lag behind audio, never the reverse.

### Sample Rate Handling

When clips on the timeline use different audio sample rates (e.g. a 44.1 kHz MP3 alongside a 48 kHz video), the engine resamples all audio to the target output rate using a polyphase sinc filter. This happens transparently during both playback and export — no user action is needed. The source health panel shows a **Mixed audio sample rates** note as an informational reminder.

## Portrait Matte (Experimental)

Portrait Matte separates the foreground person from the background in video clips — "green screen without a green screen" — using an on-device, permissively licensed ML matting model (MODNet-class `.tflite`, Apache-2.0). The feature runs entirely in the browser on **LiteRT.js** (the same on-device ML runtime as Audio Cleanup and Auto Captions), using your GPU via WebGPU with no server-side processing. Do **not** deploy GPL-licensed model weights (e.g. RobustVideoMatting) at the model URL — this application is MIT-licensed and the project's licensing verdict on candidate models is recorded in the Phase 31 design document.

> Runs on this device. No upload. No API key. No server inference.

**How to use it**:

1. Select a video clip on the timeline and find **Portrait Matte** in the Inspector.
2. Check **Enable**. On first use the app fetches the model manifest from `/models/matte/manifest.json` (same-origin) and the checksum-verified model weights it references. Nothing is downloaded at app startup. Playback continues unmatted until the model is ready — it never stalls on a download.
3. Pick a **Mode**:
   - **Remove background** — the background becomes transparent, compositing over whatever is below.
   - **Replace background** — same as remove; place any timeline source (video, still, title) on the track directly below this clip and it shows through.
   - **Blur background** — the subject stays sharp while the background is defocused; adjust **Blur radius**.
4. Adjust **Strength** (0–100%) to blend between the original and matted image.

The matte is computed **in real time** on the GPU as frames play or export — there is no separate "compute the whole clip" step, no waiting, and exports always carry the matte. Seeking resets the temporal smoothing so the matte stays coherent after jumps.

**Requirements and limits**:

- Matting requires the accelerated (WebGPU) tier. A reduced non-WebGPU fallback is planned but not yet available.
- The `.tflite` model is **not bundled** with the app. If no model is deployed at the manifest URL, enabling the matte reports a model-unavailable status and the clip plays unchanged. There is no cloud fallback of any kind.
- The LiteRT WASM runtime is shared with Audio Cleanup and Auto Captions (served from `/litert/<build>/`), so no extra runtime needs deploying for the matte — only the model `.tflite` and its `manifest.json`.
- Disabling the matte drops the clip's temporal state and cached frames; re-enabling recomputes them.

## Local Audio Cleanup (Experimental)

LocalCut Studio can reduce background noise in audio clips entirely on your device using the DTLN model (Dual-Signal Transformation LSTM Network) running through LiteRT WASM inference. This feature is **experimental** and fully local:

> Runs on this device. No upload. No API key. No server inference.

**Requirements**: a browser with WebAssembly support (all modern browsers). In browsers without WebAssembly the panel shows "WebAssembly is required for local audio cleanup." and everything else in the editor works exactly as before — there is no cloud fallback of any kind.

**How to use it**:

1. Click **Audio Cleanup** in the toolbar to open the panel. Nothing is downloaded at app startup; the model loads only when you ask for it.
2. Click **Load model** to fetch and verify the two DTLN TFLite models (~4 MB total, downloaded from GitHub via a same-origin proxy and SHA-256-verified). After one successful load the models are cached in OPFS for offline use.
3. Select an audio clip on the timeline.
4. Click **Preview cleanup** to denoise the first 10 seconds and A/B compare **Play original** vs **Play cleaned**.
5. Click **Apply to export / create cleaned audio asset** to process the whole clip. This creates a derived `*.cleaned.wav` asset in the Media Bin and routes the clip's audio through it for both playback and export.
6. Use **Cancel** at any time to stop a running model load or cleanup pass.

**Notes**:

- Applying cleanup is a normal timeline edit: **undo/redo** works, and **Remove cleanup** in the panel returns the clip to its original audio at any time. The derived asset stays in the Media Bin.
- Export is unchanged unless you applied cleanup; only clips you explicitly cleaned use the denoised audio.
- If you later trim a cleaned clip beyond the range that was cleaned, the clip automatically falls back to its original audio (re-apply cleanup to cover the new range). If the cleaned asset goes missing (e.g. cleared storage), the original audio plays and a source-health warning appears.
- One cleanup pass is limited to 12 minutes of audio.
- The panel shows the WASM accelerator status, the model status and size, and the last analysis duration; the Capabilities panel has an **Audio cleanup (LiteRT DTLN)** row.

Model: DTLN (Nils L. Westhausen, Interspeech 2020 — MIT), from [breizhn/DTLN](https://github.com/breizhn/DTLN).

## Captions & Subtitles

Import, edit, and export caption tracks:

- **Import Captions**: Click **Import** in the Transcript panel to load SRT or VTT files.
- **Edit Text**: Click any caption segment to edit its text inline.
- **Adjust Timing**: Edit start/end times in the caption panel. Use **Snap start**, **Snap end**, or **Snap both** to align a segment edge to the playhead.
- **Split/Merge**: Split a segment at the playhead, or merge adjacent segments.
- **Delete**: Remove selected caption segments.
- **Style**: Set preset, font size, color, background, burn-in, and visibility per track. Individual segments can override color and background.
- **Export**: Export captions as SRT or VTT files.

### Auto Captions (experimental)

LocalCut Studio can transcribe a clip's audio into a caption track entirely on your device, using [OpenAI Whisper](https://github.com/openai/whisper) compiled by [LiteRT.js](https://www.npmjs.com/package/@litertjs/core). Like Audio Cleanup, it is **experimental** and fully local — no microphone, no app-audio capture, and no cloud API.

- **Choose a model**: The panel lists the available models with their provider, size, and a **Learn more** link to the model card. Today it ships **Whisper Base** (better accuracy, larger download) and **Whisper Tiny** (faster, smaller).
- **Load model**: Click **Load model**. The model downloads once from a trusted source, is checksum-verified, and is stored on your device (OPFS) so later loads are instant and work offline — the network is touched at most once. Nothing downloads until you click, and the panel tells you when a model loaded straight from the device cache.
- **Transcribe selected clip**: Select a clip on the timeline, optionally pick a language (Auto-detect / English / Chinese), and click **Transcribe selected clip**. The result becomes a normal, editable caption track positioned on the timeline where that clip lives.
- **Burn in when needed**: Generated ASR tracks start as editable sidecar captions. Turn on **Burn-in** in the Transcript panel when you want them overlaid in preview/export.
- **Transcribe timeline range**: The button is present in the panel, but timeline-range transcription is still disabled until mixed timeline audio extraction lands.
- **Cancel** stops a running model load or transcription; a selection with no speech does not create an empty track.

Model assets are fetched only from this app's own origin or a small allowlist of reputable hosts (Hugging Face, Kaggle / Google AI Edge, GitHub), and every file is verified against a published SHA-256 digest before use.

**Requirements**: a browser with WebAssembly (effectively every modern browser). When experimental WebNN is enabled, LiteRT requests WebNN with the JSPI runtime first; otherwise it tries WebGPU, then falls back to the WASM accelerator — the panel shows which one actually compiled. The transcription runs in a dedicated worker, so the editor stays responsive. The model itself is downloaded on demand from Hugging Face (digest-verified, then OPFS-cached); if it can't be reached, **Load model** fails gracefully and the rest of the editor works exactly as before — there is no cloud _processing_ of any kind, only the one-time model download. The panel shows the detected engine (LiteRT Whisper), model size and download progress, and the last transcription duration; the Capabilities panel has an **Auto Captions (ASR)** row.

Model: Whisper (MIT, OpenAI), compiled with LiteRT.js (Apache-2.0, Google) on WebNN, WebGPU, or the WASM accelerator.

## Caption Styles and Animation

Apply rich visual presets to caption tracks with glow effects, background pills,
and enter/exit animations. See [Caption Styles and Animation](CAPTION-STYLES.md)
for the full reference.

- **Preset Picker**: Select from 10+ built-in presets (subtitle, lower-third,
  neon-glow, karaoke, etc.) in the caption style inspector.
- **Import/Export Presets**: Import `.caption-preset.json` files to add custom
  presets, or export your favorites to share.
- **Animations**: Presets can include pop, bounce, slide, or typewriter enter/exit
  animations. Animations are applied at composite time — no re-rasterization per frame.
- **Karaoke**: The karaoke preset highlights the active word when per-word timing
  data is present (auto-populated by the Auto Captions ASR engine above).

## Replay Buffer

Continuously record a screen capture into a rolling buffer and save the last moments as a timeline clip — without interrupting the recording.

- **Start Capture**: Open the **Replay Buffer** panel in the right sidebar and click **Start Capture**. Your browser shows its screen-share picker; choose a tab, window, or screen. Capture begins immediately and the panel shows a red **Recording** indicator with the elapsed time.
- **Rolling buffer**: The newest 30 seconds (by default) are kept encoded in memory, oldest-first eviction. The fill bar shows how much of the buffer window is populated. Excess data beyond the memory budget spills to private browser storage (OPFS) automatically.
- **Save Last N Seconds**: Click **Save Last 30s** at any time. The buffered range is finalized into an MP4, added to the Media Bin, and appended to the timeline as a regular clip — capture keeps running while this happens. Saving is undoable like any other timeline edit.
- **Stop Capture**: Click **Stop Capture** (or use the browser's own "Stop sharing" control). The buffered media stays available for one final save until the next capture starts.
- **Requirements**: Replay Buffer needs a recent Chromium browser with `MediaStreamTrackProcessor` and screen-capture support. It works even when cross-origin isolation is unavailable; only the Live Audio Chain below needs isolation. When unsupported, the panel explains why and disables its controls.

Saved replay files are written to the app's private browser storage and registered like imported media. Buffer contents are discarded when a new capture session starts.

## Live Audio Chain

Process capture audio with a gate → compressor → limiter insert chain.

- **Inserts**: The **Live Audio Chain** panel (right sidebar) shows three insert rows — **Gate**, **Compressor**, and **Limiter** — each with a power toggle and expandable parameter sliders (threshold, ratio, attack/release, and so on). A **Noise Suppression** slot is visible but reserved for a future update.
- **Bypass**: Every insert defaults to bypassed. Bypassed inserts are a clean pass-through — they add no latency and do not alter the signal.
- **Print chain to recording**: During an active capture, enable this toggle to bake the chain into the recorded audio. Processing runs in the pipeline worker as frames are encoded, so recordings are processed reliably even when the tab is backgrounded or monitor audio is muted. In this version the chain applies to the **recording only** — monitor output (what you hear live) stays unprocessed.
- **Latency**: The panel header reports the chain's processing latency. The limiter's 5 ms lookahead is the only contributor; gate and compressor are zero-latency.
- **Requirements**: The Live Audio Chain requires cross-origin isolation (the same requirement as full-performance playback). Chain settings persist with the project.

## Exporting

### Direct Export

1. Click the **Export** button in the toolbar.
2. Configure your export settings:
   - **Codec**: H.264, VP9, or AV1 (depending on browser support).
   - **Container**: MP4 or WebM.
   - **Resolution**, **Frame Rate**, **Bitrate**.
   - **Range**: Full timeline, marked range, or custom in/out points.
3. Click **Start** and choose where to save the file.
4. The status bar shows progress. You can cancel at any time.

### Export Presets

Save your export settings as presets for reuse:

1. Configure settings in the export dialog.
2. Click **Save Preset**, give it a name.
3. Saved presets appear in the preset dropdown for quick access.

### Render Queue

Queue multiple export jobs to run sequentially:

1. In the export dialog, configure settings and click **Add to Queue** instead of **Start**.
2. The **Render Queue** panel appears below the timeline when jobs are queued.
3. Choose output destinations for pending jobs.
4. Click **Start** to process all jobs in order.
5. You can add jobs with different settings (codec, range, markers).

The queue supports per-job progress, retry on failure, and stop-on-error mode.

## Live Streaming

Broadcast the program output to a WHIP ingest endpoint (Twitch WHIP,
Cloudflare-class CDNs, or self-hosted MediaMTX) directly from the browser.
RTMP-only platforms (YouTube, Douyin, Bilibili) require a user-supplied
WHIP→RTMP gateway — browsers cannot open raw RTMP connections. Setup,
per-platform guidance, the reconnect policy, and the record+stream encoder
budget are covered in the [Live streaming guide](LIVE-STREAMING.md).

## Project Bundles

Bundle your project for portability or backup:

- **Export Bundle**: Packages your project file and copies all media into a single folder. Choose whether to relocate (move) or copy media files.
- **Import Bundle**: Open a previously exported bundle to restore a project with all its media.
- **Collect Media**: Gather all referenced media files into a single directory.

Access bundle operations from the toolbar menu next to the Export button. The integrity report verifies all files are present and intact.

Exported bundles also include a `project.otio` interchange file at the bundle root (see below); `project.json` remains the authoritative project document.

## Timeline Interchange (OTIO / EDL)

Send your cut to another editor with the **Interchange** toolbar menu. It works on every capability tier — the only requirement is a non-empty timeline.

- **Export Timeline (.otio)**: An [OpenTimelineIO](https://opentimeline.io/) file with your tracks, clips, gaps, markers, and transitions, frame-snapped at the project rate. Kdenlive 25.04+ and DaVinci Resolve (File → Import → Timeline) open it directly. Media is referenced by file name — or by bundle-relative path inside an exported project bundle — never embedded.
- **Export EDL (.edl)**: A cuts-only CMX3600 edit decision list for one video track (pick the track when you have several). Transitions become straight cuts, audio and other tracks are omitted, and fractional frame rates are rounded to the nearest whole rate with a note in the file. Record timecode starts at `01:00:00:00`.

What other applications see is the _cut_: clip placement, timing, markers, and dissolves. LocalCut-specific data — effects, looks/LUTs, keyframes, transforms, caption styling, track mix state — travels inside a `metadata.localcut` namespace that foreign tools ignore; it is preserved for a future re-import into LocalCut, not translated into other applications' effects.

Export warnings (for example, clips shorter than one frame at the sequence rate, or EDL omissions) are listed in the Interchange menu after each export; they never block the save.

### AAF and FCPXML via otioconvert

LocalCut does not generate AAF or Final Cut Pro XML in the browser. Instead, convert the exported `.otio` with the OpenTimelineIO command-line tools:

```bash
pip install opentimelineio otio-fcpx-xml-adapter  # FCPXML adapter
otioconvert -i project.otio -o project.fcpxml

pip install otio-aaf-adapter                      # AAF adapter
otioconvert -i project.otio -o project.aaf
```

See the [OpenTimelineIO adapter list](https://github.com/OpenTimelineIO/OpenTimelineIO#adapters) for other targets.

## Project Persistence

Your project is automatically saved to your browser's local storage:

- **Autosave**: Changes are saved continuously as you edit.
- **Restore**: If you close and reopen the app, you'll be prompted to restore your last session.
- **Undo/Redo**: Full undo history is preserved during your session.

### Re-linking Media

If source files are moved or renamed, they appear as "offline" with a re-link prompt. Click **Re-link** next to any offline source and select the file at its new location.

## Diagnostics & Recovery

### Diagnostics Panel

Click **Diagnostics** in the status bar to view:

- **Capability Summary**: What your browser supports and what's missing.
- **GPU + Codecs**: WebGPU device status, decode/encode support.
- **Storage + Cache**: Disk usage, quota, OPFS and cache availability.
- **Performance Budgets**: Runtime metrics like decode queue depth and frame drops.
- **Recent Errors**: A log of recent issues with codes and recovery suggestions.
- **Actions**: Recovery actions like restarting the pipeline worker or retrying audio initialization.

### Crash Recovery

If the pipeline worker crashes:

1. The editor shell stays alive — no data is lost.
2. The worker restarts automatically (up to a throttled limit).
3. Your timeline state is restored from the last autosave.
4. If restarts are exhausted, reload the page to recover.

### Offline Support

LocalCut Studio is a Progressive Web App. After the first visit:

- The app works fully offline.
- Imported media stays on your machine (not uploaded).
- Export works without internet.

## Help

Click **Help** in the toolbar (or browse to `/docs`) to open the in-app User Guide — a set of user-facing pages covering getting started, importing, timeline editing, exporting, live streaming, browser limitations, performance, troubleshooting, and an FAQ. Sections are in-app routes (`/docs/getting-started`, `/docs/exporting`, …) so they can be deep-linked, and **Back to editor** returns to the editor exactly as you left it. The guide's source lives in `src/features/docs/content/` and is bundled with the app, so it works offline.

## Keyboard Shortcuts Reference

### Transport

| Key | Action                  |
| --- | ----------------------- |
| `J` | Step backward one frame |
| `K` | Pause                   |
| `L` | Play                    |

### Editing

| Key                            | Action                          |
| ------------------------------ | ------------------------------- |
| `S`                            | Split selected clip at playhead |
| `Delete` / `Backspace`         | Delete selected clip(s)         |
| `Ctrl+Z` / `Cmd+Z`             | Undo                            |
| `Ctrl+Shift+Z` / `Cmd+Shift+Z` | Redo                            |
| `Ctrl+Y`                       | Redo (alternative)              |
| `Ctrl+C` / `Cmd+C`             | Copy selected clip(s)           |
| `Ctrl+V` / `Cmd+V`             | Paste copied clip(s)            |
| `Ctrl+D` / `Cmd+D`             | Duplicate selected clip(s)      |
| `Ctrl+=` / `Cmd+=`             | Zoom timeline in                |
| `Ctrl+-` / `Cmd+-`             | Zoom timeline out               |
| `Escape`                       | Close open dialog               |
