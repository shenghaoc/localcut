# Tasks: Loop playback

> Status: **Active**. Tasks map to the requirements in `requirements.md` and the
> design in `design.md`. Tracks the work on `claude/video-player-loop-75h30f`.

## T1 — PlaybackController loop support (R1, R2.4)

- [x] **T1.1** Add `loop?: boolean` and `onLoopRestart?: (time: number) => void`
  to `PlaybackDeps` in `src/engine/playback.ts`.
- [x] **T1.2** Add a private `loop` field initialised from `deps.loop`, plus
  `setLoop(enabled)` and `isLooping()`.
- [x] **T1.3** In the `runLoop` tick's end-of-timeline branch, add the loop path
  before the halt: re-check generation, call `onLoopRestart(0)`, reset
  `currentTime` to 0, `writeClock(0, true)`, `runLoop()`, return. Leave the halt
  path unchanged for the loop-off default.

## T2 — Worker wiring (R1.5, R2, R3.4, R4)

- [x] **T2.1** Add module-level `let loopEnabled = false;` in `worker.ts`,
  documented as surviving `setupPlayback` rebuilds like the play state.
- [x] **T2.2** Pass `loop: loopEnabled` and
  `onLoopRestart: (time) => resetAudioRingForSeek(time)` into the
  `PlaybackController` constructed in `setupPlayback`.
- [x] **T2.3** Add `handleSetLoop(enabled)` setting both `loopEnabled` and
  `playback?.setLoop(enabled)`.
- [x] **T2.4** Add `case 'set-loop': handleSetLoop(cmd.enabled)` to the message
  dispatch.

## T3 — Protocol (R4)

- [x] **T3.1** Add `| { type: 'set-loop'; enabled: boolean }` to `WorkerCommand`
  in `src/protocol.ts`.

## T4 — Transport button (R3)

- [x] **T4.1** Add `loop: () => boolean` and `onToggleLoop: () => void` to
  `ToolbarProps`; import the `Repeat` icon.
- [x] **T4.2** Add the loop toggle `Button` to the `transport-controls` group
  after step-forward: `Repeat` icon, accent `variant` when on, `aria-pressed`,
  state-describing `title`, disabled with the rest of the transport.
- [x] **T4.3** In `App.tsx`, add a `loopPlayback` signal; wire `loop` and
  `onToggleLoop` (flip the signal + send `set-loop`) into `<Toolbar>`.

## T5 — Documentation (R5)

- [x] **T5.1** Add the loop button to the transport table and a short paragraph
  in `src/features/docs/content/timeline-editing.md`.

## T6 — Tests and gate (R6)

- [x] **T6.1** `playback.test.ts`: halt-at-end (loop off, default).
- [x] **T6.2** `playback.test.ts`: wrap-to-start while playing (loop on).
- [x] **T6.3** `playback.test.ts`: `setLoop` toggles behaviour live mid-playback.
- [x] **T6.4** `vp run check` green (format + lint + typecheck + Vitest + build);
  test count grows (22 in `playback.test.ts`).

## T7 — Manual verification

- [ ] **T7.1** With loop **off**, play to the end — playback stops on the last
  frame (unchanged behaviour).
- [ ] **T7.2** Toggle loop **on**, play to the end — playback wraps to the start
  and keeps going; the button is highlighted.
- [ ] **T7.3** On a timeline with audio, confirm audio restarts in sync on each
  wrap (no frozen-at-last-frame loop, no audio drift).
- [ ] **T7.4** Toggle loop on while playing mid-timeline — the current frame is
  not interrupted; the wrap happens at the next end crossing.
