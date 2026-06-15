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

/** Pre-padding candidate region used by the streaming detector. */
interface SilenceCandidate {
	startS: number;
	endS: number;
	peakDb: number;
}

/**
 * Streaming silence detector. Maintains hysteresis state across PCM chunks
 * so a long timeline can be analysed without allocating one buffer for the
 * entire program. Call {@link SilenceStreamDetector.pushChunk} with bounded
 * Float32Array chunks, then call {@link SilenceStreamDetector.finalize}
 * once to produce the final region list.
 *
 * The carry between chunks is `windowSamples - 1` samples — enough to let
 * the next chunk start a sliding window straddling the seam without losing
 * coverage.
 */
export class SilenceStreamDetector {
	private readonly params: SilenceDetectionParams;
	private readonly candidates: SilenceCandidate[] = [];
	/** Carry buffer. Length always ≤ `windowSamples - 1`. */
	private carry: Float32Array;
	private carryLen = 0;
	/** Cursor over the absolute stream (chunks + carry). */
	private absoluteSamples = 0;
	private state: 'CLOSED' | 'OPEN' = 'CLOSED';
	private openStartS = 0;
	private openPeakDb = 0;

	constructor(params: SilenceDetectionParams) {
		this.params = params;
		this.carry = new Float32Array(Math.max(0, params.windowSamples - 1));
	}

	pushChunk(chunk: Float32Array): void {
		const { windowSamples, hopSamples, sampleRate, openThreshold, closeThreshold } = this.params;
		if (closeThreshold < openThreshold) return;
		if (chunk.length === 0) return;

		// Stitch carry + chunk so the sliding window can span the seam.
		const work = new Float32Array(this.carryLen + chunk.length);
		work.set(this.carry.subarray(0, this.carryLen), 0);
		work.set(chunk, this.carryLen);
		const workLen = work.length;

		// Sample index in the global stream at work[0].
		const workStartAbs = this.absoluteSamples - this.carryLen;

		let nextWindowOffset = 0;
		while (nextWindowOffset + windowSamples <= workLen) {
			let sumSq = 0;
			for (let i = 0; i < windowSamples; i++) {
				const v = work[nextWindowOffset + i]!;
				sumSq += v * v;
			}
			const rms = Math.sqrt(sumSq / windowSamples);
			const db = 20 * Math.log10(Math.max(rms, DB_FLOOR));
			const startS = (workStartAbs + nextWindowOffset) / sampleRate;
			this.feedWindow(startS, db);
			nextWindowOffset += hopSamples;
		}

		// Carry the un-windowed tail forward — it strictly fits in
		// `windowSamples - 1` because if it were larger we'd have evaluated
		// another window.
		const newCarryLen = workLen - nextWindowOffset;
		if (newCarryLen > this.carry.length) {
			// Defensive: only happens if params change mid-stream, which we
			// don't support — allocate up.
			this.carry = new Float32Array(newCarryLen);
		}
		this.carry.set(work.subarray(nextWindowOffset, workLen), 0);
		this.carryLen = newCarryLen;
		this.absoluteSamples += chunk.length;
	}

	private feedWindow(startS: number, db: number): void {
		const { openThreshold, closeThreshold } = this.params;
		if (this.state === 'CLOSED') {
			if (db < openThreshold) {
				this.state = 'OPEN';
				this.openStartS = startS;
				this.openPeakDb = db;
			}
		} else {
			if (db >= closeThreshold) {
				const duration = startS - this.openStartS;
				if (duration >= this.params.minSilence) {
					this.candidates.push({
						startS: this.openStartS,
						endS: startS,
						peakDb: this.openPeakDb
					});
				}
				this.state = 'CLOSED';
			} else if (db > this.openPeakDb) {
				this.openPeakDb = db;
			}
		}
	}

	finalize(): SilenceRegion[] {
		const { sampleRate, minSilence, keepPadding, minKeptSegment } = this.params;
		const pcmDurationS = this.absoluteSamples / sampleRate;
		if (this.state === 'OPEN') {
			const duration = pcmDurationS - this.openStartS;
			if (duration >= minSilence) {
				this.candidates.push({
					startS: this.openStartS,
					endS: pcmDurationS,
					peakDb: this.openPeakDb
				});
			}
		}

		let regions: SilenceRegion[] = this.candidates
			.map((c) => ({
				startS: c.startS + keepPadding,
				endS: c.endS - keepPadding,
				peakDb: c.peakDb
			}))
			.filter((r) => r.endS > r.startS);

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
						next.push({
							startS: current.startS,
							endS: following.endS,
							peakDb: Math.max(current.peakDb, following.peakDb)
						});
						i++;
						merged = true;
						continue;
					}
				}
				next.push(current);
			}
			regions = next;
		}
		return regions;
	}
}

/** Intersect two sorted-and-disjoint region lists, producing the regions that
 *  appear in BOTH (i.e. silent on every selected track simultaneously). Used
 *  to combine per-track results without false-positive dead air. */
export function intersectSilenceRegions(a: SilenceRegion[], b: SilenceRegion[]): SilenceRegion[] {
	const out: SilenceRegion[] = [];
	let i = 0;
	let j = 0;
	while (i < a.length && j < b.length) {
		const ai = a[i]!;
		const bj = b[j]!;
		const startS = Math.max(ai.startS, bj.startS);
		const endS = Math.min(ai.endS, bj.endS);
		if (endS > startS) {
			out.push({ startS, endS, peakDb: Math.max(ai.peakDb, bj.peakDb) });
		}
		if (ai.endS < bj.endS) i++;
		else j++;
	}
	return out;
}

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
