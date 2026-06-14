# Design: Whisper-tiny decode quality thresholds

## Approach

Extend the model manifest with an optional `decode` section carrying
per-model quality parameters. The decode loop in `whisper-decode.ts` reads
these at transcription time, falling back to the existing hardcoded defaults
for backwards compatibility with manifests that omit the section.

## Schema extension

```typescript
// src/protocol.ts — new interface
export interface AsrDecodeParams {
  logProbThreshold?: number;       // default -1.0
  noSpeechThreshold?: number;      // default 0.6
  compressionRatioThreshold?: number; // default 2.4
  temperatures?: number[];         // default [0, 0.2, 0.4, 0.6, 0.8, 1.0]
}

// AsrModelManifestSnapshot gains:
decode?: AsrDecodeParams | null;
```

## Data flow

```
manifest.json
  → validateAsrManifest() (model-manifest.ts) validates decode section
  → manifest.decode stored in LoadedModel
  → asr-worker.ts passes manifest.decode to transcribeWindow()
  → transcribeWindow reads dp.logProbThreshold ?? DEFAULT, etc.
  → silence gate, temperature loop, compression ratio all use resolved values
```

## Whisper-tiny tuned values

| Parameter | Base (default) | Tiny (tuned) | Rationale |
|-----------|---------------|--------------|-----------|
| logProbThreshold | -1.0 | -1.5 | Tiny's avgLogProb is ~0.3–0.5 lower on identical audio |
| noSpeechThreshold | 0.6 | 0.75 | Tiny's no-speech probes are elevated on real speech |
| compressionRatioThreshold | 2.4 | 3.0 | Tiny's mild repetition at greedy is still useful |
| temperatures | [0,0.2,0.4,0.6,0.8,1.0] | [0,0.2,0.4] | Higher temps hallucinate with tiny |

## Files changed

| File | Change |
|------|--------|
| `src/protocol.ts` | Add `AsrDecodeParams` interface; add optional `decode` to manifest |
| `src/engine/asr/model-manifest.ts` | Validate new `decode` section |
| `src/engine/asr/whisper-decode.ts` | Accept `decodeParams` in params; use resolved thresholds |
| `src/engine/asr/asr-worker.ts` | Pass `manifest.decode` through to transcribeWindow |
| `public/models/whisper/manifest.json` | Explicit decode section (matches defaults) |
| `public/models/whisper/manifest-tiny.json` | Tuned decode section for tiny |
| `src/engine/asr/model-manifest.test.ts` | Tests for decode param validation |
| `src/engine/asr/whisper-decode.test.ts` | Tests for configurable thresholds |

## Backwards compatibility

Omitting the `decode` section (or any individual field within it) preserves the
existing behaviour — the code falls back to `DEFAULT_*` constants. Existing
manifests or user-authored manifests that predate this change continue to work
identically.
