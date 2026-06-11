import { describe, expect, it } from 'vitest';
import { createRingBuffer, type RingBufferEntry } from './ring-buffer';
import type { RingBufferConfig } from '../../protocol';

// Deterministic PRNG (mulberry32)
function rng(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a |= 0; a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const baseCfg: RingBufferConfig = {
	maxDurationS: 5,
	maxMemoryBytes: 256 * 1024 * 1024,
	saveDurationS: 3,
};

// ---------------------------------------------------------------------------
// Reference model: the pre-optimization implementation (slice-based span per
// eviction candidate, naive stats, splice-based spill) — differential oracle
// for the O(1)-span + incremental-counter rewrite.
// ---------------------------------------------------------------------------
function createOldModel(config: RingBufferConfig) {
	let entries: RingBufferEntry[] = [];
	let cfg = { ...config };
	let droppedFrameCount = 0;

	function totalDuration(): number {
		if (entries.length === 0) return 0;
		return entries[entries.length - 1].timestamp + entries[entries.length - 1].duration - entries[0].timestamp;
	}
	function evictToFitDuration(): void {
		const maxDur = cfg.maxDurationS;
		let cutoffIdx = -1;
		for (let i = 0; i < entries.length; i++) {
			if (entries[i].type === 'video' && entries[i].isKeyframe) {
				const after = entries.slice(i);
				const span = after.length > 0
					? after[after.length - 1].timestamp + after[after.length - 1].duration - after[0].timestamp
					: 0;
				if (span <= maxDur) { cutoffIdx = i; break; }
			}
		}
		if (cutoffIdx === -1) {
			for (let i = 1; i < entries.length; i++) {
				if (entries[i].type === 'video' && entries[i].isKeyframe) {
					cutoffIdx = i; droppedFrameCount++; break;
				}
			}
		}
		if (cutoffIdx > 0) entries = entries.slice(cutoffIdx);
	}
	return {
		pushVideo(timestamp: number, duration: number, data: Uint8Array, isKeyframe: boolean) {
			entries.push({ type: 'video', timestamp, duration, byteSize: data.byteLength, isKeyframe, data });
			if (totalDuration() > cfg.maxDurationS) evictToFitDuration();
		},
		pushAudio(timestamp: number, duration: number, data: Uint8Array) {
			entries.push({ type: 'audio', timestamp, duration, byteSize: data.byteLength, isKeyframe: false, data });
			if (totalDuration() > cfg.maxDurationS) evictToFitDuration();
		},
		spillOldest(targetByteReduction: number): RingBufferEntry[] | null {
			if (entries.length === 0 || targetByteReduction <= 0) return null;
			let bytesToSpill = 0;
			let spillCount = 0;
			for (const e of entries) {
				bytesToSpill += e.byteSize; spillCount++;
				if (bytesToSpill >= targetByteReduction) break;
			}
			let aligned = -1;
			for (let i = spillCount; i < entries.length; i++) {
				if (entries[i].type === 'video' && entries[i].isKeyframe) { aligned = i; break; }
			}
			if (aligned === -1) return null;
			spillCount = aligned;
			return entries.splice(0, spillCount);
		},
		updateConfig(partial: Partial<RingBufferConfig>) {
			cfg = { ...cfg, ...partial };
			cfg.maxDurationS = Math.min(300, Math.max(1, cfg.maxDurationS));
			cfg.saveDurationS = Math.min(cfg.maxDurationS, Math.max(1, cfg.saveDurationS));
			if (totalDuration() > cfg.maxDurationS) evictToFitDuration();
		},
		reset() { entries = []; droppedFrameCount = 0; },
		entriesView(): RingBufferEntry[] { return entries; },
		dropped(): number { return droppedFrameCount; },
	};
}

function residentEntries(rb: ReturnType<typeof createRingBuffer>): RingBufferEntry[] {
	return rb.getSnapshot(-Infinity, Infinity).entries;
}

describe('fuzz: incremental counters never drift from ground truth', () => {
	it('mixed video+audio, spills, config changes, resets (20k ops x 8 seeds)', () => {
		for (let seed = 1; seed <= 8; seed++) {
			const rand = rng(seed);
			const rb = createRingBuffer({ ...baseCfg });
			let ts = 0;
			for (let op = 0; op < 20000; op++) {
				const r = rand();
				if (r < 0.45) {
					const dur = 1 / 30;
					const key = rand() < 0.1;
					rb.pushVideo(ts, dur, new Uint8Array(1 + Math.floor(rand() * 5000)), key);
					ts += dur;
				} else if (r < 0.8) {
					const dur = 1024 / 48000;
					rb.pushAudio(ts, dur, new Uint8Array(1 + Math.floor(rand() * 800)));
					ts += dur;
				} else if (r < 0.93) {
					rb.spillOldest(Math.floor(rand() * 50000));
				} else if (r < 0.98) {
					rb.updateConfig({ maxDurationS: 1 + Math.floor(rand() * 8) });
				} else {
					rb.reset();
				}
				// Ground truth from the resident entry list itself.
				const ground = residentEntries(rb);
				const stats = rb.getStats();
				const trueBytes = ground.reduce((s, e) => s + e.byteSize, 0);
				const trueKeyframes = ground.filter((e) => e.isKeyframe).length;
				if (stats.memoryBytes !== trueBytes || stats.keyframeCount !== trueKeyframes) {
					throw new Error(
						`DRIFT seed=${seed} op=${op}: memoryBytes=${stats.memoryBytes} (true ${trueBytes}) keyframeCount=${stats.keyframeCount} (true ${trueKeyframes})`,
					);
				}
			}
			expect(true).toBe(true);
		}
	});

	it('audio-only buffer: counters stay true through new evict/spill branches', () => {
		for (let seed = 100; seed <= 104; seed++) {
			const rand = rng(seed);
			const rb = createRingBuffer({ ...baseCfg });
			let ts = 0;
			for (let op = 0; op < 8000; op++) {
				const r = rand();
				if (r < 0.75) {
					const dur = 1024 / 48000;
					rb.pushAudio(ts, dur, new Uint8Array(1 + Math.floor(rand() * 800)));
					ts += dur;
				} else if (r < 0.92) {
					rb.spillOldest(Math.floor(rand() * 20000));
				} else if (r < 0.98) {
					rb.updateConfig({ maxDurationS: 1 + Math.floor(rand() * 4) });
				} else {
					rb.reset();
				}
				const ground = residentEntries(rb);
				const stats = rb.getStats();
				expect(stats.memoryBytes).toBe(ground.reduce((s, e) => s + e.byteSize, 0));
				expect(stats.keyframeCount).toBe(0);
			}
		}
	});
});

describe('fuzz: new O(1) span eviction === old slice-based eviction (video present)', () => {
	it('identical resident lists across 20k ops x 8 seeds', () => {
		for (let seed = 200; seed <= 207; seed++) {
			const rand = rng(seed);
			const cfg = { ...baseCfg };
			const neu = createRingBuffer(cfg);
			const old = createOldModel(cfg);
			let ts = 0;
			// Always start with a video keyframe so both impls stay in the
			// video-present regime where behavior must be identical.
			const first = new Uint8Array(100);
			neu.pushVideo(0, 1 / 30, first, true);
			old.pushVideo(0, 1 / 30, first, true);
			ts = 1 / 30;
			for (let op = 0; op < 20000; op++) {
				const r = rand();
				if (r < 0.5) {
					const dur = 1 / 30;
					const key = rand() < 0.08;
					const data = new Uint8Array(1 + Math.floor(rand() * 5000));
					neu.pushVideo(ts, dur, data, key);
					old.pushVideo(ts, dur, data, key);
					ts += dur;
				} else if (r < 0.85) {
					const dur = 1024 / 48000;
					const data = new Uint8Array(1 + Math.floor(rand() * 800));
					neu.pushAudio(ts, dur, data);
					old.pushAudio(ts, dur, data);
					ts += dur;
				} else if (r < 0.95) {
					const target = Math.floor(rand() * 50000);
					const a = neu.spillOldest(target);
					const b = old.spillOldest(target);
					expect(a === null).toBe(b === null);
					if (a && b) {
						expect(a.entries.length).toBe(b.length);
						expect(a.entries.map((e) => e.timestamp)).toEqual(b.map((e) => e.timestamp));
					}
				} else {
					const d = 1 + Math.floor(rand() * 8);
					neu.updateConfig({ maxDurationS: d });
					old.updateConfig({ maxDurationS: d });
				}
				const groundNew = residentEntries(neu);
				const groundOld = old.entriesView();
				if (groundNew.length !== groundOld.length
					|| (groundNew.length > 0 && (groundNew[0].timestamp !== groundOld[0].timestamp
						|| groundNew[groundNew.length - 1].timestamp !== groundOld[groundOld.length - 1].timestamp))) {
					throw new Error(
						`DIVERGENCE seed=${seed} op=${op}: new len=${groundNew.length} old len=${groundOld.length} `
						+ `new[0]=${groundNew[0]?.timestamp} old[0]=${groundOld[0]?.timestamp}`,
					);
				}
				expect(neu.getStats().droppedFrameCount).toBe(old.dropped());
			}
		}
	});
});
