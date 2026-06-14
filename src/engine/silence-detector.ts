/** Silence / dead-air detection — Phase 44 T1.
 *
 *  Pure TypeScript analysis function. Runs inside the pipeline worker over
 *  pre-mixed mono PCM at 48 kHz. Deterministic: identical inputs always
 *  produce byte-identical outputs.
 */

/** Tunable detection parameters. */
export interface SilenceDetectionParams {
	/** RMS below this dBFS opens a silence region (default −42). */
	openThreshold: number;
	/** RMS at or above this dBFS closes a silence region (default −36; must be ≥ openThreshold). */
	closeThreshold: number;
	/** Minimum consecutive silence duration in seconds to keep a region (default 0.6). */
	minSilence: number;
	/** Inward contraction on each side of a detected region in seconds (default 0.15). */
	keepPadding: number;
	/** Minimum kept-segment gap; adjacent regions whose kept gap < this are merged (default 0.3). */
	minKeptSegment: number;
	/** Sample rate of the input PCM (always 48 000). */
	sampleRate: number;
	/** RMS window size in samples (always 960 → 20 ms at 48 kHz). */
	windowSamples: number;
	/** Hop size in samples (always 480 → 10 ms at 48 kHz). */
	hopSamples: number;
}

/** A detected silent region (post-padding contraction). */
export interface SilenceRegion {
	/** Start time in seconds (after keep-padding inward contraction). */
	startS: number;
	/** End time in seconds (after keep-padding inward contraction). */
	endS: number;
	/** Highest RMS dB observed within the region (always ≤ openThreshold). */
	peakDb: number;
}

/** Default parameter values from R1.2–R1.4. */
export const SILENCE_DEFAULTS: SilenceDetectionParams = {
	openThreshold: -42,
	closeThreshold: -36,
	minSilence: 0.6,
	keepPadding: 0.15,
	minKeptSegment: 0.3,
	sampleRate: 48000,
	windowSamples: 960,
	hopSamples: 480
};

/** dBFS conversion floor to avoid −Infinity from log10(0). */
const DB_FLOOR = 1e-9;

/**
 * Detect silent regions in pre-mixed mono PCM at 48 kHz.
 *
 * The algorithm is fully specified in the Phase 44 design doc:
 * 1. Sliding-window RMS at 960-sample windows / 480-sample hops.
 * 2. dB conversion with 1e-9 floor.
 * 3. Two-threshold hysteresis state machine.
 * 4. Duration gate (discard if < minSilence).
 * 5. Keep-padding contraction (discard if ≤ 0 s).
 * 6. Minimum-kept-segment merge pass (repeat until stable).
 * 7. peakDb per final region.
 *
 * @param pcm Interleaved mono Float32Array at params.sampleRate.
 * @param params Detection parameters.
 * @returns Array of detected silent regions sorted by startS ascending.
 */
export function detectSilence(pcm: Float32Array, params: SilenceDetectionParams): SilenceRegion[] {
	const {
		openThreshold,
		closeThreshold,
		minSilence,
		keepPadding,
		minKeptSegment,
		sampleRate,
		windowSamples,
		hopSamples
	} = params;

	// Guard: inverted thresholds produce no results.
	if (closeThreshold < openThreshold) return [];

	const pcmLength = pcm.length;
	if (pcmLength < windowSamples) return [];

	// ── Step 1–2: sliding-window RMS → dB ──────────────────────────────

	interface WindowDb {
		/** Start sample index of this window. */
		startSample: number;
		/** Start time in seconds. */
		startS: number;
		/** RMS dB value. */
		db: number;
	}

	const windows: WindowDb[] = [];
	for (let offset = 0; offset + windowSamples <= pcmLength; offset += hopSamples) {
		let sumSq = 0;
		for (let i = 0; i < windowSamples; i++) {
			const v = pcm[offset + i]!;
			sumSq += v * v;
		}
		const rms = Math.sqrt(sumSq / windowSamples);
		const db = 20 * Math.log10(Math.max(rms, DB_FLOOR));
		windows.push({ startSample: offset, startS: offset / sampleRate, db });
	}

	if (windows.length === 0) return [];

	// ── Step 3: hysteresis state machine ────────────────────────────────

	type State = 'CLOSED' | 'OPEN';
	let state: State = 'CLOSED';
	let openStartS = 0;
	/** Track the peak dB within the current open region (pre-padding). */
	let openPeakDb = 0;
	/** Candidate regions before padding (pre-padding boundaries). */
	const candidates: { startS: number; endS: number; peakDb: number }[] = [];

	const pcmDurationS = pcmLength / sampleRate;

	for (const w of windows) {
		if (state === 'CLOSED') {
			if (w.db < openThreshold) {
				state = 'OPEN';
				openStartS = w.startS;
				openPeakDb = w.db;
			}
		} else {
			// state === 'OPEN'
			if (w.db >= closeThreshold) {
				// Close: emit candidate if duration ≥ minSilence.
				// peakDb is the max across all windows strictly within the silence region
				// (excluding the closing window which is above threshold).
				const duration = w.startS - openStartS;
				if (duration >= minSilence) {
					candidates.push({ startS: openStartS, endS: w.startS, peakDb: openPeakDb });
				}
				state = 'CLOSED';
			} else {
				// Still below closeThreshold — update peak.
				openPeakDb = Math.max(openPeakDb, w.db);
			}
		}
	}

	// End-of-PCM: if still open, emit candidate.
	if (state === 'OPEN') {
		const duration = pcmDurationS - openStartS;
		if (duration >= minSilence) {
			candidates.push({ startS: openStartS, endS: pcmDurationS, peakDb: openPeakDb });
		}
	}

	// ── Step 4 (already handled): duration gate in the loop above. ─────

	// ── Step 5: keep-padding contraction ───────────────────────────────

	let regions: SilenceRegion[] = candidates
		.map((c) => ({
			startS: c.startS + keepPadding,
			endS: c.endS - keepPadding,
			peakDb: c.peakDb
		}))
		.filter((r) => r.endS > r.startS);

	// ── Step 6: minimum-kept-segment merge pass (repeat until stable) ──

	let merged = true;
	while (merged) {
		merged = false;
		const next: SilenceRegion[] = [];
		for (let i = 0; i < regions.length; i++) {
			const current = regions[i]!;
			if (i + 1 < regions.length) {
				const following = regions[i + 1]!;
				const gap = following.startS - current.endS;
				if (gap < minKeptSegment) {
					// Merge: extend current to cover following, take higher peakDb.
					next.push({
						startS: current.startS,
						endS: following.endS,
						peakDb: Math.max(current.peakDb, following.peakDb)
					});
					i++; // Skip the following region.
					merged = true;
					continue;
				}
			}
			next.push(current);
		}
		regions = next;
	}

	// ── Step 7: peakDb is already computed per candidate region. ────────

	return regions;
}
