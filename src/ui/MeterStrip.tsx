import { createSignal, onMount } from 'solid-js';
import { levelToDb, meterHeightPercent, startMeterReader } from './meters';

interface MeterStripProps {
  meterSab: SharedArrayBuffer | null;
}

function MeterBar(props: { label: string; peak: () => number; rms: () => number }) {
  return (
    <div class="meter-channel" aria-hidden="true">
      <div class="meter-bar">
        <div
          class="meter-rms"
          style={{ height: `${meterHeightPercent(props.rms())}%` }}
        />
        <div
          class="meter-peak"
          style={{ height: `${meterHeightPercent(props.peak())}%` }}
        />
      </div>
      <span class="meter-label">{props.label}</span>
      <span class="meter-db tabular-nums">{levelToDb(props.peak()).toFixed(0)}</span>
    </div>
  );
}

export function MeterStrip(props: MeterStripProps) {
  const [peakL, setPeakL] = createSignal(0);
  const [peakR, setPeakR] = createSignal(0);
  const [rmsL, setRmsL] = createSignal(0);
  const [rmsR, setRmsR] = createSignal(0);

  onMount(() =>
    startMeterReader(props.meterSab, (levels) => {
      setPeakL(levels.peakL);
      setPeakR(levels.peakR);
      setRmsL(levels.rmsL);
      setRmsR(levels.rmsR);
    }),
  );

  return (
    <div class="meter-strip" role="meter" aria-label="Master output levels">
      <MeterBar label="L" peak={peakL} rms={rmsL} />
      <MeterBar label="R" peak={peakR} rms={rmsR} />
    </div>
  );
}
