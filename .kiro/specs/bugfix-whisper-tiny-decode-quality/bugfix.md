# Bugfix: Whisper-tiny decode quality thresholds

> Status: **Implemented.**

## Problem

Whisper-tiny produces horrendous transcription output compared to whisper-base
when run through the same LiteRT pipeline. The root cause is NOT preprocessing
or runtime invocation (both are model-agnostic and correct) — it is the
hardcoded decode quality-control thresholds in `whisper-decode.ts` that were
calibrated exclusively for whisper-base:

1. **Silence gate misfiring** (`noSpeechThreshold=0.6`, `logProbThreshold=-1.0`):
   whisper-tiny's smaller encoder produces systematically higher no-speech
   probabilities and lower avg-log-probabilities on real speech. The compound
   silence gate fires on windows that base handles fine, dropping entire
   segments.

2. **Temperature fallback trap** (`temperatures=[0,0.2,0.4,0.6,0.8,1.0]`):
   when the silence gate doesn't fire, low avgLogProb still marks the window as
   "low confidence" and triggers the full 6-step temperature schedule. Higher
   temperatures degrade tiny's output much more than base, producing
   hallucinations and repetition caught by the compression-ratio check.

3. **Compression ratio over-sensitivity** (`compressionRatioThreshold=2.4`):
   tiny is more prone to mild repetition even at low temperatures; the strict
   threshold rejects acceptable output.

## Root cause

The three constants (`LOGPROB_THRESHOLD`, `NO_SPEECH_THRESHOLD`,
`COMPRESSION_RATIO_THRESHOLD`) and the temperature schedule `TEMPERATURES` are
hardcoded from OpenAI's `transcribe.py`, which was validated against
whisper-medium and larger. Smaller models have a shifted confidence distribution
that needs more permissive thresholds and a truncated temperature schedule.

## Fix

Make these four parameters **manifest-configurable** via an optional `decode`
section in the model manifest:

```json
"decode": {
  "logProbThreshold": -1.5,
  "noSpeechThreshold": 0.75,
  "compressionRatioThreshold": 3.0,
  "temperatures": [0.0, 0.2, 0.4]
}
```

The decode loop reads thresholds from the manifest (falling back to the existing
defaults when the section is absent), so whisper-base behaviour is unchanged and
whisper-tiny (or any future model variant) can ship tuned parameters.

## Verification

- Unit tests confirm the silence gate, compression ratio, and temperature
  schedule all respect manifest-supplied `decodeParams`.
- The shipped `manifest-tiny.json` includes tuned parameters.
- `manifest.json` (base) includes explicit parameters matching the built-in
  defaults for documentation and forward-compatibility.
- `pnpm run check` passes (format, lint, typecheck, 1187 tests, prod build).
