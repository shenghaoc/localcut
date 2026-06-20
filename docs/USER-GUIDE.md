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

The status bar at the bottom shows your current tier. Open **Help → Browser capabilities** for details about what your browser supports and what's missing.

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

| Button | Action                                                                                                                                                                                                                                                                        |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ⓘ**  | Open the **Media Details** popover — full filename, resolution, frame rate (with a _variable_ badge for VFR sources), rotation metadata, video/audio codecs, channel layout, sample rate, duration, file size, handled media notes, and any actionable source-health warning. |
| **+**  | Place the clip on the timeline.                                                                                                                                                                                                                                               |
| **🗑** | Remove the entry from the bin.                                                                                                                                                                                                                                                |

The bin row stays compact so the left dock remains usable at narrow widths. Hover the row for a native tooltip with handled media notes and proxy recommendations; open Media Details for the same information without row truncation.

### Source Health Warnings

Supported media characteristics like variable frame rate, rotation metadata, audio/video start offsets, and mixed audio sample rates are handled by the engine and shown as metadata when useful. They do not appear as source-health warnings.

Visible source-health warnings are reserved for actionable problems:

- **Unsupported audio/video codec** — the message names the codec (e.g. `(ac-3)` or `(unknown codec)` when the container does not advertise one). If the **primary** track uses an unsupported codec the clip cannot decode; secondary tracks are silently skipped.
- **Corrupt or missing-duration media** — the file could not be inspected well enough to build a reliable timeline item.
- **Unsupported container variants** — for example, `.lottie` zip containers are rejected; export plain `.json` from your Lottie tool.
- **Missing generated assets** — for example, if a cleaned-audio asset was cleared from storage, the original audio plays and the warning explains what needs to be regenerated.

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
- **Scopes (Experimental)**: On WebGPU-backed preview tiers, expand **Scopes** in the lower-right of the preview to inspect the histogram, luma waveform, RGB parade, and vectorscope. The panel stays collapsed by default and updates at a reduced rate so playback remains responsive. If clipped pixels are detected, an amber or red badge appears in the scope header.

Scopes are unavailable in Limited WebCodecs and Shell Only tiers because those modes do not have the WebGPU renderer that produces the scope summaries.

## Side Panel

The right sidebar hosts four job tabs — **Inspector**, **Text**, **Audio**, and **Capture** — with one destination visible at a time so each gets the full sidebar height, even on smaller laptop screens. **Text** contains Captions and, when Chrome's built-in AI APIs are available, Language Tools. **Audio** contains Live Chain and Voice FX. **Capture** contains Record, Program, Replay, and Go Live. The panel switches to Inspector automatically when you select a clip or transition, and to **Text > Captions** after a caption import. Use the **›** button at the right end of the tab bar to collapse the whole sidebar (handy on small screens — the preview and timeline get the extra width) and the **‹** strip to bring it back; the choice is remembered between sessions.

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

### Speed Ramps

Speed ramps let you vary the playback speed of a clip over time -- slow-motion, fast-motion, or a smooth ramp between the two. The speed ramp is applied per-clip and affects both video and audio.

1. Select a video or audio clip on the timeline. Title clips do not support speed ramps.
2. In the Inspector, find the **Speed** section.
3. Click **Add Ramp**. This creates a ramp with two keyframes at normal speed (1x).
4. Adjust keyframe speeds and easing in the speed ramp editor. Speeds range from **0.25x** (4x slower) to **4x** (4x faster).
5. The clip's timeline duration updates automatically to match the ramp -- slowing a clip down makes it longer, speeding it up makes it shorter.

**Pitch Preserve**: When enabled (the default), audio is time-stretched using WSOLA to keep speech and music at their natural pitch. When disabled, audio is resampled directly, which changes the pitch along with the speed.

**Clear Ramp**: Click **Clear Ramp** in the Speed section to remove the speed ramp and restore the clip to its original duration and playback speed.

For the technical details -- easing types, the LUT-based curve evaluation, WSOLA parameters, and why reverse playback is not supported -- see [Time Remapping](TIME-REMAPPING.md).

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

## Screencast Post Pack

The Screencast Post Pack adds four accelerated tools for tutorial and software walkthrough edits. Select a video clip to use **Zoom-n-Pan**, **Auto-Zoom**, and **Padded Background** in the Inspector; use the toolbar **Callout** tool to place arrow, box, step, spotlight, or blur-region callout clips at the playhead.

- **Zoom-n-Pan** writes normal transform keyframes, so every generated zoom can be edited in the existing keyframe workflow.
- **Auto-Zoom** reads an own-tab capture event log and proposes zooms around click and scroll clusters. Auto-Zoom requires recording with the Own Tab option — event logs are not available for window or display captures.
- **Callouts** are source-less timeline clips that trim, move, split, serialize, and export like other overlay clips. Spotlight and blur-region callouts run as GPU passes in the compositor.
- **Padded Background** renders a solid or gradient background behind a rounded, inset version of the selected clip with a shadow.

See [Screencast Guide](SCREENCAST-GUIDE.md) for step-by-step walkthroughs.

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

## Beat Detection

LocalCut can analyse any imported audio source to detect its tempo and beat positions. The analysis runs entirely on your device in the pipeline worker — no audio is uploaded, and no server is involved.

### How to use it

1. Import an audio source (MP3, AAC, WAV, etc.) into the Media Bin.
2. Open the **Beat Detection** panel below the Media Bin.
3. Click **Analyse** next to the audio source. A progress bar shows the analysis status.
4. Once complete, the detected tempo (BPM) and beat count are displayed.
5. Click **On** to enable the beat grid display on the timeline ruler. Beat ticks appear in purple (`#b06cff`); the first beat of each bar is taller.

### Beat grid controls

- **Offset nudge** (–500 ms to +500 ms): shifts all displayed beat times forward or backward in time. Use this to align the beat grid with the actual musical beats if the detected grid is slightly off.
- **Snap to beats**: enable **Snap**, then toggle the **Beat** button in the top chrome or timeline toolbar to include beat positions in the snap target set. When enabled, dragging clip edges or playhead snaps to the nearest beat.
- **Auto-cut**: select one or more clips on the timeline, then click **Split** or **Align** in the Beat Detection panel:
  - **Split mode**: splits each selected clip at every beat time that falls inside its span. Segments shorter than 0.2 seconds are skipped to avoid creating uneditable slivers.
  - **Align mode**: moves each selected clip's start to the nearest beat time. Selected clips are sorted chronologically before alignment so that overlap-skip decisions are deterministic — if two clips on the same track would overlap after alignment, the later clip is left in place. Selected clips on locked tracks are skipped with a diagnostics finding. Linked A/V partners are moved together so audio and video stay in sync.

### WASM acceleration

The beat analysis uses a WASM SIMD-accelerated FFT when available for faster analysis. If WASM SIMD is not supported by your browser, a pure JavaScript fallback is used transparently — the results are the same on the same platform. The Capabilities panel shows the WASM status.

### Technical notes

- Analysis supports tempo detection in the range 60–200 BPM.
- Beat times are derived from the analysis and are not stored as editable markers. They do not appear in the export markers range selector.
- Analysis results are cached per source fingerprint in OPFS. Re-importing the same audio file in the same browser profile does not require re-analysis.
- Beat-grid settings (enabled sources + global offset) ride in the project autosave/restore.
- When you export a project bundle (Phase 23), the OPFS beat cache is embedded under `cache/beats/`; importing the bundle on another machine restores the cache so analysis does not re-run.
- Silent or near-silent audio is detected before grid generation and produces an empty beat list rather than a spurious dense grid.

## Portrait Matte (Experimental)

Portrait Matte separates the foreground person from the background in video clips — "green screen without a green screen" — using an on-device, permissively licensed ONNX matting model. The shipped model is **MODNet** (`onnx-community/modnet-webnn`, Apache-2.0), run by ONNX Runtime Web on WebGPU. The alpha matte is smoothed over time for stability and stays fully local: no frame, mask, or model input is uploaded.

> Runs on this device. No upload. No API key. No server inference.

**How to use it**:

1. Select a video clip on the timeline and find **Portrait Matte** in the Inspector.
2. Check **Enable**. On first use the app fetches the model manifest from `/models/matte-onnx/manifest.json` (same-origin) and the checksum-verified model weights it references. Nothing is downloaded at app startup. Playback continues unmatted until the model is ready — it never stalls on a download.
3. Pick a **Mode**:
   - **Remove background** — the background becomes transparent, compositing over whatever is below.
   - **Replace background** — same as remove; place any timeline source (video, still, title) on the track directly below this clip and it shows through.
   - **Blur background** — the subject stays sharp while the background is defocused; adjust **Blur radius**.
4. Adjust **Strength** (0–100%) to blend between the original and matted image.

The matte is computed **in real time** on the GPU as frames play or export — there is no separate "compute the whole clip" step, no waiting, and exports always carry the matte. Seeking resets the temporal smoothing so the matte stays coherent after jumps.

**Requirements and limits**:

- Matting requires the accelerated (WebGPU) tier. A reduced non-WebGPU fallback is planned but not yet available.
- The ONNX model is fetched on demand through the same-origin model proxy, verified by SHA-256, and cached in OPFS. If the model cannot be fetched or verified, enabling the matte reports a model-unavailable status and the clip plays unchanged. There is no cloud fallback of any kind.
- The ORT runtime is loaded lazily through the version-pinned `/_ort/` proxy; it is never part of the startup bundle.
- Disabling the matte drops the clip's temporal state and cached frames; re-enabling recomputes them.

## Local Audio Cleanup (Experimental)

LocalCut Studio can reduce background noise in audio clips entirely on your device using the DTLN model (Dual-Signal Transformation LSTM Network). The feature uses **ONNX Runtime DTLN** on the WASM execution provider; the ONNX runtime is fetched on demand and never ships in the app's startup bundle. This feature is **experimental** and fully local:

> Runs on this device. No upload. No API key. No server inference.

**Requirements**: a browser with WebAssembly support (all modern browsers). ONNX Runtime DTLN runs on the WASM accelerator. In browsers without WebAssembly the panel shows "WebAssembly is required for local audio cleanup." and everything else in the editor works exactly as before — there is no cloud fallback of any kind.

**How to use it**:

1. Select an audio clip on the timeline. (The **Audio Cleanup** command is disabled until an audio clip is selected, so do this first.)
2. Open the command palette (**⌘K** / **Ctrl+K**) and choose **Audio Cleanup** to open the panel. Nothing is downloaded at app startup; the model loads only when you ask for it.
3. Click **Load model** to fetch and verify the two DTLN ONNX model files (~4 MB total, downloaded from GitHub via a same-origin proxy and SHA-256-verified). After one successful load the models are cached in OPFS for offline use.
4. Click **Preview cleanup** to denoise the first 10 seconds and A/B compare **Play original** vs **Play cleaned**.
5. Click **Apply to export / create cleaned audio asset** to process the whole clip. This creates a derived `*.cleaned.wav` asset in the Media Bin and routes the clip's audio through it for both playback and export.
6. Use **Cancel** at any time to stop a running model load or cleanup pass.

**Notes**:

- Applying cleanup is a normal timeline edit: **undo/redo** works, and **Remove cleanup** in the panel returns the clip to its original audio at any time. The derived asset stays in the Media Bin.
- Export is unchanged unless you applied cleanup; only clips you explicitly cleaned use the denoised audio.
- If you later trim a cleaned clip beyond the range that was cleaned, the clip automatically falls back to its original audio (re-apply cleanup to cover the new range). If the cleaned asset goes missing (e.g. cleared storage), the original audio plays and a source-health warning appears.
- One cleanup pass is limited to 12 minutes of audio.
- The panel shows the selected engine, the accelerator that actually loaded (`wasm`), the model status and size, and the last analysis duration; the Capabilities panel has an **Audio cleanup (DTLN)** row.

Model: DTLN (Nils L. Westhausen, Interspeech 2020 — MIT), from [breizhn/DTLN](https://github.com/breizhn/DTLN).

## Voice Cleanup

Voice Cleanup provides everyday audio-quality tools that work in every browser without WebNN or a cloud service. Open the **Voice Cleanup** panel from the mixer/inspector area.

### Denoiser

The WASM RNNoise denoiser runs on the monitor bus (live during editing) and in the export chain. It targets broadband stationary noise (fan hum, room tone, hiss) and is designed for speech.

- **Enable per track**: check the tracks you want denoised. The denoiser runs on each track's audio individually before mixing, so music and sound effects on un-checked tracks are unaffected.
- **Bypass A/B**: toggle the denoiser off to compare. A 10 ms crossfade prevents clicks.
- **Positioning vs Phase 28 cleanup**: Phase 28 (WebNN) produces a permanent cleaned-audio asset per clip — use it for surgical, per-clip cleanup. Phase 36 denoises the monitor and export buses in real time — use it for everyday recording cleanup without a processing step.

### Loudness Normalisation

Measures the integrated loudness of your project (EBU R128 / ITU-R BS.1770-4) and applies a static makeup-gain correction.

1. Select a target: **−14 LUFS** (streaming), **−16 LUFS** (podcast), **−23 LUFS** (broadcast), or enter a custom value.
2. Click **Analyse & Normalise**. The analysis runs in the background; progress is shown as a fraction.
3. Review the measured loudness and proposed correction, then click **Apply** to confirm.
4. Use **Reset** to remove the correction at any time. Normalisation is undoable.

A limiter on the master bus enforces a true-peak ceiling (default −1 dBTP) after the gain correction.

### Gate

A noise gate on the master bus. Attenuates audio below the threshold.

- **Threshold** (default −40 dB): signal level below which the gate closes.
- **Range** (default −80 dB): amount of attenuation when the gate is closed.
- **Attack / Hold / Release**: timing controls for the gate envelope.
- Recommended starting point for voice-over: threshold −40 dB, hold 20 ms, release 50 ms.

### Limiter

A brickwall lookahead limiter on the master bus. Prevents peaks from exceeding the ceiling.

- **Ceiling** (default −1 dBTP): maximum true-peak level.
- **Attack / Release**: timing controls.
- The limiter adds 5 ms of latency to the monitor path (lookahead).

### Latency Budget

With all inserts active at 48 kHz / 128-sample quantum:

| Stage                | Latency        |
| -------------------- | -------------- |
| AudioWorklet quantum | 2.67 ms        |
| Denoiser ring        | 10.00 ms       |
| Limiter lookahead    | 5.00 ms        |
| **Total**            | **≈ 17.67 ms** |

When all inserts are bypassed, latency is 0 ms (pass-through).

## Captions & Subtitles

Import, edit, and export caption tracks:

- **Import Captions**: Open **Text > Captions** and click **Import** in the Transcript panel to load SRT or VTT files.
- **Edit Text**: Click any caption segment to edit its text inline.
- **Adjust Timing**: Edit start/end times in the caption panel. Use **Snap start**, **Snap end**, or **Snap both** to align a segment edge to the playhead.
- **Split/Merge**: Split a segment at the playhead, or merge adjacent segments.
- **Delete**: Remove selected caption segments.
- **Style**: Set preset, font size, color, background, burn-in, and visibility per track. Individual segments can override color and background.
- **Export**: Export captions as SRT or VTT files.

### Auto Captions (experimental)

LocalCut Studio can transcribe a clip's audio into a caption track entirely on your device, using [OpenAI Whisper](https://github.com/openai/whisper) run by [ONNX Runtime Web](https://onnxruntime.ai/docs/get-started/with-javascript/web.html). Like Audio Cleanup, it is **experimental** and fully local — no microphone, no app-audio capture, and no cloud API.

- **Choose a model**: The panel lists the available models with their provider, size, and a **Learn more** link to the model card. The default is **Whisper Base (ONNX, int8)** — an int8-quantized model that downloads in ~77 MB. **Whisper Tiny (ONNX, int8)** is smaller still (~41 MB) and faster.
- **Load model**: Click **Load model**. The model downloads once from a trusted source, is checksum-verified, and is stored on your device (OPFS) so later loads are instant and work offline — the network is touched at most once. Nothing downloads until you click, and the panel tells you when a model loaded straight from the device cache.
- **Transcribe selected clip**: Select a clip on the timeline, optionally pick a language (Auto-detect / English / Chinese), and click **Transcribe selected clip**. The result becomes a normal, editable caption track positioned on the timeline where that clip lives.
- **Burn in when needed**: Generated ASR tracks start as editable sidecar captions. Turn on **Burn-in** in the Transcript panel when you want them overlaid in preview/export.
- **Transcribe timeline range**: The button is present in the panel, but timeline-range transcription is still disabled until mixed timeline audio extraction lands.
- **Cancel** stops a running model load or transcription; a selection with no speech does not create an empty track.

Model assets are fetched only from this app's own origin or a small allowlist of reputable hosts (Hugging Face, Kaggle / Google AI Edge, GitHub), and every file is verified against a published SHA-256 digest before use.

**Requirements**: a browser with WebAssembly (effectively every modern browser). The ONNX models run on ONNX Runtime Web's WASM execution provider; the panel shows the detected engine and accelerator. The transcription runs in a dedicated worker, so the editor stays responsive. The model itself is downloaded on demand from Hugging Face (digest-verified, then OPFS-cached); if it can't be reached, **Load model** fails gracefully and the rest of the editor works exactly as before — there is no cloud _processing_ of any kind, only the one-time model download. The panel also shows model size and download progress and the last transcription duration; the Capabilities panel has an **Auto Captions (ASR)** row.

Model: Whisper (MIT, OpenAI), run on-device by ONNX Runtime Web (Apache-2.0, Microsoft) on WASM.

## Caption Styles and Animation

Apply rich visual presets to caption tracks with glow effects, background pills,
and enter/exit animations. See [Caption Styles and Animation](CAPTION-STYLES.md)
for the full reference.

- **Preset Picker**: Select from 10+ built-in presets (subtitle, lower-third,
  neon-glow, karaoke, screencast, etc.) in the caption style inspector.
- **Screencast Preset**: High-contrast monospace text (`Courier New`) on a dark
  background, optimized for on-screen code and terminal recordings.
- **Import/Export Presets**: Import `.caption-preset.json` files to add custom
  presets, or export your favorites to share.
- **Animations**: Presets can include pop, bounce, slide, or typewriter enter/exit
  animations. Animations are applied at composite time — no re-rasterization per frame.
- **Karaoke**: The karaoke preset highlights the active word when per-word timing
  data is present (auto-populated by the Auto Captions ASR engine above).

## Silence Detection (Phase 44)

Detect silent regions in your audio tracks and remove them with a single click. This is especially useful for screencasts and tutorials where dead air accumulates between spoken segments.

### How to Use

1. **Select audio tracks** on the timeline (the button is disabled when no audio tracks are selected).
2. Open the **Silence Review Panel** from the Edit menu or audio track header.
3. **Tune parameters** (collapsible):
   - **Open threshold** (−60 to −20 dBFS, default −42): RMS below this opens a silence region.
   - **Close threshold** (−60 to −20 dBFS, default −36): RMS above this closes a silence region.
   - **Min silence** (0.1 to 10 s, default 0.6): Minimum consecutive silence duration to keep.
   - **Keep padding** (0 to 1.0 s, default 0.15): Inward contraction on each side of detected regions.
   - **Min kept segment** (0.1 to 2.0 s, default 0.3): Adjacent regions whose gap is shorter than this are merged.
4. Click **Detect Silence**. A progress bar shows analysis progress.
5. **Review results**: each region shows start time, end time, duration, and peak dB.
   - **Apply**: removes the region via ripple delete (one undo step per region).
   - **Skip**: dims the row; skipped regions are not removed.
   - **Apply All**: applies all non-skipped regions.
6. **Undo**: use Ctrl+Z / Cmd+Z to undo applied cuts individually.

> Detection runs entirely in the pipeline worker — no audio data leaves your device. The same audio + same parameters always produce identical results.

## Keystroke Overlay (Phase 44 + Phase 41)

Generate title clips that display keyboard shortcuts as rounded-rect keycap pills on the timeline. Two paths feed the overlay:

- **Capture-session sidecar** (Phase 41). Every Record session automatically writes shortcut events to an `events.ndjson` sidecar alongside the recorded media. After the session lands, open the Keystroke Overlay panel and press **Load events from last recording** to pull events from the sidecar without re-enacting the tutorial.
- **Manual recording** (Phase 44 fallback). Open the panel, tick the consent box, press **Start recording**, and the panel listens to keydown events on the active tab until you press **Stop**.

### Loading events from a capture session

1. Use **Capture > Record** to capture a screen/webcam session.
2. After the session lands, open **Keystroke Overlay**.
3. The panel shows a prompt: _"A capture session landed. Load events from last recording."_ The button stays disabled until the writer worker has flushed and closed the sidecar (typically <1 second).
4. Press **Load events from last recording**. The entries list populates from the sidecar.
5. Press **Insert overlay clips** to add the clips to the timeline.

When the session was a **retake** of an existing clip, the overlay clips land at the retake clip's timeline position, not at `t = 0`.

While a capture session is **actively recording**, manual recording in the panel is disabled and any in-progress manual recording is stopped automatically — the capture session is already logging shortcuts via its DOM tap, and two listeners would double-record everything.

### Manual recording (no capture session)

1. Open **Keystroke Overlay** from the toolbar.
2. Tick **I understand and want to record shortcuts**.
3. Press **Start recording**. The panel listens to keydown events globally while focus is anywhere outside form fields.
4. Use your tool as you normally would for the tutorial.
5. Press **Stop recording**, then **Insert overlay clips**.

### What's captured

Both paths apply the same `shouldRecordKey` gate:

- **Captured**: modifier combos (`Ctrl+S`, `Alt+Tab`, `Cmd+Shift+Z`), navigation keys (`Escape`, arrows, `PageUp`), function keys (`F5`, `F12`). The capture-session sidecar also records pointer-down/-up coordinates with held modifiers.
- **Not captured**: any keystroke in an `<input>`, `<textarea>`, `<select>`, `[contenteditable]`, or `type="password"` field; bare printable characters (including `Shift+letter` capitalised text); events in cross-origin iframes the editor cannot read.

The sidecar lives in browser-local storage (OPFS) alongside the recorded media — it never leaves your machine and is removed together with the session if you discard or import the recording.

### Overlay clip layout

Title clips are created on the topmost video track. Each clip displays a keycap pill (monospace font, dark background, white outline) for 1.2 seconds. Key events less than 300 ms apart are merged into a single clip (combos joined with `·`); the merge is also capped at 4 combos or 1 second of span so a rapid run never collapses into one giant clip. Edit or delete overlay clips like any other title clip.

## YouTube Chapters (Phase 44)

Export YouTube-compatible chapter markers from your timeline.

### How to Add Markers

1. Position the playhead where you want a chapter.
2. Add a marker and give it a non-empty label.
3. Repeat for at least 3 chapters (YouTube's minimum).

### Rules

- **Auto-Intro**: if no marker exists at time 0, an "Intro" chapter is automatically inserted at 00:00:00.
- **Minimum 3 chapters** (including auto-Intro).
- **10-second spacing** between adjacent chapters.
- Markers with empty labels are ignored.

### Exporting

1. Open the **Export** dialog.
2. Expand the **YouTube Chapters** section.
3. If validation passes, the chapter text is displayed. Click:
   - **Copy to Clipboard**: copies the chapter text for pasting into a video description.
   - **Save .chapters.txt**: saves the chapter text file and a `.chapters.json` sidecar.
4. If validation fails, the error message explains what to fix.

> Note: MP4 container chapter metadata is not yet supported (Mediabunny has no chapter API). The sidecar files are the production path.

## Smart Reframe (Experimental)

Automatically generate a crop path when converting a clip between aspect ratios (for example 16:9 → 9:16), keeping the main subject in frame. This feature is **experimental** and fully local:

> Runs on this device. No upload. No API key. No server inference.

The output is ordinary, **editable transform keyframes** — never a baked-in crop. After applying, you can edit, delete, or extend any of them in the Inspector, and one undo removes the whole reframe.

**How to use it**:

1. Select a video clip on the timeline, then open the command palette (**⌘K** / **Ctrl+K**) and choose **Smart Reframe**.
2. Choose a **target aspect ratio** (9:16, 1:1, 4:5, 16:9, or 4:3).
3. Click **Analyse**. A dedicated worker scans the clip (cancel any time). When it finishes, the program monitor shows a preview overlay of the proposed crop and its action-safe zone at the playhead.
4. **Apply** writes the keyframes, **Discard** throws the result away, and **Adjust** exposes the velocity/acceleration bounds for a re-analysis.

**Notes**:

- Subject detection defaults to **visual saliency** (skin tone, edges, local contrast — pure DSP, always available). For face-aware reframing, click **Load face model** in the panel — the same click-to-load pattern as Audio Cleanup and Auto Captions. The shipped detector is UltraFace RFB-320 on ONNX Runtime Web, catalog-pinned in `public/models/reframe-face/manifest.json`, loaded through the same-origin `/_model/gh/` proxy, SHA-256 verified, and cached locally. Analysis runs entirely on-device, nothing is uploaded, and it tracks faces while falling back to saliency for frames with none. If the model cannot load, Smart Reframe remains saliency-only. The Capabilities panel shows a **Smart Reframe** row.
- Pan velocity and acceleration are bounded so generated motion never whips; the subject may briefly leave centre during fast moves. The panel reports safe-zone compliance.
- Shot boundaries (hard cuts) are detected and reset tracking so the crop does not slide across an edit.
- Limitations: one subject per clip, faces/saliency only (no object-class tracking), no automatic cutting, and offline only (no live-camera reframe).

Full details are in the [Smart Reframe guide](SMART-REFRAME.md).

## On-Device Language Tools (Chrome only)

An optional bonus built on Chrome's built-in AI. It runs **entirely on-device** — nothing is
uploaded, and there is **no cloud fallback**. On browsers that don't expose these APIs (Firefox,
Safari, most Chromium derivatives, or hardware below Chrome's floor), the **Text > Language Tools** tab and the **Language Tools** command
(in the ⌘K palette) do not appear and nothing else changes. See [Language tools](../src/features/docs/content/language-tools.md)
for the in-app guide.

- **Requirements**: recent desktop Chrome with the built-in AI models. Each tool needs a one-time,
  Chrome-managed model download (translation packs are tens of MB; drafting uses Gemini Nano, a
  multi-GB model Chrome downloads once and shares across sites). Download progress is shown the
  first time; after that the tools work offline. We never host or cache these models — Chrome does.
- **Translate captions**: pick a caption track and a target (Auto-detect / English / Chinese) to
  produce a **second, timing-identical** caption track (each cue is translated individually, so
  `start`/`duration` are preserved exactly). Export the source and translated tracks as separate
  SRT/VTT sidecars for bilingual subtitles.
- **Draft (titles / hashtags / 文案)**: turn a track's transcript into copyable title options,
  hashtags, and a short social caption. Output is **read-only and never written into your
  project** — copy what you want.
- **Privacy**: all translation and drafting stay on your device. No captions, transcripts, or
  media leave the browser, and there is no cloud API.

## Recording

Open **Capture > Record** to capture screen, camera, microphone, and tab/system audio as editable timeline sources. Recording stays local to the browser and writes active-session chunks to private browser storage.

- **Countdown**: choose **0 s**, **3 s**, or **5 s** before starting. Press **Cancel** or **Escape** during the countdown to return to idle.
- **Pause / Resume**: pausing drains the active encoders. When the session lands, paused gaps are collapsed and timeline markers named **Resume 1**, **Resume 2**, and so on show where the removed gaps were.
- **Webcam layout**: choose a corner, S/M/L size, and margin for webcam picture-in-picture placement. The preview tile updates immediately, but the preset is applied when the recording lands as normal transform values.
- **Recorder strip**: Chromium can show pause/resume/stop controls in a Document Picture-in-Picture window. When Document PiP is unavailable, the same controls remain visible in an in-page floating strip.
- **Region / Element Capture**: experimental Chromium-only options for own-tab captures. Region crops to an element's bounds; Element restricts capture to the selected element. Add a tab source before using either option.
- **Retake**: captured clips expose a **Retake** action in the Inspector. Retake mode lists the fresh source kinds needed to match the original recording, then starts the countdown once they are present. A retake replaces that clip's source and duration while preserving its clip id, transform, and keyframes. Undo restores the previous clip, and the old recording remains in the media bin.

| Capability            | Chrome / Chromium                                                               | Safari / Firefox                |
| --------------------- | ------------------------------------------------------------------------------- | ------------------------------- |
| Recording panel       | Enabled when all capture probes pass; otherwise disabled with per-probe reasons | Disabled with per-probe reasons |
| Document PiP controls | Chromium-only when `documentPictureInPicture` is available                      | In-page fallback                |
| Region Capture        | Experimental Chromium-only                                                      | Unavailable                     |
| Element Capture       | Experimental Chromium-only                                                      | Unavailable                     |

See the full [Recording guide](RECORDING.md) for details.

## Replay Buffer

Continuously record a screen capture into a rolling buffer and save the last moments as a timeline clip — without interrupting the recording.

- **Start Capture**: Open **Capture > Replay** and click **Start Capture**. Your browser shows its screen-share picker; choose a tab, window, or screen. Capture begins immediately and the panel shows a red **Recording** indicator with the elapsed time.
- **Rolling buffer**: The newest 30 seconds (by default) are kept encoded in memory, oldest-first eviction. The fill bar shows how much of the buffer window is populated. Excess data beyond the memory budget spills to private browser storage (OPFS) automatically.
- **Save Last N Seconds**: Click **Save Last 30s** at any time. The buffered range is finalized into an MP4, added to the Media Bin, and appended to the timeline as a regular clip — capture keeps running while this happens. Saving is undoable like any other timeline edit.
- **Stop Capture**: Click **Stop Capture** (or use the browser's own "Stop sharing" control). The buffered media stays available for one final save until the next capture starts.
- **Requirements**: Replay Buffer needs a recent Chromium browser with `MediaStreamTrackProcessor` and screen-capture support. It works even when cross-origin isolation is unavailable; only the Live Audio Chain below needs isolation. When unsupported, the panel explains why and disables its controls.

Saved replay files are written to the app's private browser storage and registered like imported media. Buffer contents are discarded when a new capture session starts.

## Live Audio Chain

Process capture audio with a gate → compressor → limiter insert chain.

- **Inserts**: Open **Audio > Live Chain** to see three insert rows — **Gate**, **Compressor**, and **Limiter** — each with a power toggle and expandable parameter sliders (threshold, ratio, attack/release, and so on).
- **Bypass**: Every insert defaults to bypassed. Bypassed inserts are a clean pass-through — they add no latency and do not alter the signal.
- **Print chain to recording**: During an active capture, enable this toggle to bake the chain into the recorded audio. Processing runs in the pipeline worker as frames are encoded, so recordings are processed reliably even when the tab is backgrounded or monitor audio is muted. In this version the chain applies to the **recording only** — monitor output (what you hear live) stays unprocessed.
- **Latency**: The panel header reports the chain's processing latency. The limiter's 5 ms lookahead is the only contributor; gate and compressor are zero-latency.
- **Requirements**: The Live Audio Chain requires cross-origin isolation (the same requirement as full-performance playback). Chain settings persist with the project.

## Look Packs

Look packs are film-emulation presets that combine grain, halation, and vignette effects into a single portable JSON file. They can optionally reference a `.cube` LUT file for colour grading.

### Applying a Look Preset

1. Select a clip on the timeline.
2. In the Inspector, click **Apply Look Preset…**.
3. Pick a `.json` preset file. If the preset references a LUT, you can also select the corresponding `.cube` file in the same file picker.
4. The preset's look parameters are applied to the clip immediately.

### Exporting a Look Preset

1. Select a clip that has non-default look parameters.
2. In the Inspector, click **Export Look Preset…**.
3. The preset JSON is saved to your downloads. If the clip has a LUT, a message reminds you to include the `.cube` file alongside the preset when sharing.

### Look Parameters

The Inspector's **Look** section (visible when look params are non-default) provides sliders for:

- **Grain Strength** (0–1): Film grain intensity
- **Grain Size** (0.5–4.0): Spatial scale of the grain pattern
- **Halation Threshold** (0–1): Brightness threshold for the halation glow
- **Halation Radius** (0–64): Blur radius of the halation effect
- **Halation Tint** (R, G, B): Colour of the halation glow
- **Vignette Amount** (0–1): Darkness of the vignette
- **Vignette Feather** (0–1): Softness of the vignette edge
- **Vignette Roundness** (0–2): Shape from circular (1.0) to rectangular (2.0)

The pipeline order is fixed: colour grade → LUT → halation → grain → vignette.

## Animated Overlays

### Animated Images (WebP, AVIF, GIF)

Animated WebP, AVIF, and GIF files can be imported as image sources. On browsers that support the `ImageDecoder` API (Chromium, Safari), animations play frame-accurately. On Firefox, only the first frame is displayed with a **"static (browser limitation)"** badge in the media bin.

To use an animated image as an overlay, place it on a track above your main video. The compositor blends it automatically.

### Lottie Animations

Plain `.json` Lottie files (exported from After Effects, LottieFiles, etc.) can be imported as overlay sources. The animation plays frame-accurately in the pipeline worker using lottie-web.

**Note**: `.lottie` zip containers are not yet supported. Export plain `.json` from your Lottie tool.

Lottie sources appear in the media bin with a **"Lottie"** badge. The animation duration and frame rate are shown in the details popover.

### Alpha Video Overlays

VP9 and AV1 video files with alpha channels can be used as overlays. Place the alpha video on a higher track; the compositor's premultiplied-alpha over-blend composites it automatically over lower tracks.

If your browser cannot decode alpha (the VP9/AV1 decode probe is unsupported), the video will import as opaque with an **"Alpha channel not decoded"** warning in the media bin.

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

## Project Format

LocalCut supports four project aspect-ratio modes:

| Mode      | Aspect | Output Dimensions | Use Case                        |
| --------- | ------ | ----------------- | ------------------------------- |
| Landscape | 16:9   | 1920×1080         | Standard video, YouTube         |
| Vertical  | 9:16   | 1080×1920         | TikTok, Douyin, Shorts, Reels   |
| Square    | 1:1    | 1080×1080         | Instagram feed                  |
| Portrait  | 4:5    | 1080×1350         | Instagram portrait, Xiaohongshu |

Use the format picker in the preview toolbar. Clips re-letterbox automatically. Changes are undoable.

## Platform Safe Zones

Enable platform-specific safe-zone overlays to keep content visible above UI elements:

1. Set format to vertical/square.
2. Use the **Platform** dropdown to select Douyin, Xiaohongshu, Shorts, or Reels.
3. Red zones = occluded by platform UI. Yellow zones = recommended safe area.

Zone values are updatable via `safe-zones.v1.json` without code changes.

## Cover Frame

Set a cover frame (封面) for export as JPEG thumbnail:

1. Position playhead at desired frame.
2. Optionally choose a title overlay, then click **Cover**.
3. Export via the render queue. When a cover is set, LocalCut asks for a
   directory destination even for a one-job queue so `<filename>.cover.jpg` can
   be saved alongside the video.

The cover preview appears beside the Cover button. Direct one-off video exports
do not create a cover JPEG; cover files are produced by render queue jobs and
project bundle exports.

## Platform Export Presets

Built-in presets for short-form platforms (Douyin, Shorts, Reels, Xiaohongshu) with H.264 codec and -14 LUFS target. Codec fallback (H.264→VP9) with visible banner when needed.

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

## Program Mode

Program Mode lets you compose named scenes over live cameras, screen captures, and stills, then switch between them with hotkeys while recording. Every source is independently ISO-encoded, so after stopping you get a fully re-editable multitrack project.

For full details, see [PROGRAM-MODE.md](PROGRAM-MODE.md).

### Quick start

1. Open **Capture > Program**
2. Add sources: **+ Screen**, **+ Camera**, **+ Mic**
3. Define scenes with layer transforms and hotkeys
4. Click **Start**
5. Press `1`–`9` to switch scenes during recording
6. Click **Stop** — ISO tracks + layout track land on the timeline

### Key features

- **One-gesture-per-screen**: each screen source needs one picker click
- **One-frame scene switch**: no pipeline rebuild, no texture reallocation
- **ISO tracks**: each source is independently recorded and editable
- **Layout track**: replays the live mix through the compositor
- **Encoder budget**: hardware-limited concurrent sessions

### Browser support

Chromium-only (requires WebGPU + MediaStreamTrackProcessor + WebCodecs). Safari and Firefox see the panel disabled with reasons.

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
