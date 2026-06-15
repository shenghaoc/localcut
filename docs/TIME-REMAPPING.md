# Time Remapping (Speed Ramps)

Technical reference for the speed ramp / time remapping system in LocalCut Studio.

## Speed Curve Model

A speed ramp is a set of keyframes that map **output time** to a **speed multiplier**. Between keyframes, the speed is interpolated according to each keyframe's easing type. The engine evaluates the curve by integrating `1 / speed(t)` over the source duration to produce a lookup table (LUT) that maps every output timestamp back to its source timestamp.

The LUT is built once per clip (and cached per-clip in both the preview pipeline and the export path). It uses composite Simpson's rule at a step size of `1/120` seconds, producing a monotone piecewise-linear table stored as paired `Float64Array`s. At playback or export time, a binary search plus linear interpolation resolves any output time to its source time in O(log n).

Because the LUT integrates until the entire source media is consumed, the **output duration is determined by the curve itself** -- it is not a user-settable value.

## Easing Types

Each keyframe carries an `easing` field that controls how speed transitions toward the next keyframe:

| Easing   | Behaviour                                                                                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `linear` | Straight-line interpolation between this keyframe's speed and the next keyframe's speed.                                                    |
| `ease`   | Hermite smoothstep (`t^2 * (3 - 2t)`) -- starts slowly, accelerates through the midpoint, then decelerates. Produces natural-feeling ramps. |
| `hold`   | Constant speed from this keyframe. The speed does not change until the next keyframe is reached, at which point it jumps instantly.         |

All three types are available on every keyframe. Mixing types within a single ramp is supported -- for example, a `hold` keyframe at the start followed by `ease` keyframes produces a speed that plateaus and then smoothly ramps.

## Speed Range

| Constant          | Value  | Meaning                  |
| ----------------- | ------ | ------------------------ |
| `REMAP_SPEED_MIN` | `0.25` | 4x slower than real-time |
| `REMAP_SPEED_MAX` | `4.0`  | 4x faster than real-time |

A speed of `1.0` is normal playback. Values between `0.25` and `1.0` produce slow-motion; values between `1.0` and `4.0` produce fast-motion. Speeds are always positive -- negative speeds (reverse playback) are not within the supported range.

Keyframes with speeds outside the `[0.25, 4.0]` range are rejected by the pipeline worker.

## Output Duration

The output duration of a speed-ramped clip is the integral of `1 / speed(t)` over the source duration. Concretely:

- A constant **2x** speed on a 10-second source produces approximately **5 seconds** of output.
- A constant **0.5x** speed on a 5-second source produces approximately **10 seconds** of output.
- A constant **1x** speed produces output equal to the source duration.

When a ramp is applied, the clip's timeline duration is automatically updated to the computed output duration. When the ramp is cleared, the duration is restored to the original source duration.

If the computed output duration would overlap the next clip on the track, it is capped at the available space (or 6 hours, whichever is smaller). A `time-remap-error` event with reason `remap-capped` is emitted when capping occurs.

**Varying speed across a ramp** means the output duration is the sum of all the little `dt / speed(t)` segments. A ramp that starts at 0.5x and ends at 2x will produce an output whose first half is stretched (slow) and second half is compressed (fast), with the total duration reflecting the weighted average.

## WSOLA Pitch Preserve

When **Pitch Preserve** is enabled on a speed ramp, audio is time-stretched using the WSOLA (Waveform Similarity Overlap-Add) algorithm rather than simply resampling. This keeps speech and music at their natural pitch when the playback speed changes.

The WSOLA implementation:

| Parameter           | Value                        | Notes                                |
| ------------------- | ---------------------------- | ------------------------------------ |
| Window size         | 1440 samples                 | ~30 ms at 48 kHz                     |
| Overlap             | 720 samples (50%)            | Linear crossfade in overlap region   |
| Search radius       | 480 samples                  | ~10 ms at 48 kHz                     |
| Correlation         | Normalized cross-correlation | Finds best-matching overlap position |
| Memory per instance | ~23 KB                       | Stereo at 48 kHz                     |

The stretcher advances its analysis pointer by `blockFrames / speedRatio` source samples per output block. At seek or clip-change boundaries the stretcher is reset to avoid artefacts from stale correlation state.

When Pitch Preserve is **disabled**, audio is resampled directly at the playback speed ratio. This is faster to compute but changes the pitch -- a 2x speed plays audio one octave higher, and a 0.5x speed plays it one octave lower. This may be acceptable for rough previews or when pitch-shifted audio is an intentional creative effect.

The Pitch Preserve toggle applies to the entire clip -- it cannot be varied per-keyframe.

## Why Reverse Playback Is Not Supported

Time remapping in LocalCut Studio is forward-only. Several parts of the architecture depend on this assumption:

1. **Speed range is strictly positive** -- the minimum speed is 0.25, so negative (reverse) speeds are rejected before they reach the LUT builder.
2. **The LUT assumes forward source progression** -- the integration accumulates source time by adding positive deltas. A negative speed would require the integration to move backwards through the source, which the current LUT structure does not support.
3. **The WSOLA stretcher handles only forward playback** -- the analysis pointer advances forward through the source buffer. Reverse playback would require a fundamentally different buffering and correlation strategy.
4. **WebCodecs decoders are forward-only** -- `VideoDecoder` and `AudioDecoder` process encoded chunks in decode order. Reverse playback would require decoding the entire clip and then reversing the frame order, which is impractical for long clips in a browser environment.

Reverse playback is a planned future capability that would require changes to the decode pipeline, the LUT model, and the audio stretcher. It is not simply a matter of allowing negative speed values.
