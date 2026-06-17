# Screencast Guide

Use these workflows to polish screen recordings without leaving LocalCut Studio. The tools run locally and require the accelerated WebGPU tier for live preview/export.

## Zoom-n-Pan presets

1. Select a video or screen-capture clip on the timeline.
2. Open **Inspector** → **Zoom-n-Pan**.
3. Pick a preset: centre zoom, region zoom, zoom out, pan left-right, or pan right-left.
4. Adjust scale, position, entry ramp, hold, and exit ramp.
5. Click **Apply**. The preset writes ordinary transform keyframes, so you can edit, retime, or delete them with the existing keyframe controls.

Screenshot placeholder: `docs/screenshots/phase-43-zoom-preset.png`

## Auto-Zoom proposals

1. Record using the Own Tab capture option.
2. Land the recording into the project.
3. Select the landed screen clip and open **Inspector** → **Auto-Zoom**.
4. Review each proposal. Each item shows its timestamp, centroid position, and event count.
5. Click **Apply** to write transform keyframes for that proposal, or **Skip** to gray it out. Undo works through the normal editor history.

Auto-Zoom requires recording with the Own Tab option. Event logs are not available for arbitrary window or display captures.

Screenshot placeholder: `docs/screenshots/phase-43-auto-zoom.png`

## Callout clips

1. Click the toolbar **Callout** button.
2. Pick **Arrow**, **Box**, **Step**, **Spotlight**, or **Blur**.
3. Draw on the preview. The callout clip is inserted at the playhead on an overlay video track.
4. Select the callout clip and adjust colour, stroke width, fill opacity, font size, arrowhead size, blur radius, or spotlight strength in the Inspector.
5. Trim, move, split, or delete the callout like any other timeline clip.

Screenshot placeholder: `docs/screenshots/phase-43-callout-tool.png`

## Padded Background

1. Select a video or screen-capture clip.
2. Open **Inspector** → **Padded Background**.
3. Toggle the preset on.
4. Choose a solid or gradient background and adjust inset margin, corner radius, shadow opacity, shadow radius, and shadow offset.
5. Play or export normally; the background is rendered by the compositor, not baked into the source file.

Screenshot placeholder: `docs/screenshots/phase-43-padded-background.png`
