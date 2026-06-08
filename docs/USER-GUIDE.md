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

## Captions & Subtitles

Import, edit, and export caption tracks:

- **Import Captions**: Click **Import** in the Transcript panel to load SRT or VTT files.
- **Edit Text**: Click any caption segment to edit its text inline.
- **Adjust Timing**: Edit start/end times in the caption panel. Use **Snap start**, **Snap end**, or **Snap both** to align a segment edge to the playhead.
- **Split/Merge**: Split a segment at the playhead, or merge adjacent segments.
- **Delete**: Remove selected caption segments.
- **Style**: Set preset, font size, color, background, burn-in, and visibility per track. Individual segments can override color and background.
- **Export**: Export captions as SRT or VTT files.

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

## Project Bundles

Bundle your project for portability or backup:

- **Export Bundle**: Packages your project file and copies all media into a single folder. Choose whether to relocate (move) or copy media files.
- **Import Bundle**: Open a previously exported bundle to restore a project with all its media.
- **Collect Media**: Gather all referenced media files into a single directory.

Access bundle operations from the toolbar menu next to the Export button. The integrity report verifies all files are present and intact.

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

Click **Help** in the toolbar to open the in-app Help panel. It displays the full user guide so you can look up features without leaving the editor.

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
