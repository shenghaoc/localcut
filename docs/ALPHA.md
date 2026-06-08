# LocalCut Studio — Alpha 0.1 Support Boundary

This document defines what is supported, experimental, and not available in the v0.1.0 alpha release.

## Supported (Alpha Happy Path)

These features are the core editing loop and are expected to work reliably on a Chromium desktop browser (Chrome 120+, Edge 120+) with WebGPU, WebCodecs, and COOP/COEP isolation:

- **Import**: MP4 (H.264/AAC), MOV (H.264/AAC), WebM (VP9/Opus) via drag-and-drop or file picker.
- **Media Bin**: browse imported sources, view details (resolution, frame rate, codec, rotation, health warnings), add to timeline, remove.
- **Timeline editing**: split, trim (edge drag), move, delete, copy/paste/duplicate, multi-select, undo/redo.
- **Multi-track**: video and audio tracks, track add/remove/reorder/lock/visibility.
- **Preview**: real-time WebGPU preview with adaptive resolution, transport controls (play/pause/seek/step), safe area guides.
- **Effects**: per-clip brightness, contrast, saturation, temperature via GPU compute shaders.
- **Transforms**: per-clip position, scale, rotation, opacity with preview gizmo.
- **Multi-track compositing**: layered video with Porter-Duff over compositing.
- **Titles**: text overlays with font size, color, alignment, background, outline, shadow.
- **Audio mixing**: per-track gain/pan/mute/solo, clip fades, master bus, real-time meters.
- **Captions**: SRT/VTT import, inline editing, timing adjustment, split/merge, style presets, export.
- **Export**: H.264 MP4 with resolution/fps/bitrate overrides, full or range export.
- **Keyframes**: animated effect and transform parameters.
- **Project persistence**: IndexedDB autosave, restore on reload, undo/redo history.
- **Media re-linking**: offline sources can be re-linked to moved files.
- **PWA**: installable, works offline after first load.
- **Diagnostics**: capability tier display, GPU/codec status, storage, performance budgets, privacy-redacted report copy.
- **Crash recovery**: worker restart, GPU device-lost recovery, audio retry, storage cleanup.

## Experimental

These features are present but may have incomplete behavior, edge cases, or limited browser support. They are labeled "(Experimental)" in the UI where applicable:

- **Compatibility preview/export** — reduced-tier GPU or Canvas2D preview for browsers without full WebGPU. May have lower quality or missing effects.
- **Cross-browser reduced tiers** — Limited WebCodecs and Shell Only tiers. The app loads but functionality is constrained.
- **Scopes** — waveform, vectorscope, histogram display. GPU-computed but not validated across all content types.
- **Render queue** — multi-job sequential export. Core export works; queuing multiple jobs with different settings is experimental.
- **Project bundles** — export/import a project directory with media. Fingerprint dedup and integrity validation are implemented but not battle-tested.
- **Export presets** — save/load export settings. The settings persist but preset management UI is minimal.
- **VP9/AV1 export** — depends on browser encoder support. H.264 MP4 is the reliable export path.
- **LUT import** — `.cube` 3D LUT grading. Parsing and GPU application work but are not validated against professional LUT libraries.
- **Advanced trim modes** — roll, slip, slide edits. Basic trim (edge drag) is supported; advanced modes are implemented but less tested.
- **Color management** — BT.601/BT.709/Rec.2020/Display P3 conversions. Working but not validated with professional color-critical workflows.

## Not Supported

These are explicitly out of scope for v0.1.0:

- **Transitions** — cut-point dissolves, wipes, or custom transitions between clips (Phase 13, planned).
- **Collaboration** — no multi-user editing, no shared projects.
- **Cloud sync** — no server-side storage, no upload/download of projects or media.
- **Accounts** — no login, no user profiles, no authentication.
- **Mobile** — designed for desktop browsers; mobile layout is not optimized.
- **AI features** — no AI-assisted editing, no AI transcription, no AI effects. This is a manual editing tool.
- **Server processing** — no server-side transcoding, rendering, or media analysis.
- **DRM/protected content** — no playback or import of DRM-protected media.
- **Professional broadcast formats** — ProRes, DNxHR, MXF, and other professional container/codec formats are not supported.
