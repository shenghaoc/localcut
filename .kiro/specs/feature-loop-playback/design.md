# Design: Loop playback

This maps each requirement in `requirements.md` to the concrete change and the
invariant it protects. All edits stay within existing modules; one new
main-thread → worker message type is introduced (`set-loop`). No new worker,
rendering pass, or audio-ring protocol is added.

## Architecture context

Preview transport lives in `PlaybackController` (`src/engine/playback.ts`),
driven inside the pipeline worker. The worker is the **sole writer** of the
shared clock; the main thread reads it in rAF. When the timeline has audio, the
audio worklet (`public/audio-playback.worklet.js`) is the master clock:
`PlaybackController` reads `getMasterTime()` (the SAB `AUDIO_CLOCK`) to pick the
frame to render, and the worklet advances `AUDIO_CLOCK` from a `timelineAnchor`
as it consumes the ring.

The pre-existing end-of-timeline branch in the real-time loop set
`this.playing = false`, wrote a stopped clock, and returned — the halt.

## D1 — Loop flag and wrap branch (R1)

`src/engine/playback.ts`

`PlaybackDeps` gains `loop?: boolean` (initial state) and
`onLoopRestart?: (time: number) => void`. `PlaybackController` holds a private
`loop` field initialised from `deps.loop`, plus `setLoop(enabled)` /
`isLooping()` for live toggling and inspection.

The end-of-timeline branch in `runLoop`'s `tick` gains a loop path that runs
**before** the existing halt:

```ts
if (this.deps.duration > 0 && target >= this.deps.duration) {
  if (this.loop) {
    if (gen !== this.generation) return;
    this.deps.onLoopRestart?.(0);   // host resets audio at the loop point
    this.currentTime = 0;
    this.deps.writeClock(0, true);  // keep the clock in the playing state
    this.runLoop();                 // re-anchor wall clock + master at 0
    return;
  }
  // ...unchanged halt: render final frame, playing = false, return
}
```

Why `runLoop()` rather than mutating the anchors in place: `runLoop` already
re-captures `anchorWall = now()` and `anchorMedia = currentTime` and bumps the
generation (cancelling the current tick), which is exactly the re-anchor a wrap
needs. The trailing `return` prevents the stale tick from rescheduling, so there
is never a double-scheduled loop. For the no-audio case this re-anchor alone is
sufficient; for the audio case `onLoopRestart` makes `getMasterTime()` report ~0
on the next tick instead of the end.

R1.4 (live toggle, no interruption): `setLoop` only flips the field. Playback
keeps running; the new value is read at the next end crossing. No re-seek.

## D2 — Audio re-anchor on wrap (R2)

`src/engine/worker.ts`

`setupPlayback()` passes `loop: loopEnabled` and
`onLoopRestart: (time) => resetAudioRingForSeek(time)` into the controller.

`resetAudioRingForSeek` is the **same** function the playing-seek path already
calls (`handleSeek` → `resetAudioRingForSeek`): it bumps the ring generation,
resets the ring pointers, re-anchors the worker's audio write pump
(`audioWriteAnchor`/`audioWriteFrames`), clears the live WSOLA stretchers, and
sets `AUDIO_CLOCK`/`CURRENT_TIME` to the target.

The worklet picks this up for free: `syncGeneration()` (run first in every
`process()`) detects the generation bump and re-anchors `timelineAnchor` to the
freshly-written `AUDIO_CLOCK` (0), zeroes `framesConsumed`, and resets the read
cursor. No worklet message and no main-thread audio-engine call is needed — the
wrap is entirely worker-driven and reuses a path already exercised by every
play-while-seek. (R2.2)

`onLoopRestart` is a no-op when there is no audio ring, so audio-less timelines
loop on the video clock alone via the `runLoop()` re-anchor. (R2.3)

The wrap reuses the existing render/close path unchanged, so the
`VideoFrame`-closed-exactly-once and single-submission invariants hold. (R2.4)

## D3 — Loop-state ownership across rebuilds (R1.5)

`src/engine/worker.ts`

A module-level `let loopEnabled = false;` holds the toggle outside the
`PlaybackController`, mirroring how `wasPlaying`/play state survives the
`playback?.dispose()` + reconstruction inside `setupPlayback`. `handleSetLoop`
updates both the module flag and the live controller:

```ts
function handleSetLoop(enabled: boolean) {
  loopEnabled = enabled;
  playback?.setLoop(enabled);
}
```

The message dispatch gains `case 'set-loop': handleSetLoop(cmd.enabled)`.

`loopEnabled` is reset to `false` on every project-replacement path so it cannot
survive past the project it belongs to: `teardownMedia()` (new project / restore /
shutdown) and `applyImportedDoc()` (bundle load). It deliberately does **not**
reset in the per-edit `setupPlayback` rebuilds. The UI mirror resets in lockstep
on the matching handlers — `resetProjectUiState` (new project), the
`restore-result` handler, and the `bundle-import-result` ok branch — so the
worker and UI never disagree about whether loop is on. (R1.6)

## D4 — Protocol (R4)

`src/protocol.ts`

`WorkerCommand` gains `| { type: 'set-loop'; enabled: boolean }`.

## D5 — Transport button (R3)

`src/ui/Toolbar.tsx`

`ToolbarProps` gains `loop: () => boolean` and `onToggleLoop: () => void`. A new
icon `Button` is added to the `transport-controls` group after step-forward,
using the lucide `Repeat` icon, `variant={props.loop() ? 'default' : 'secondary'}`
for the highlight, `aria-pressed={props.loop()}`, and a state-describing `title`
("Loop: on (replays at the end)" / "Loop: off (stops at the end)"). It is
disabled with the rest of the transport via the existing `transportDisabled()`.

`src/ui/App.tsx`

A `loopPlayback` signal mirrors the worker state for the button. `onToggleLoop`
flips it and sends one `set-loop` command:

```ts
onToggleLoop={() => {
  const enabled = !loopPlayback();
  setLoopPlayback(enabled);
  bridge?.send({ type: 'set-loop', enabled });
}}
```

The toggle does not touch the main-thread `audioEngine` — the worker's wrap
re-anchors audio through the ring generation, so the main thread only needs to
reflect state.

## D6 — Documentation (R5)

`src/features/docs/content/timeline-editing.md`

The transport table gains a **Loop → toolbar loop button** row and a short
paragraph: playback stops at the end by default; the loop button (⟳) wraps it
back to the start, is off by default, and highlights when on.

## D7 — Tests (R6)

`src/engine/playback.test.ts`

Three new `PlaybackController` cases using the existing injectable
`now`/`scheduler` harness:

- **halts at the end when loop is off (default)** — past-end tick sets
  `isPlaying() === false`, `getCurrentTime() === duration`, last `writeClock`
  call is `(duration, false)`, and `onLoopRestart` is never called.
- **wraps to the start and keeps playing when loop is on** — past-end tick fires
  `onLoopRestart(0)`, leaves `getCurrentTime() === 0`, `isPlaying() === true`,
  last `writeClock` `(0, true)`, and schedules a fresh tick.
- **setLoop toggles wrap behaviour live without interrupting playback** —
  `setLoop(true)` mid-playback causes the next past-end tick to wrap.

The wrap branch is synchronous up to the first `await`, so the loop tests assert
directly after invoking the scheduled tick; the halt test polls with
`vi.waitFor` because that branch awaits `renderAt`.

No tests are removed.
