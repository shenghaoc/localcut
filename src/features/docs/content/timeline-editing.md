# Timeline editing

The timeline is where you arrange clips. Each track holds one kind of media — video or audio — and tracks composite top-down in the preview.

## Transport

| Action                 | Shortcut                 |
| ---------------------- | ------------------------ |
| Play                   | **L**                    |
| Pause                  | **K**                    |
| Step back one frame    | **J**                    |
| Step forward one frame | toolbar button           |
| Loop                   | toolbar **loop** button  |
| Seek                   | click the timeline ruler |

Playback stops when it reaches the end of the timeline. Toggle the **loop** button (the ⟳ repeat icon, next to step-forward) to make it wrap back to the start and keep playing instead — handy for reviewing a cut on repeat. Loop is off by default and the button highlights when it's on.

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

## Snapping to beats

If your project has imported music, run beat analysis to overlay a detected beat grid on the ruler and snap edits to it. See [Beat detection](/docs/beat-detection).

## Transitions

When two clips share a cut point on the same video track, a **diamond** appears at the boundary. Click it, then choose a kind (Cross Dissolve, Dip to Black, Wipe, Slide) and duration in the Inspector. The maximum duration reflects how much source headroom each clip has past the cut.

Transitions render on the full accelerated (WebGPU) path. On the reduced-compatibility export path they are skipped with a warning — see [Browser limitations](/docs/browser-limitations).

## Titles

Click **Add Title** in the timeline toolbar to create a text card at the playhead. Edit its text, font size, colour, alignment, background, outline, and shadow in the Inspector. Titles behave like video clips: transforms, effects, and keyframes all apply.

## Screencast tools

For software walkthroughs, see [Screencast Post Pack](/docs/screencast-post-pack). It covers Zoom-n-Pan presets, Auto-Zoom proposals from own-tab capture event logs, callout clips, and padded backgrounds.

## Inspector: effects, transform, keyframes

Select a clip to edit it in the **Inspector** (right sidebar):

- **Video**: position, scale, rotation, opacity, fit mode (Fill / Fit / Letterbox); brightness, contrast, saturation, temperature; `.cube` LUT import with a strength slider; skin smoothing (see below).
- **Audio**: per-track gain, pan, mute, solo; per-clip fade-in/fade-out.
- **Keyframes**: click the diamond next to a parameter to set a keyframe at the playhead, move the playhead, change the value — the parameter animates between keyframes. The same interpolation is used in preview and export.

## Speed Ramps

Speed ramps let you vary the playback speed of a clip over time -- slow-motion, fast-motion, or a smooth ramp between the two. The speed ramp is applied per-clip and affects both video and audio.

1. Select a video or audio clip on the timeline. Title clips do not support speed ramps.
2. In the Inspector, find the **Speed** section.
3. Click **Add Ramp**. This creates a ramp with two keyframes at normal speed (1x).
4. Adjust keyframe speeds and easing in the speed ramp editor. Speeds range from **0.25x** (4x slower) to **4x** (4x faster).
5. The clip's timeline duration updates automatically to match the ramp -- slowing a clip down makes it longer, speeding it up makes it shorter.

**Pitch Preserve**: When enabled (the default), audio is time-stretched using WSOLA to keep speech and music at their natural pitch. When disabled, audio is resampled directly, which changes the pitch along with the speed.

**Clear Ramp**: Click **Clear Ramp** in the Speed section to remove the speed ramp and restore the clip to its original duration and playback speed.

For the technical details -- easing types, the LUT-based curve evaluation, WSOLA parameters, and why reverse playback is not supported -- see [Time Remapping](/docs/time-remapping).

## Skin smoothing

The **Skin Smoothing** slider in the Inspector applies an edge-preserving beauty filter to the selected clip. It uses a guided filter on luma gated by a chroma-based skin mask, so edges (hair, eyes, jawline) stay sharp while skin texture is softened.

- **Strength** (0–1): controls how much smoothing is applied. The parameter is keyframable; moderate values usually look more natural than pushing the slider near 1.00.
- **Skin Mask**: expand the disclosure to tune which colours the filter treats as skin. The five sliders (Cb min/max, Cr min/max, softness) adjust the chroma band-pass. The defaults are a starting point; narrow or widen the range for the subject and lighting.
- **A/B Bypass**: toggles the effect on and off in the preview without changing the stored strength. Export always uses the stored value.

Skin smoothing requires the WebGPU accelerated effect chain. On capability tiers without WebGPU the slider has no effect on preview or export.

## How the preview behaves

The preview always shows the timeline at the playhead, composited with all effects and transforms applied — what you see is what exports.

- **Adaptive resolution**: to keep playback smooth, the preview may render below full resolution; the current preview size shows in the pipeline strip. Export is always full resolution regardless of the preview setting.
- **Audio is the clock**: video synchronises to audio, so under load the app drops video frames rather than letting audio drift.
- **Safe areas**: toggle title/action safe-area guides with the **Safe areas** button on the preview.
- **Scopes (Experimental)**: on WebGPU-backed tiers, expand **Scopes** in the preview corner to inspect the histogram, luma waveform, RGB parade, and vectorscope. The panel is hidden in Limited WebCodecs and Shell Only tiers because those modes do not produce WebGPU scope summaries. A clipping badge appears in the scope header when clipped pixels are detected.

If playback stutters, see [Performance](/docs/performance).
