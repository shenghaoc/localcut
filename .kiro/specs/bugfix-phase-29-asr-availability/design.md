# Design: Phase 29 ASR Availability

## Scope

This bugfix makes the merged Phase 29 feature honest. It does not add a new ASR
runtime or model bundle.

## Behavior

`probeAsr()` still records WebNN and Browser SpeechRecognition diagnostics, but
returns `recommended: 'none'`. `asrAvailable()` therefore keeps Auto Captions
unavailable until a real selected-audio engine lands.

The controller no longer imports or calls the Chrome speech adapter. All
selected-clip transcription must go through a worker-backed ASR command path.

Before creating a generated caption track, the controller validates that at
least one returned segment contains non-whitespace text. Empty results surface a
clear error instead of creating an empty track.

## Follow-up

The follow-up implementation will provide the real selected-audio Whisper path
and can re-enable Auto Captions once it transcribes extracted PCM directly.
