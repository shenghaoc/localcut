# Bugfix: Phase 29 ASR Availability

> Status: **Active bugfix.** Phase 29 Auto Captions must not advertise or run
> transcription paths that cannot produce selected-clip captions.

## Problem

Phase 29 exposed Auto Captions when WebNN or Browser SpeechRecognition appeared
available, but neither path produced reliable selected-clip captions:

- the WebNN Whisper path was still a placeholder, so WebNN presence did not mean
  selected-audio ASR worked;
- Browser SpeechRecognition listens to live browser audio/mic input and cannot
  consume the PCM extracted from a selected timeline clip;
- empty ASR results could still create an empty generated captions track.

## Requirements

- Auto Captions must be unavailable until a real worker-backed selected-audio
  ASR engine is present.
- Browser SpeechRecognition must remain disabled for timeline clip
  transcription.
- WebNN probe information may remain diagnostic, but must not enable Phase 29 by
  itself.
- Empty or whitespace-only ASR results must be rejected before creating a
  caption track.
- The UI must explain the unavailable state without offering a fake fallback.

## Acceptance

- Capability and Auto Captions UI no longer advertise Browser SpeechRecognition
  as a Phase 29 fallback.
- Selecting a clip and requesting transcription cannot spawn the Chrome speech
  service path.
- Empty worker ASR results return a clear error and create no caption track.
