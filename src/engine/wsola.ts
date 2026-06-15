/**
 * Phase 35: WSOLA (Waveform Similarity Overlap-Add) time-stretcher.
 *
 * Runs in the pipeline worker; no browser globals. Streaming-friendly over
 * pcmWindowAt windows. Each output hop:
 *  1. Slides an analysis offset within ±searchRadius of the expected position
 *     and picks the candidate whose leading `overlapSamples` best match the
 *     previous hop's stored overlap tail (normalized cross-correlation).
 *  2. Crossfades the first `overlapSamples` of the candidate window into the
 *     output via the stored overlap, then copies the next `hopSamples` of
 *     candidate samples through.
 *  3. Saves the next `overlapSamples` from the candidate window as the new
 *     overlap tail for the next hop.
 *
 * All offsets are tracked in *frames* and converted to interleaved sample
 * indices via `* channels + channel`. Fractional analysis advances are rounded
 * before indexing into the input buffer so we never read past valid samples.
 */

/** Analysis window size in frames (~30 ms at 48 kHz). */
export const WSOLA_WINDOW_SAMPLES = 1440;
/** Overlap size in frames (50 % of window). */
export const WSOLA_OVERLAP_SAMPLES = 720;
/** Search radius for cross-correlation in frames (±10 ms at 48 kHz). */
export const WSOLA_SEARCH_RADIUS_SAMPLES = 480;

/**
 * WSOLA time-stretcher. Stateful per clip instance (maintains overlap buffer
 * and the analysis position from the most recent call so successive
 * `pcmWindowAt` slices stay continuous across calls).
 */
export class WsolaStretcher {
	private readonly channels: number;
	/** Stored tail (frames × channels) for overlap-add with the next hop. */
	private readonly overlap: Float32Array;
	/** Whether the overlap buffer has been populated yet. */
	private overlapPrimed: boolean;
	/** Analysis position (in source frames) used as the centre of the next search. */
	private analysisPos: number;

	constructor(channels: number) {
		this.channels = Math.max(1, channels);
		this.overlap = new Float32Array(WSOLA_OVERLAP_SAMPLES * this.channels);
		this.overlapPrimed = false;
		this.analysisPos = 0;
	}

	/**
	 * Produce `outputFrames` of stretched output from `input` at `speedRatio`.
	 *
	 * Callers re-position their `pcmWindowAt` slice each call, so the analysis
	 * position is reset to 0 (the start of the supplied window) at the top of
	 * every call. The stored overlap tail preserves continuity across calls.
	 *
	 * @param input Interleaved Float32 PCM, at least `WSOLA_WINDOW_SAMPLES *
	 *   channels` samples long.
	 * @param speedRatio Playback speed (> 0). The analysis position advances by
	 *   `hopSamples * speedRatio` per hop, so 2× consumes twice as much source
	 *   material as 1× and 0.5× consumes half.
	 * @param outputFrames Number of output sample frames to produce.
	 */
	stretch(input: Float32Array, speedRatio: number, outputFrames: number): Float32Array {
		const ch = this.channels;
		const windowFrames = WSOLA_WINDOW_SAMPLES;
		const overlapFrames = WSOLA_OVERLAP_SAMPLES;
		const hopFrames = windowFrames - overlapFrames;
		const output = new Float32Array(outputFrames * ch);

		if (speedRatio <= 0 || outputFrames <= 0) return output;

		const inputFrames = Math.floor(input.length / ch);
		if (inputFrames <= 0) return output;

		// Each pcmWindowAt slice is repositioned by the caller, so the analysis
		// pointer starts at 0 within this window. Continuity across calls is
		// preserved by the persistent overlap tail.
		this.analysisPos = 0;

		let outFrame = 0;
		while (outFrame < outputFrames) {
			const blockFrames = Math.min(hopFrames, outputFrames - outFrame);
			if (blockFrames <= 0) break;

			// Round once before indexing so fractional speedRatio values do not
			// produce non-integer typed-array indices (which read `undefined`).
			const bestOffset = this.findBestMatch(input, inputFrames);

			if (!this.overlapPrimed) {
				// First hop has no tail to crossfade with; pass through directly so
				// the leading samples are not attenuated.
				for (let s = 0; s < blockFrames; s += 1) {
					const srcFrame = bestOffset + s;
					for (let c = 0; c < ch; c += 1) {
						const outIdx = (outFrame + s) * ch + c;
						const inIdx = srcFrame * ch + c;
						output[outIdx] =
							srcFrame >= 0 && srcFrame < inputFrames && inIdx < input.length ? input[inIdx]! : 0;
					}
				}
			} else {
				// Overlap-add the first `overlapFrames` of the chosen candidate with
				// the stored overlap tail using a linear crossfade.
				for (let s = 0; s < overlapFrames && s < blockFrames; s += 1) {
					const fadeOut = 1 - s / overlapFrames;
					const fadeIn = s / overlapFrames;
					const srcFrame = bestOffset + s;
					for (let c = 0; c < ch; c += 1) {
						const outIdx = (outFrame + s) * ch + c;
						const overlapIdx = s * ch + c;
						const inIdx = srcFrame * ch + c;
						const inVal =
							srcFrame >= 0 && srcFrame < inputFrames && inIdx < input.length ? input[inIdx]! : 0;
						output[outIdx] = this.overlap[overlapIdx]! * fadeOut + inVal * fadeIn;
					}
				}

				// Pass-through copy for the rest of the hop.
				for (let s = overlapFrames; s < blockFrames; s += 1) {
					const srcFrame = bestOffset + s;
					for (let c = 0; c < ch; c += 1) {
						const outIdx = (outFrame + s) * ch + c;
						const inIdx = srcFrame * ch + c;
						const inVal =
							srcFrame >= 0 && srcFrame < inputFrames && inIdx < input.length ? input[inIdx]! : 0;
						output[outIdx] = inVal;
					}
				}
			}

			// Save the next overlap tail from the trailing `overlapFrames` of the
			// candidate window so the next hop's crossfade has a real reference.
			const tailStart = bestOffset + hopFrames;
			for (let s = 0; s < overlapFrames; s += 1) {
				const srcFrame = tailStart + s;
				for (let c = 0; c < ch; c += 1) {
					const overlapIdx = s * ch + c;
					const inIdx = srcFrame * ch + c;
					this.overlap[overlapIdx] =
						srcFrame >= 0 && srcFrame < inputFrames && inIdx < input.length ? input[inIdx]! : 0;
				}
			}
			this.overlapPrimed = true;

			// Advance the expected analysis position by the speed-scaled hop and
			// the output write head by the produced hop.
			this.analysisPos += hopFrames * speedRatio;
			outFrame += blockFrames;
		}

		return output;
	}

	/**
	 * Find the offset within the search radius of `analysisPos` whose leading
	 * `overlapFrames` best match the stored overlap tail via normalized
	 * cross-correlation. Indices are rounded to integer frames before use.
	 */
	private findBestMatch(input: Float32Array, inputFrames: number): number {
		const ch = this.channels;
		const overlapFrames = WSOLA_OVERLAP_SAMPLES;
		const windowFrames = WSOLA_WINDOW_SAMPLES;
		const searchRadius = WSOLA_SEARCH_RADIUS_SAMPLES;
		const maxOffset = Math.max(0, inputFrames - windowFrames);
		const centre = Math.max(0, Math.min(Math.round(this.analysisPos), maxOffset));

		// Before the first hop the overlap tail is silent, so correlation has no
		// signal to lock onto. Just use the expected position.
		if (!this.overlapPrimed) return centre;

		const searchStart = Math.max(0, centre - searchRadius);
		const searchEnd = Math.min(maxOffset, centre + searchRadius);

		let bestOffset = centre;
		let bestCorr = -Infinity;

		for (let offset = searchStart; offset <= searchEnd; offset += 1) {
			let corr = 0;
			let candidateEnergy = 0;
			for (let s = 0; s < overlapFrames; s += 1) {
				const srcFrame = offset + s;
				if (srcFrame >= inputFrames) break;
				for (let c = 0; c < ch; c += 1) {
					const inIdx = srcFrame * ch + c;
					const overlapIdx = s * ch + c;
					const inVal = inIdx < input.length ? input[inIdx]! : 0;
					const overlapVal = this.overlap[overlapIdx]!;
					corr += inVal * overlapVal;
					candidateEnergy += inVal * inVal;
				}
			}
			const denom = Math.sqrt(candidateEnergy);
			if (denom <= 1e-10) continue;
			const normalized = corr / denom;
			if (normalized > bestCorr) {
				bestCorr = normalized;
				bestOffset = offset;
			}
		}

		return bestOffset;
	}

	/** Reset internal state (call on seek, clip change, or remap edit). */
	reset(): void {
		this.overlap.fill(0);
		this.overlapPrimed = false;
		this.analysisPos = 0;
	}
}
