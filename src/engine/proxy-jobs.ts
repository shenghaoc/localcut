import type { ProxyGenerationSettings, TimeRange } from './cache-types';
import {
	proxySettingsHash,
	sourceConformanceHash,
	sourceFingerprintFromDescriptor
} from './cache-key';
import type { MediaAssetSnapshot, SourceDescriptorSnapshot, ThroughputProbe } from '../protocol';

export type ProxyPreference = 'disabled' | 'ask' | 'automatic' | 'selected-only';
export type ProxyJobPriority =
	| 'active-range'
	| 'visible-filmstrip'
	| 'selected-source'
	| 'background-bin';
export type ProxyRecommendationReason =
	| 'large-resolution'
	| 'high-bitrate'
	| 'variable-frame-rate'
	| 'heavy-codec'
	| 'slow-throughput';

export interface ProxyPlanningOptions {
	readonly preference: ProxyPreference;
	readonly throughputProbe?: ThroughputProbe | null;
	readonly activeSourceIds?: ReadonlySet<string>;
	readonly visibleSourceIds?: ReadonlySet<string>;
	readonly selectedSourceIds?: ReadonlySet<string>;
	readonly activeRanges?: readonly TimeRange[];
}

export interface ProxyJobPlan {
	readonly sourceId: string;
	readonly sourceFingerprint: string;
	readonly sourceConformanceHash: string;
	readonly priority: ProxyJobPriority;
	readonly reasons: readonly ProxyRecommendationReason[];
	readonly requiresConfirmation: boolean;
	readonly settings: ProxyGenerationSettings;
	readonly settingsHash: string;
	readonly activeRanges: readonly TimeRange[];
}

const DEFAULT_PROXY_MAX_WIDTH = 1280;
const DEFAULT_PROXY_MAX_HEIGHT = 720;
const DEFAULT_PROXY_FPS = 30;
const HIGH_BITRATE_BPS = 35_000_000;

function even(value: number): number {
	return Math.max(2, Math.floor(value / 2) * 2);
}

function targetSize(width: number, height: number): { width: number; height: number } {
	const scale = Math.min(1, DEFAULT_PROXY_MAX_WIDTH / width, DEFAULT_PROXY_MAX_HEIGHT / height);
	return {
		width: even(width * scale),
		height: even(height * scale)
	};
}

function sourceBitrateBps(source: SourceDescriptorSnapshot): number {
	if (source.durationS <= 0) return 0;
	return (source.byteSize * 8) / source.durationS;
}

function isHeavyCodec(codec: string | null | undefined): boolean {
	if (!codec) return false;
	const normalized = codec.toLowerCase();
	return (
		normalized.includes('vp9') ||
		normalized.includes('vp09') ||
		normalized.includes('av1') ||
		normalized.includes('av01') ||
		normalized.includes('hev1') ||
		normalized.includes('hvc1')
	);
}

export function proxyRecommendationReasons(
	source: SourceDescriptorSnapshot,
	probe: ThroughputProbe | null = null
): ProxyRecommendationReason[] {
	if (source.kind !== 'video' || !source.video?.canDecode) return [];
	const reasons: ProxyRecommendationReason[] = [];
	if (source.video.width >= 2560 || source.video.height >= 1440) {
		reasons.push('large-resolution');
	}
	if (sourceBitrateBps(source) >= HIGH_BITRATE_BPS) {
		reasons.push('high-bitrate');
	}
	if (source.video.frameRateMode === 'variable') {
		reasons.push('variable-frame-rate');
	}
	if (isHeavyCodec(source.video.codec)) {
		reasons.push('heavy-codec');
	}
	const sourceFps = source.video.frameRate ?? DEFAULT_PROXY_FPS;
	if (probe && probe.encodeFps > 0 && sourceFps > 0 && probe.encodeFps < sourceFps * 0.75) {
		reasons.push('slow-throughput');
	}
	return reasons;
}

function priorityForSource(sourceId: string, options: ProxyPlanningOptions): ProxyJobPriority {
	if (options.activeSourceIds?.has(sourceId)) return 'active-range';
	if (options.visibleSourceIds?.has(sourceId)) return 'visible-filmstrip';
	if (options.selectedSourceIds?.has(sourceId)) return 'selected-source';
	return 'background-bin';
}

function priorityRank(priority: ProxyJobPriority): number {
	switch (priority) {
		case 'active-range':
			return 0;
		case 'visible-filmstrip':
			return 1;
		case 'selected-source':
			return 2;
		case 'background-bin':
			return 3;
	}
}

function defaultProxySettings(source: SourceDescriptorSnapshot): ProxyGenerationSettings {
	const width = source.video?.width ?? DEFAULT_PROXY_MAX_WIDTH;
	const height = source.video?.height ?? DEFAULT_PROXY_MAX_HEIGHT;
	const size = targetSize(width, height);
	const fps = Math.min(source.video?.frameRate ?? DEFAULT_PROXY_FPS, DEFAULT_PROXY_FPS);
	return {
		width: size.width,
		height: size.height,
		fps: Math.max(1, Number.isFinite(fps) ? fps : DEFAULT_PROXY_FPS),
		videoBitrate: 4_000_000,
		container: 'mp4',
		videoCodec: 'h264',
		audioCodec: source.audio?.canDecode ? 'aac' : 'none'
	};
}

export function planProxyCandidates(
	sources: readonly SourceDescriptorSnapshot[],
	options: ProxyPlanningOptions
): ProxyJobPlan[] {
	if (options.preference === 'disabled') return [];
	const plans: ProxyJobPlan[] = [];
	for (const source of sources) {
		const reasons = proxyRecommendationReasons(source, options.throughputProbe ?? null);
		if (reasons.length === 0) continue;
		if (
			options.preference === 'selected-only' &&
			!options.selectedSourceIds?.has(source.sourceId)
		) {
			continue;
		}
		const settings = defaultProxySettings(source);
		plans.push({
			sourceId: source.sourceId,
			sourceFingerprint: sourceFingerprintFromDescriptor(source),
			sourceConformanceHash: sourceConformanceHash(source),
			priority: priorityForSource(source.sourceId, options),
			reasons,
			requiresConfirmation: options.preference === 'ask',
			settings,
			settingsHash: proxySettingsHash(settings),
			activeRanges: options.activeSourceIds?.has(source.sourceId)
				? (options.activeRanges ?? [])
				: []
		});
	}
	return plans.sort(
		(a, b) =>
			priorityRank(a.priority) - priorityRank(b.priority) || a.sourceId.localeCompare(b.sourceId)
	);
}

function reasonLabel(reason: ProxyRecommendationReason): string {
	switch (reason) {
		case 'large-resolution':
			return 'large resolution';
		case 'high-bitrate':
			return 'high bitrate';
		case 'variable-frame-rate':
			return 'variable frame rate';
		case 'heavy-codec':
			return 'heavy codec';
		case 'slow-throughput':
			return 'slow local throughput';
	}
}

export function proxyStatusForAsset(
	asset: MediaAssetSnapshot,
	probe: ThroughputProbe | null
): MediaAssetSnapshot['proxy'] {
	const source: SourceDescriptorSnapshot = {
		sourceId: asset.sourceId,
		fileName: asset.fileName,
		kind: asset.kind,
		byteSize: asset.byteSize,
		durationS: asset.durationS,
		mimeType: asset.mimeType,
		timing: asset.timing,
		health: asset.health,
		video: asset.video
			? {
					...asset.video,
					codec: asset.video.codec ?? null,
					canDecode: asset.video.canDecode ?? asset.health?.status !== 'blocked'
				}
			: undefined,
		audio: asset.audio
			? {
					...asset.audio,
					codec: asset.audio.codec ?? null,
					canDecode: asset.audio.canDecode ?? asset.health?.status !== 'blocked'
				}
			: undefined
	};
	const reasons = proxyRecommendationReasons(source, probe);
	if (asset.kind !== 'video')
		return { status: 'disabled', mode: 'original', reason: 'Proxy preview is for video sources.' };
	if (reasons.length === 0) return { status: 'not-generated', mode: 'original' };
	return {
		status: 'recommended',
		mode: 'original',
		reason: `Recommended for ${reasons.map(reasonLabel).join(', ')}.`
	};
}
