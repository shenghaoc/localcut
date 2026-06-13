# Bugfix: Remove the Chrome Speech fallback from Phase 29 Auto Captions

> Status: **Active bugfix.** Phase 29 Auto Captions must not advertise or run a
> fallback that cannot produce selected-clip captions.

## Problem

Phase 29 (PR #65) shipped Auto Captions as a merged feature with two paths, and
**neither produced working selected-clip captions**:

- the WebNN Whisper path was a placeholder — the worker reported the model as
  `loaded` without building a graph or loading weights, and transcription threw;
- Browser SpeechRecognition (the "Chrome Speech service") was wired as a
  fallback, but it listens to live mic/page audio and **cannot consume the PCM
  extracted from a selected timeline clip**.

There is no practical browser fallback for selected-clip ASR. Keeping the Chrome
Speech service only steered users toward a path that could never work and made
the feature look more capable than it was.

## Decision

Remove the Chrome Speech service entirely — the adapter, its ambient typings,
the `speechRecognition` capability probe field, and every "Browser Speech
disabled for clips" UI label. Do not present a fallback that does not exist.

Auto Captions stay **unavailable** (`probeAsr` returns `recommended: 'none'`,
`asrAvailable` is `false`) until a real on-device engine lands. The empty-result
guard is retained so a future engine cannot create an empty caption track.

## Path forward

The **only** solution going forward is the on-device **LiteRT-over-WebNN
Whisper** engine tracked by **PR #94**. This bugfix deliberately adds no
replacement runtime; it removes the dead fallback and the misleading surface so
PR #94 lands against an honest baseline.

## Acceptance

- No `SpeechRecognition` / Chrome Speech code, typings, probe field, or UI copy
  remains in the Phase 29 surface.
- `probeAsr()` exposes WebNN as a diagnostic only and never recommends an engine.
- The Auto Captions and Capability UI state the unavailable state honestly and
  offer no browser fallback.
- Empty or whitespace-only ASR results still return a clear error and create no
  caption track.
- `pnpm run check` is green.
