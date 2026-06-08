export interface CapabilitySkip {
	readonly feature: string;
	readonly reason: string;
}

export function checkTestCapabilities(): CapabilitySkip[] {
	const skips: CapabilitySkip[] = [];

	if (typeof globalThis.navigator === 'undefined' || !('gpu' in globalThis.navigator)) {
		skips.push({ feature: 'webgpu', reason: 'webgpu.unavailable' });
	}

	if (typeof globalThis.VideoDecoder === 'undefined') {
		skips.push({ feature: 'webcodecs-decoder', reason: 'webcodecs.decoder_unavailable' });
	}

	if (typeof globalThis.VideoEncoder === 'undefined') {
		skips.push({ feature: 'webcodecs-encoder', reason: 'webcodecs.encoder_unavailable' });
	}

	if (typeof SharedArrayBuffer === 'undefined') {
		skips.push({ feature: 'sab', reason: 'sab.unavailable' });
	}

	if (typeof globalThis.crossOriginIsolated === 'boolean' && !globalThis.crossOriginIsolated) {
		skips.push({ feature: 'coop-coep', reason: 'isolation.not_cross_origin_isolated' });
	}

	return skips;
}

export function requireCapability(feature: string): void {
	const skips = checkTestCapabilities();
	const skip = skips.find((s) => s.feature === feature);
	if (skip) {
		throw new Error(`Test skipped: ${skip.reason}`);
	}
}
