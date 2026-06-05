import { createSignal, onCleanup } from 'solid-js';

/** Layout: [0] currentTime, [1] duration, [2] playState (0 paused, 1 playing). */
export function createSharedClock(sab: SharedArrayBuffer) {
  const view = new Float64Array(sab);
  const [currentTime, setCurrentTime] = createSignal(0);
  const [duration, setDuration] = createSignal(0);
  const [playing, setPlaying] = createSignal(false);

  let rafId = 0;
  function tick() {
    setCurrentTime(view[0] ?? 0);
    setDuration(view[1] ?? 0);
    setPlaying((view[2] ?? 0) === 1);
    rafId = requestAnimationFrame(tick);
  }
  rafId = requestAnimationFrame(tick);

  onCleanup(() => cancelAnimationFrame(rafId));

  function setDurationMain(seconds: number) {
    view[1] = seconds;
    setDuration(seconds);
  }

  return { currentTime, duration, playing, setDurationMain, view };
}
