# Design: Remove the Chrome Speech fallback (Phase 29)

## Scope

Removal only. This bugfix deletes the dead Chrome Speech fallback and its probe
surface. It adds **no** new ASR runtime or model bundle — that is PR #94
(LiteRT-over-WebNN Whisper).

## Behavior

`probeAsr()` reports the WebNN probe as a diagnostic only and always returns
`recommended: 'none'`; `asrAvailable()` is therefore `false`. The probe no longer
carries a `speechRecognition` field — `AsrProbeResult` is `{ webnn, recommended }`.

The Chrome Speech adapter (`chrome-speech.ts`) and its ambient typings
(`web-speech.d.ts`) are gone, and the controller never imports them. All
selected-clip transcription must go through the worker-backed ASR command path.

The Auto Captions panel and the Capability matrix state the unavailable status
plainly and offer no browser fallback. `ASR_UNAVAILABLE_MESSAGE` points users at
the upcoming on-device WebNN engine instead of Browser SpeechRecognition.

Before creating a generated caption track, the controller still validates that at
least one returned segment contains non-whitespace text; empty results surface a
clear error instead of creating an empty track.

## Follow-up

PR #94 provides the real selected-audio path: an on-device **LiteRT Whisper**
runtime leveraging **WebNN**. It owns its own Kiro spec and re-enables Auto
Captions once it transcribes extracted PCM directly. No other engine (Browser
SpeechRecognition, cloud APIs) is on the table.
