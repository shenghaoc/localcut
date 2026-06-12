# Getting started

This page takes you from a fresh browser tab to your first exported video.

## 1. Pick the right browser

LocalCut Studio runs everywhere, but full performance needs a recent **Chromium browser** — Chrome, Edge, or Brave — because the accelerated pipeline is built on WebGPU and WebCodecs, browser features that are most complete there.

When the app loads, look at the pipeline strip under the toolbar:

- **Accelerated** — you have the full experience: GPU preview, real-time effects, fast export.
- **GPU compat / Limited WebCodecs** — a reduced but working mode. Editing works; preview and export are slower or constrained.
- **Limited shell / Blocked** — the browser is missing required features. The app stays up and explains what's missing.

Click **Capabilities** in the pipeline strip at any time to see exactly what your browser supports and what would unlock more. The details live in [Browser limitations](/docs/browser-limitations).

## 2. Import your first clip

Either **drag a video file onto the window** or click **Import** in the toolbar. MP4, MOV, and WebM video work best; you can also import audio (MP3, M4A, WAV, OGG) and images (PNG, JPG, WebP, GIF, AVIF).

The file appears in the **Media Bin** on the left. When the timeline is empty, your first playable import is placed on the timeline automatically so you can press **Play** right away. More on formats and warnings in [Importing media](/docs/importing-media).

## 3. Make some edits

- **Seek** by clicking the timeline ruler; press **L** to play and **K** to pause.
- **Split** the selected clip at the playhead with **S**.
- **Trim** by dragging a clip's left or right edge.
- **Move** clips by dragging; they snap to the playhead, clip edges, and markers.
- **Undo** anything with **Ctrl+Z** (Cmd+Z on Mac).

Select a clip and the **Inspector** on the right shows its effects, transform, and audio controls. The full tool reference is in [Timeline editing](/docs/timeline-editing).

## 4. Export

Click **Export** in the toolbar, pick a codec and container (sensible defaults are pre-selected for your browser), and click **Start**. The file is encoded on your machine and saved where you choose. Details, presets, and the render queue are covered in [Exporting](/docs/exporting).

## Your project is saved automatically

Edits autosave continuously to your browser's local storage. If you close the tab and come back, the app offers to restore your last session. If a source file has moved since, you'll be asked to **re-link** it — see [Troubleshooting](/docs/troubleshooting).
