# Screencast Post Pack

The Screencast Post Pack is for tutorial and software walkthrough edits. It adds zoom presets, event-log-based auto zoom proposals, callout clips, and padded backgrounds. These tools require the accelerated WebGPU tier; lower tiers show a disabled explanation instead of silently producing a partial result.

## Zoom-n-Pan

Select a video clip, then open **Inspector** → **Zoom-n-Pan**. Choose a preset, adjust scale/position/timing, and click **Apply**. The preset writes ordinary transform keyframes, so you can edit them with the same keyframe controls you use for manual animation.

## Auto-Zoom

Auto-Zoom works from an own-tab capture event log. Record with the Own Tab option, land the recording, select the screen clip, and open **Auto-Zoom** in the Inspector. Review each proposal and choose **Apply** or **Skip**.

Auto-Zoom requires recording with the Own Tab option. Event logs are not available for window or display captures.

## Callouts

Click **Callout** in the toolbar, choose a kind, then draw on the preview. Arrow, box, and step callouts render as cached overlay textures. Spotlight and blur-region callouts run as compositor GPU passes over the image underneath them. Select a callout clip to change its style in the Inspector.

## Padded Background

Select a clip and enable **Padded Background** in the Inspector. Choose a solid or gradient background, then tune inset, corner radius, shadow opacity, shadow radius, and shadow offset. The effect stays live in preview and export.
