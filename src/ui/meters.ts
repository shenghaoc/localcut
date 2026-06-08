/** rAF reader for AudioWorklet peak/RMS meters in the meter SAB. */

import { MeterIndex } from '../protocol';

export interface MeterLevels {
	peakL: number;
	peakR: number;
	rmsL: number;
	rmsR: number;
}

export function readMeterLevels(meterSab: SharedArrayBuffer | null): MeterLevels {
	if (!meterSab) {
		return { peakL: 0, peakR: 0, rmsL: 0, rmsR: 0 };
	}
	const view = new Float32Array(meterSab);
	return {
		peakL: view[MeterIndex.PEAK_L] ?? 0,
		peakR: view[MeterIndex.PEAK_R] ?? 0,
		rmsL: view[MeterIndex.RMS_L] ?? 0,
		rmsR: view[MeterIndex.RMS_R] ?? 0
	};
}

export function startMeterReader(
	meterSab: SharedArrayBuffer | null,
	onLevels: (levels: MeterLevels) => void
): () => void {
	let frame = 0;
	const tick = () => {
		onLevels(readMeterLevels(meterSab));
		frame = requestAnimationFrame(tick);
	};
	frame = requestAnimationFrame(tick);
	return () => cancelAnimationFrame(frame);
}

export function levelToDb(level: number): number {
	const clamped = Math.max(0, level);
	if (clamped <= 1e-6) return -60;
	return Math.max(-60, 20 * Math.log10(clamped));
}

export function meterHeightPercent(level: number): number {
	const db = levelToDb(level);
	return Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
}
