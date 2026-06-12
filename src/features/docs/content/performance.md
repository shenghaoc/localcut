# Performance

LocalCut Studio is built to keep editing responsive: decoding, effects, and encoding run off the main thread, and the preview adapts to your machine. When things still feel slow, these are the levers that matter.

## Quick wins

- **Use a Chromium browser** (Chrome, Edge, Brave) and confirm the pipeline strip says **Accelerated**. Every reduced tier trades speed for compatibility.
- **Check hardware acceleration** is enabled in your browser's settings and your GPU drivers are up to date — software rendering forces the slow path.
- **Close GPU-heavy tabs and apps** (video calls, games, other editors). They compete for the same decoder, encoder, and VRAM.
- **Plug in laptops.** Battery power-saving modes throttle the GPU and slow exports dramatically.

## Preview performance

- The preview **adapts its resolution** under load — the current size shows in the pipeline strip. A lower preview resolution never affects export quality.
- **Audio is the master clock**: when the machine can't keep up, video frames are dropped so audio stays continuous. Frequent drops are a sign to reduce load.
- Heavily keyframed effects, LUTs, and many simultaneous video layers cost GPU time per frame; toggle track visibility while cutting if the composite gets heavy.

## Media that is slow to edit

- **Long-GOP, high-resolution sources** (4K phone/drone footage) are expensive to seek because the decoder must rebuild from keyframes. Cutting 4K on modest hardware benefits from re-encoding tricky sources to a mezzanine (high-bitrate H.264) first.
- **Variable frame rate** sources are handled correctly but cost more bookkeeping; if a VFR file misbehaves, a constant-frame-rate re-encode is a reliable fix.
- **Very high frame rate** (120fps+) material decodes a lot of frames per timeline second; expect slower scrubbing.

## Export speed

- **H.264 is usually fastest** because hardware encoders are common; AV1 without hardware support is slow everywhere.
- Bitrate and resolution scale encode time roughly linearly — export at delivery resolution, not above it.
- Keep the tab **focused or visible** during long exports; browsers may throttle background tabs.

## Watching the numbers

The **Diagnostics** panel (status-bar button) shows live performance budgets — decode queue depth, dropped frames, cache pressure, storage quota — plus recent errors with recovery actions. If a budget is consistently red on the Accelerated tier, the bottleneck is usually the source media or the GPU; the entries above tell you which lever to pull.
