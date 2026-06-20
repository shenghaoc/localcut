# Recording

LocalCut's Record panel turns screen, camera, microphone, and tab audio captures into editable timeline material. Recording runs in the browser and writes chunks to private browser storage while the session is active.

## Requirements

Recording needs a recent Chromium browser with display capture, `MediaStreamTrackProcessor`, realtime WebCodecs encode, and OPFS `SyncAccessHandle`. When a probe is missing, the Record panel stays visible and lists the missing capability instead of hiding the workflow.

Transferable `MediaStreamTrack` is **not** required: when it is available the source track is transferred into the pipeline worker (the accelerated _worker-track_ path); when it is not, the Record panel shows a "compatibility recording mode" note and reads frames on the main thread, forwarding them to the worker encoder (the _main-frames_ fallback). Enable `chrome://flags/#enable-experimental-web-platform-features` for the faster worker-track path. Program Mode has no main-frames fallback yet, so it still requires transferable tracks.

Safari and Firefox do not currently expose the full capture stack needed by this implementation. They show the disabled panel with per-probe reasons.

## Countdown

The Record panel supports three countdown settings:

- **0 s** starts immediately.
- **3 s** gives a short default countdown before capture begins.
- **5 s** gives more time to switch windows or prepare the screen.

The countdown setting is device-scoped and stored in private browser storage. It is not written into project bundles.

Press **Cancel** or **Escape** during the countdown to return to idle without starting a session.

## Pause And Resume

Pause drains and closes the active encoders before the session enters the paused state. Resume starts a new chunk epoch on the first encoded frame after capture continues.

When the recording lands on the timeline, paused gaps are collapsed. The clips continue from the resume point without blank timeline space, and the timeline receives seam markers named **Resume 1**, **Resume 2**, and so on. These markers show where a paused gap was removed.

## Sources

Add sources from the Record panel:

- **Add screen** opens the browser screen-share picker. Enable tab/system audio before adding the source when you want the browser to request audio with the display stream.
- **Camera** adds a webcam track.
- **Mic** adds a microphone track.

Sources are not premixed while recording. Each captured source lands as its own source and timeline clip so it can be edited separately.

You can add sources while recording or paused. The session appends a source-added manifest record, and the new source lands at its first encoded timestamp relative to the session.

## Webcam PiP Layout

When a webcam source is present, the Record panel shows a layout preset:

- Four corners: top-left, top-right, bottom-left, bottom-right.
- Three sizes: S, M, and L.
- Margin: 0 to 64 px.

The monitor tile in the Record panel is only a layout preview. The preset is applied when the recording lands, using ordinary clip transform values so you can adjust the webcam position in the Inspector afterward.

The layout preset is stored in private browser storage and is not included in project bundles.

## Recorder Controls

During recording, the lightweight recorder strip provides elapsed time, paused time, pause/resume, and stop controls.

On Chromium builds that support Document Picture-in-Picture, the strip opens in a small always-on-top PiP window. If Document PiP is unavailable or fails to open, the same controls remain available as an in-page floating strip. Safari and Firefox use the in-page fallback when the rest of the capture stack is unavailable in future browser versions.

## Region And Element Capture

Region Capture and Element Capture are experimental Chromium-only options for own-tab captures.

- **Own tab (Region)** crops an existing tab source to a selected element's region using `CropTarget`.
- **Own tab (Element)** restricts an existing tab source to a selected element using `RestrictionTarget`.

Add a tab source first, then choose the experimental option and click the element to capture. The session records the change in the capture manifest as a region-applied record.

These APIs are browser-owned and may be unavailable depending on Chrome version, origin, and source type.

## Retakes

Captured clips show a **Retake** action in the Inspector. Retake switches the Record panel into retake mode for that clip and lists the fresh source kinds needed to match the original recording. Add the matching sources again; once they are present, the normal countdown starts.

After the new recording lands, the selected clip keeps its clip id, transform, and keyframes, but its source and duration are replaced with the new recording. Undo restores the previous clip state. The old recording remains in the media bin so no captured media is silently discarded.

Retake is disabled while another recording session is active or paused.
