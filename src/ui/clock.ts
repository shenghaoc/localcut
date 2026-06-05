import { createSignal, onCleanup } from 'solid-js';

/** Layout: [0] currentTime, [1] duration, [2] playState, [3] audioClock. */
export function createSharedClock(sab: SharedArrayBuffer | null) {
  const view = sab ? new Float64Array(sab) : null;
  const [currentTime, setCurrentTime] = createSignal(0);
  const [duration, setDuration] = createSignal(0);
  const [playing, setPlaying] = createSignal(false);

  let rafId = 0;
  function tick() {
    setCurrentTime(view?.[0] ?? 0);
    setDuration(view?.[1] ?? 0);
    setPlaying((view?.[2] ?? 0) === 1);
    rafId = requestAnimationFrame(tick);
  }
  rafId = requestAnimationFrame(tick);

  onCleanup(() => cancelAnimationFrame(rafId));

  // The worker is the sole writer of the clock buffer; the main thread only
  // reads (here, via rAF). Duration is published by the worker on import and
  // surfaces through the `duration` signal above — no main-thread SAB writes.
  return { currentTime, duration, playing };
}
