const GRACEFUL_STOP_FLOOR = 64 * 1024 * 1024; // 64 MiB

export interface QuotaCheckResult {
	ok: boolean;
	headroomBytes: number;
	requiredBytes: number;
	shortfallBytes: number;
}

export async function quotaPreflight(
	configuredBitrateBps: number,
	minDurationS = 60
): Promise<QuotaCheckResult> {
	const estimate = await navigator.storage.estimate();
	const headroom = (estimate.quota ?? 0) - (estimate.usage ?? 0);
	const requiredBytes = Math.ceil((configuredBitrateBps / 8) * minDurationS * 1.1); // +10% overhead
	const shortfall = Math.max(0, requiredBytes - headroom);

	return {
		ok: headroom >= requiredBytes,
		headroomBytes: headroom,
		requiredBytes,
		shortfallBytes: shortfall
	};
}

export async function checkQuotaMidRecord(perFlushCeilingBytes: number): Promise<QuotaCheckResult> {
	const estimate = await navigator.storage.estimate();
	const headroom = (estimate.quota ?? 0) - (estimate.usage ?? 0);
	const floor = Math.max(2 * perFlushCeilingBytes, GRACEFUL_STOP_FLOOR);

	return {
		ok: headroom >= floor,
		headroomBytes: headroom,
		requiredBytes: floor,
		shortfallBytes: Math.max(0, floor - headroom)
	};
}

export function estimateRemainingSeconds(
	bytesWritten: number,
	elapsedUs: number,
	headroomBytes: number
): number | null {
	if (elapsedUs <= 0 || bytesWritten <= 0) return null;
	const byteRate = bytesWritten / (elapsedUs / 1_000_000);
	if (byteRate <= 0) return null;
	return headroomBytes / byteRate;
}
