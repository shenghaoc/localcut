# LocalCut Studio — Deployment Verification Checklist

Use this checklist to verify a deployed instance of LocalCut Studio. Each item can be checked manually in a browser.

## Prerequisites

- A deployed instance URL (e.g. `https://localcut.studio` or `http://localhost:5173` for local dev).
- A short test video file: MP4 (H.264/AAC), 5–30 seconds, 720p or 1080p.
- Chromium desktop browser (Chrome 120+ or Edge 120+) for full-tier verification.

## Full-Tier Verification (Chrome/Edge with WebGPU)

### 1. App loads

- [ ] Navigate to the deployed URL.
- [ ] The app shell renders (dark background, toolbar, timeline area, preview area).
- [ ] No blank white screen or JavaScript error blocking the UI.

### 2. Cross-origin isolation

- [ ] Open DevTools console, type `crossOriginIsolated` — should return `true`.
- [ ] Status bar at the bottom shows the capability tier (e.g. "Accelerated" or "Pipeline ready").

### 3. Capability tier

- [ ] Open **Help → Browser capabilities**.
- [ ] The panel shows WebGPU as supported, WebCodecs as supported, SharedArrayBuffer as available.
- [ ] COOP/COEP isolation shows as active.

### 4. Import media

- [ ] Click **Import** or drag-and-drop a test MP4 file.
- [ ] The file appears in the Media Bin on the left.
- [ ] A clip appears on the timeline (first import auto-places).
- [ ] No import error dialog unless the file is genuinely unsupported.

### 5. Playback

- [ ] Press **L** or click Play — video plays in the preview panel.
- [ ] Press **K** or click Pause — video pauses.
- [ ] Click on the timeline ruler — playhead seeks to that position.
- [ ] Preview updates to show the frame at the seek position.

### 6. Audio

- [ ] If the test file has audio, confirm audio plays during playback.
- [ ] Audio meters (if visible) respond to audio content.

### 7. Timeline editing

- [ ] Select the clip on the timeline, press **S** — clip splits at the playhead.
- [ ] Select one half, press **Delete** — the segment is removed.
- [ ] Press **Ctrl+Z** / **Cmd+Z** — undo restores the deleted segment.

### 8. Export

- [ ] Click **Export** in the toolbar.
- [ ] Verify H.264 / MP4 is available as a codec/container option.
- [ ] Click **Start** and choose a save location.
- [ ] Export completes with a progress indicator. The output file is playable.

### 9. Diagnostics

- [ ] Click **Diagnostics** in the status bar.
- [ ] The panel shows capability tier, GPU status, codec support, storage usage.
- [ ] Click **Copy Report** — report is copied to clipboard.
- [ ] Paste the report in a text editor — verify it contains no file names or media content.
- [ ] Verify the report includes app version and build identifier.

### 10. Reload and restore

- [ ] With a project on the timeline, reload the page (F5 / Ctrl+R).
- [ ] The app prompts to restore the previous session.
- [ ] Accept — the timeline, clips, and edits are restored.

### 11. PWA / Offline

- [ ] Check the browser address bar for the PWA install icon (or use Chrome menu → Install).
- [ ] After install, disconnect from the internet.
- [ ] Open the installed app — it loads from cache and the shell is functional.

### 12. Phase 43 Screencast Post Pack

- [ ] Select a video clip, apply a **Zoom-n-Pan** preset, and verify editable transform keyframes appear on the clip.
- [ ] Record with the Own Tab capture option, land the clip, open **Auto-Zoom**, and apply or skip at least one proposal. For window/display captures, verify the panel explains that no event log is available.
- [ ] Use the toolbar **Callout** tool to draw an arrow or box, then select the callout clip and change its style in the Inspector.
- [ ] Draw **Spotlight** and **Blur** callouts and verify they affect the underlying composited image without leaving the accelerated tier.
- [ ] Toggle **Padded Background** on a video clip and verify the gradient, inset, rounded corners, and shadow appear in preview and export.

## Reduced-Tier Verification

For browsers without full WebGPU or COOP/COEP isolation:

### 13. Limited mode

- [ ] Open the app in a browser without WebGPU (e.g. Firefox, or Chrome with WebGPU disabled).
- [ ] The app shell loads — no blank screen or crash.
- [ ] Status bar shows a reduced capability tier (not "Accelerated").
- [ ] Diagnostics panel shows specific missing capabilities with actionable messages.
- [ ] The app does not claim full functionality when it cannot deliver it.

## Browser Matrix

| Browser                 | Platform            | Expected Tier | Import  | Preview  | Export        | Notes                             |
| ----------------------- | ------------------- | ------------- | ------- | -------- | ------------- | --------------------------------- |
| Chrome 120+             | Windows/macOS/Linux | Accelerated   | Yes     | WebGPU   | H.264/VP9/AV1 | Full support                      |
| Edge 120+               | Windows/macOS       | Accelerated   | Yes     | WebGPU   | H.264/VP9/AV1 | Full support                      |
| Chrome (no WebGPU flag) | Any                 | Limited       | Yes     | Canvas2D | Limited       | Experimental compatibility mode   |
| Firefox                 | Any                 | Shell Only    | Partial | No       | No            | WebGPU not yet shipped by default |
| Safari                  | macOS               | Shell Only    | Partial | No       | No            | WebGPU partial, WebCodecs limited |
| Mobile Chrome           | Android             | Shell Only    | No      | No       | No            | Not optimized for mobile          |

## Result Recording

Record verification results with:

- Date and time
- Browser name and version
- Operating system
- App version and build SHA (from diagnostics report)
- Pass/fail for each checklist item
- Screenshots or notes for any failures
