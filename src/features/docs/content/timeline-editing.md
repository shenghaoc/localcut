# Timeline editing

The timeline is where you arrange clips. Each track holds one kind of media — video or audio — and tracks composite top-down in the preview.

## Transport

| Action                 | Shortcut                 |
| ---------------------- | ------------------------ |
| Play                   | **L**                    |
| Pause                  | **K**                    |
| Step back one frame    | **J**                    |
| Step forward one frame | toolbar button           |
| Seek                   | click the timeline ruler |

## Editing operations

| Action                   | How                                                                  |
| ------------------------ | -------------------------------------------------------------------- |
| Split                    | select a clip, press **S** — cuts at the playhead                    |
| Delete                   | **Delete** / **Backspace**                                           |
| Trim                     | drag a clip's left or right edge                                     |
| Move                     | drag the clip body; clips snap to the playhead, edges, and markers   |
| Undo / Redo              | **Ctrl+Z** / **Ctrl+Shift+Z** (Cmd on Mac)                           |
| Copy / Paste / Duplicate | **Ctrl+C** / **Ctrl+V** / **Ctrl+D**                                 |
| Zoom                     | **Ctrl+=** / **Ctrl+-**, or the timeline zoom buttons                |
| Multi-select             | **Ctrl+Click** (Cmd+Click) to add or remove clips from the selection |

## Tracks

Use the **+** button in the timeline header to add video or audio tracks. Track headers offer **lock** (prevent edits), **visibility** (hide from preview/export), **sync lock**, and reordering. Markers added at the playhead show on the ruler and can bound export ranges.

## Transitions

When two clips share a cut point on the same video track, a **diamond** appears at the boundary. Click it, then choose a kind (Cross Dissolve, Dip to Black, Wipe, Slide) and duration in the Inspector. The maximum duration reflects how much source headroom each clip has past the cut.

Transitions render on the full accelerated (WebGPU) path. On the reduced-compatibility export path they are skipped with a warning — see [Browser limitations](/docs/browser-limitations).

## Titles

Click **Add Title** in the timeline toolbar to create a text card at the playhead. Edit its text, font size, colour, alignment, background, outline, and shadow in the Inspector. Titles behave like video clips: transforms, effects, and keyframes all apply.

## Inspector: effects, transform, keyframes

Select a clip to edit it in the **Inspector** (right sidebar):

- **Video**: position, scale, rotation, opacity, fit mode (Fill / Fit / Letterbox); brightness, contrast, saturation, temperature; `.cube` LUT import with a strength slider.
- **Audio**: per-track gain, pan, mute, solo; per-clip fade-in/fade-out.
- **Keyframes**: click the diamond next to a parameter to set a keyframe at the playhead, move the playhead, change the value — the parameter animates between keyframes. The same interpolation is used in preview and export.

## How the preview behaves

The preview always shows the timeline at the playhead, composited with all effects and transforms applied — what you see is what exports.

- **Adaptive resolution**: to keep playback smooth, the preview may render below full resolution; the current preview size shows in the pipeline strip. Export is always full resolution regardless of the preview setting.
- **Audio is the clock**: video synchronises to audio, so under load the app drops video frames rather than letting audio drift.
- **Safe areas**: toggle title/action safe-area guides with the **Safe areas** button on the preview.

If playback stutters, see [Performance](/docs/performance).
