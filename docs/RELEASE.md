# LocalCut Studio -- v1.0.0 Support Boundary

All 48 development phases are complete. This document defines the support boundary for the v1.0.0 release.

## Supported

These features are the core editing loop and are expected to work reliably on a Chromium desktop browser (Chrome 120+, Edge 120+) with WebGPU, WebCodecs, and COOP/COEP isolation:

- **Import**: MP4 (H.264/AAC), MOV (H.264/AAC), WebM (VP9/Opus), audio-only (WAV/MP3/M4A/OGG), and still images (PNG/JPG/WebP) via drag-and-drop or file picker.
- **Media Bin**: browse imported sources, view details (resolution, frame rate, codec, rotation, actionable health warnings), add to timeline, remove.
- **Timeline editing**: split, trim (edge drag), move, delete, copy/paste/duplicate, multi-select, undo/redo, markers.
- **Multi-track**: video and audio tracks, track add/remove/reorder/lock/visibility/sync lock/edit targeting.
- **Advanced editing**: insert/overwrite edits, ripple delete/trim, roll/slip/slide, lift/extract, linked A/V clips.
- **Preview**: real-time WebGPU preview with adaptive resolution, transport controls (play/pause/seek/step), safe area guides, loop playback.
- **Effects**: per-clip brightness, contrast, saturation, temperature via GPU compute shaders; keyframed animation.
- **Transforms**: per-clip position, scale, rotation, opacity with preview gizmo; keyframed animation.
- **Multi-track compositing**: layered video with Porter-Duff over compositing.
- **Transitions**: cut-point dissolves and crossfades with dual-stream readahead.
- **Titles**: text overlays with font size, color, alignment, background, outline, shadow.
- **Audio mixing**: per-track gain/pan/mute/solo, clip fades, transition crossfades, master bus, real-time meters.
- **Captions**: SRT/VTT import, inline editing, timing adjustment, split/merge, style presets, burn-in, export. Auto Captions via on-device ORT Whisper.
- **Export**: H.264/VP9/AV1 with resolution/fps/bitrate overrides, full or range export, render queue with presets.
- **Keyframes**: animated effect and transform parameters with interpolation.
- **Colour grading**: `.cube` 3D LUT import; waveform, vectorscope, histogram scopes; BT.601/BT.709/Rec.2020/Display P3 conversions.
- **Project persistence**: IndexedDB autosave, restore on reload, undo/redo history, project bundles with fingerprint dedup.
- **Media re-linking**: offline sources can be re-linked to moved files.
- **Media conformance**: VFR detection, rotation metadata, codec validation, source health warnings.
- **Proxy/render cache**: LRU frame cache, proxy generation, OPFS storage with budgets.
- **Time remapping**: per-clip keyframed speed curves (0.25x--4x) with pitch-preserving WSOLA stretch.
- **Recording**: screen/webcam/mic capture with realtime WebCodecs encode, crash-safe OPFS chunks, quota preflight.
- **Smart Reframe**: automatic crop-path generation for aspect ratio conversion (16:9, 9:16, 1:1, 4:5) with saliency and optional face detection.
- **Portrait Matting**: on-device person segmentation (MODNet ONNX on ORT-WebGPU) for background remove/replace/blur.
- **Audio Cleanup**: on-device noise suppression via ORT DTLN on WASM; experimental WebNN acceleration where the browser supports it.
- **WHIP Publish**: RFC 9725 live streaming over WebRTC with bearer-token endpoints.
- **OpenTimelineIO export**: `.otio` + CMX3600 EDL interchange for round-tripping with other NLEs.
- **Media Converter**: standalone re-container/transcode view with batch job list.
- **Cross-browser compatibility**: capability-tiered experience from accelerated WebGPU down to shell-only.
- **PWA**: installable, works offline after first load.
- **Diagnostics**: capability tier display, GPU/codec status, storage, performance budgets, privacy-redacted report copy, crash recovery.
- **In-app User Guide**: routed `/docs` view with bundled markdown content and contextual links.
- **Beat Tools**: onset-detection-driven beat markers and rhythm-aligned editing aids.

## Experimental

These features are present but may have edge cases or limited browser support:

- **Cross-browser reduced tiers** -- Limited WebCodecs and Shell Only tiers. The app loads but functionality is constrained.
- **WebNN execution providers** -- WebNN-accelerated ML inference depends on browser and hardware support; ORT-WASM is the reliable fallback.
- **Frame Interpolation** -- RIFE-class learned interpolation on ORT-WebGPU for slow-motion and fps upconversion. Ships with a `template: true` manifest; the feature is hidden until a license-verified ONNX model is provided.
- **Frame interpolation export** -- export-time fps upconversion is gated pending validated ONNX model licensing.
- **On-Device Language Tools** -- Chrome built-in AI translation, summarization, and title/hashtag generation from captions. Requires Chrome 138+ with the experimental built-in AI origin trial; unavailable on other browsers.

## Not Supported

- **Collaboration** -- no multi-user editing, no shared projects.
- **Cloud sync** -- no server-side storage, no upload/download of projects or media.
- **Accounts** -- no login, no user profiles, no authentication.
- **Mobile** -- designed for desktop browsers; mobile layout is not optimized.
- **Server processing** -- no server-side transcoding, rendering, or media analysis.
- **DRM/protected content** -- no playback or import of DRM-protected media.
- **Professional broadcast formats** -- ProRes, DNxHR, MXF, and other professional container/codec formats are not supported.
