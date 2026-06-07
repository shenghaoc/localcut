import { createSignal, onCleanup } from 'solid-js';

/** Transport snapshot delivered by the worker over postMessage in non-SAB tiers. */
export interface ClockUpdate {
  currentTime: number;
  duration: number;
  playing: boolean;
}

/** Layout: [0] currentTime, [1] duration, [2] playState, [3] audioClock. */
export function createSharedClock(sab: SharedArrayBuffer | null) {
  const view = sab ? new Float64Array(sab) : null;
  const [currentTime, setCurrentTime] = createSignal(0);
  const [duration, setDuration] = createSignal(0);
  const [playing, setPlaying] = createSignal(false);

  // SAB path: poll shared memory each frame. Without SAB the rAF reader would only
  // ever observe zeros, so it is skipped entirely and the clock is driven by
  // `applyUpdate` from worker `clock-update` messages instead.
  if (view) {
    let rafId = 0;
    const tick = () => {
      setCurrentTime(view[0] ?? 0);
      setDuration(view[1] ?? 0);
      setPlaying((view[2] ?? 0) === 1);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    onCleanup(() => cancelAnimationFrame(rafId));
  }

  // The worker is the sole writer of the clock in both paths: with SAB it writes
  // shared memory (read above via rAF); without SAB it posts `clock-update`
  // messages that the message handler forwards here. The main thread never writes.
  function applyUpdate(next: ClockUpdate) {
    setCurrentTime(next.currentTime);
    setDuration(next.duration);
    setPlaying(next.playing);
  }

  return { currentTime, duration, playing, applyUpdate };
}
