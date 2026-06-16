# Look Packs

Look packs are film-emulation presets that combine grain, halation, and vignette effects into a single portable JSON file. They can optionally reference a `.cube` LUT file for colour grading.

## Applying a Look Preset

1. Select a clip on the timeline.
2. In the Inspector, click **Apply Look Preset…**.
3. Pick a `.json` preset file. If the preset references a LUT, you can also select the corresponding `.cube` file in the same file picker.
4. The preset's look parameters are applied to the clip immediately.

If the preset references a LUT but the `.cube` file fails to import (or your browser lacks the WebGPU renderer that LUTs require), the import is rejected as a whole — the clip stays unchanged rather than being left with a half-applied look.

## Exporting a Look Preset

1. Select a clip that has non-default look parameters.
2. In the Inspector, click **Export Look Preset…**.
3. The preset JSON is saved to your downloads. If the clip has a LUT, a message reminds you to include the `.cube` file alongside the preset when sharing.

## Look Parameters

The Inspector's **Look** section (visible when look params are non-default) provides sliders for:

- **Grain Strength** (0–1): Film grain intensity
- **Grain Size** (0.5–4.0): Spatial scale of the grain pattern
- **Halation Threshold** (0–1): Brightness threshold for the halation glow
- **Halation Radius** (0–64): Blur radius of the halation effect
- **Halation Tint** (R, G, B): Colour of the halation glow
- **Vignette Amount** (0–1): Darkness of the vignette
- **Vignette Feather** (0–1): Softness of the vignette edge
- **Vignette Roundness** (0–2): Shape from circular (1.0) to rectangular (2.0)

## Pipeline Order

The look passes run in a fixed order inside the single per-frame GPU submission:

```
colour grade → LUT → halation → grain → vignette
```

Grain is seeded from the **timeline time**, not the source frame timestamp, so cached frames, stills, and looped media all show distinct grain instead of freezing on a single noise pattern.
