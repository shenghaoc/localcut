/**
 * OPFS-backed beat analysis cache.
 *
 * Stores beat analysis results keyed by the first 16 hex characters of the
 * source's SHA-256 fingerprint. Results are delta-encoded for compact storage.
 */

import type { BeatAnalysisResult } from './beat-analysis';
import { encodeDeltaBeatTimes, decodeDeltaBeatTimes } from './beat-analysis';

// ---------------------------------------------------------------------------
// Cache format
// ---------------------------------------------------------------------------

interface CachedBeatAnalysis {
	beatAnalysisVersion: 1;
	tempoBpm: number;
	beatTimesMs: number[]; // delta-encoded
}

// ---------------------------------------------------------------------------
// OPFS helpers
// ---------------------------------------------------------------------------

const CACHE_DIR = 'beats';

async function getBeatsDir(create: boolean): Promise<FileSystemDirectoryHandle | null> {
	try {
		const root = await navigator.storage.getDirectory();
		return await root.getDirectoryHandle(CACHE_DIR, { create });
	} catch {
		return null;
	}
}

/** Returns the OPFS filename for a given SHA-256 hex digest. */
export function beatCachePath(sha256Digest: string): string {
	return `${sha256Digest.slice(0, 16)}.beats.json`;
}

/**
 * Read a cached beat analysis from OPFS.
 * Returns null if the file is missing, corrupt, or has a wrong version.
 */
export async function readBeatCache(sha256Digest: string): Promise<BeatAnalysisResult | null> {
	try {
		const dir = await getBeatsDir(false);
		if (!dir) return null;

		const fileName = beatCachePath(sha256Digest);
		const fileHandle = await dir.getFileHandle(fileName);
		const file = await fileHandle.getFile();
		const text = await file.text();
		const data = JSON.parse(text) as CachedBeatAnalysis;

		if (data.beatAnalysisVersion !== 1) return null;
		if (typeof data.tempoBpm !== 'number' || !isFinite(data.tempoBpm)) return null;
		if (!Array.isArray(data.beatTimesMs)) return null;

		const beatTimesMs = decodeDeltaBeatTimes(data.beatTimesMs);
		// Validate decoded values
		for (const ms of beatTimesMs) {
			if (typeof ms !== 'number' || !isFinite(ms) || ms < 0) return null;
		}

		return {
			tempoBpm: data.tempoBpm,
			beatTimesMs,
			analyserVersion: 1
		};
	} catch {
		return null;
	}
}

/**
 * Write a beat analysis result to OPFS.
 * Creates the beats/ directory if it doesn't exist.
 */
export async function writeBeatCache(
	sha256Digest: string,
	result: BeatAnalysisResult
): Promise<void> {
	const dir = await getBeatsDir(true);
	if (!dir) return; // OPFS unavailable, silently skip

	const fileName = beatCachePath(sha256Digest);
	const cached: CachedBeatAnalysis = {
		beatAnalysisVersion: 1,
		tempoBpm: result.tempoBpm,
		beatTimesMs: encodeDeltaBeatTimes(result.beatTimesMs)
	};

	const fileHandle = await dir.getFileHandle(fileName, { create: true });
	const writable = await fileHandle.createWritable();
	await writable.write(JSON.stringify(cached, null, 2));
	await writable.close();
}
