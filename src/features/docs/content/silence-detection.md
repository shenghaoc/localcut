# Silence detection

Silence detection scans your audio tracks for dead air — long gaps between
spoken words, breaths, or short pauses that pad a tutorial recording — and
proposes ripple-delete cuts you can review one by one or apply in batch.

The proposal list is **never destructive on its own**. Detection runs in the
pipeline worker and only writes a list of candidate regions; the timeline
changes only when you press **Apply** or **Apply All**, and each application is
a single undo step.

## Using it

1. (Optional but recommended) Select an audio clip on the track you want to
   scan. With no audio clip selected the panel falls back to every audio
   track and intersects the silence found on each one, so it only proposes
   ranges that are quiet on every track simultaneously.
2. Open the command palette (**⌘K** / **Ctrl+K**) and choose **Remove silences** to open Silence Review.
3. Tweak the parameters if needed (defaults work for most narration):
   - **Open / Close threshold** — RMS hysteresis in dBFS. Audio below the open
     threshold starts a region; audio above the close threshold ends it.
   - **Min silence** — minimum duration of dead air to propose a cut.
   - **Keep padding** — leeway preserved on each side of every region so
     consonants are never clipped.
   - **Min kept segment** — when applying two cuts would leave a sub-floor
     sliver between them, the two regions are merged into one (you get a
     cleaner cut rather than a stutter).
4. Click **Detect Silence**. A progress bar shows how far the worker has
   processed. Each region is listed with its **start**, **end**, **duration**,
   and **peak dB**.
5. For each row choose **Apply** (ripple-delete this region only), **Skip**
   (leave it in place), or click **Apply All** to commit every non-skipped
   region in one undo step.

After every Apply the panel rebases all later proposals to account for the
clips that just rolled left, so subsequent Applies always target the right
material.

## What it does on Apply

Each region is applied as an atomic **split-and-ripple**: the worker first
splits any affected clip at the region's start and end (so the silent slice
becomes its own clip ID), then ripple-deletes only that slice. Clips that
extend past the region are preserved. Markers inside the deleted range are
removed; markers after it shift left by the gap's length, the same as a hand
ripple.

## Limitations

- **Audio only.** The detector ignores video clips and title clips.
- **Worker-side analysis.** The detector runs in the pipeline worker — it
  reads bounded chunks from each clip via `pcmWindowAt`, so even a long
  recording does not allocate a multi-hundred-MB buffer.
- **Honest about overlaps.** When a region overlaps a clip that itself
  contains real audio outside the silent range (for example a screen-recording
  clip with narration plus quiet stretches), the split-trim step preserves the
  non-silent parts; you never lose a whole clip just because part of it
  contained quiet.

See also [Timeline editing](/docs/timeline-editing) and
[Exporting](/docs/exporting).
