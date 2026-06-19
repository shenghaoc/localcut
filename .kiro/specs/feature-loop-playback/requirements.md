# Requirements: Loop playback

> Status: **Active**. Adds a loop toggle to the transport so preview playback
> wraps to the start at the end of the timeline instead of halting. Tracks the
> work on `claude/video-player-loop-75h30f`.

## Motivation

Preview playback stops dead when the playhead reaches the timeline duration; the
only way to replay is to scrub back to the start and hit play again. Reviewing a
cut on repeat — the single most common reason to watch a timeline — is a
manual, repetitive chore. A loop toggle makes the transport wrap automatically.

## R1 — Loop transport behaviour

- **R1.1** When loop is **on** and playback reaches the end of the timeline, the
  playhead wraps to the start (time 0) and playback continues without stopping.
- **R1.2** When loop is **off**, playback halts at the end exactly as before
  (current behaviour is preserved bit-for-bit on the default path).
- **R1.3** Loop is **off by default**.
- **R1.4** Toggling loop while playback is running takes effect on the next
  end-of-timeline crossing; it never interrupts the frame currently playing,
  re-seeks, or restarts the loop mid-stream.
- **R1.5** The loop state survives `PlaybackController` rebuilds (the controller
  is recreated on edits, format changes, and source additions) the same way the
  play/pause state already does.
- **R1.6** The loop state resets to off-by-default when the project is replaced —
  new project, autosave restore, or project-bundle load — on **both** the worker
  (`loopEnabled`) and the UI mirror (`loopPlayback`), so the two never desync.

## R2 — Audio/video sync on wrap

- **R2.1** When the timeline has audio, wrapping re-anchors the audio master
  clock at the loop point so audio and video restart together; the audio master
  clock must not keep reporting the end (which would immediately re-trigger the
  wrap and freeze the loop at the last frame).
- **R2.2** The wrap re-uses the existing playing-seek audio path (ring generation
  bump + pointer reset); no new audio ring protocol or worklet message is added.
- **R2.3** Timelines with no audio loop correctly on the video clock alone.
- **R2.4** No `VideoFrame` is leaked or double-closed across a wrap; the
  single-submission-per-frame and zero-copy invariants are unchanged.

## R3 — Transport control

- **R3.1** A loop toggle button lives in the transport control group, next to
  step-forward, using the lucide `Repeat` icon.
- **R3.2** The button reflects state: highlighted (primary accent) when on,
  neutral when off, with `aria-pressed` and a state-describing `title`.
- **R3.3** The button is disabled whenever the rest of the transport is disabled
  (no decodable preview surface).
- **R3.4** Toggling the button sends a single `set-loop` command to the worker
  and mirrors the state in the UI.

## R4 — Protocol

- **R4.1** A new `{ type: 'set-loop'; enabled: boolean }` main-thread → worker
  command carries the toggle; the worker is the sole owner of the wrap behaviour.

## R5 — Documentation

- **R5.1** The in-app User Guide transport table
  (`src/features/docs/content/timeline-editing.md`) documents the loop button and
  that playback otherwise stops at the end.

## R6 — Testing

- **R6.1** Unit tests cover: halt-at-end when loop is off (default), wrap-to-start
  while playing when loop is on (with `onLoopRestart` fired and the controller
  still playing), and `setLoop` toggling the behaviour live mid-playback.
- **R6.2** `vp run check` (format + lint + typecheck + Vitest + production build)
  stays green; the test count grows.

## Non-goals

- No loop **region** (in/out loop points) — looping is whole-timeline only.
- No keyboard shortcut: `L` is already Play (J/K/L convention) and is not
  reassigned.
- Loop state is a session transport toggle; it is **not** persisted in the
  project document or autosave.
- No change to export — looping is a preview-transport concern only.
