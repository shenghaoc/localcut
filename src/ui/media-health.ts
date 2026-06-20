import type {
	MediaAssetSnapshot,
	SourceHealthReportSnapshot,
	SourceHealthWarningSnapshot
} from '../protocol';

const passiveHealthCodes = new Set<SourceHealthWarningSnapshot['code']>([
	'variable-frame-rate',
	'non-zero-track-start',
	'audio-video-offset',
	'rotation-metadata',
	'mixed-audio-sample-rates'
]);

export function userVisibleHealthWarnings(
	warnings: readonly SourceHealthWarningSnapshot[]
): SourceHealthWarningSnapshot[] {
	return warnings.filter((warning) => !passiveHealthCodes.has(warning.code));
}

export function passiveHealthWarnings(
	warnings: readonly SourceHealthWarningSnapshot[]
): SourceHealthWarningSnapshot[] {
	return warnings.filter((warning) => passiveHealthCodes.has(warning.code));
}

export function passiveMediaInfoMessages(asset: MediaAssetSnapshot): string[] {
	const messages = passiveHealthWarnings(asset.health?.warnings ?? []).map(
		(warning) => warning.message
	);
	if (asset.proxy?.status === 'recommended' && asset.proxy.reason) {
		messages.push(asset.proxy.reason);
	}
	return messages;
}

export function mediaTooltipMessages(asset: MediaAssetSnapshot): string[] {
	return [
		...passiveMediaInfoMessages(asset),
		...userVisibleHealthWarnings(asset.health?.warnings ?? []).map((warning) => warning.message)
	];
}

export function userVisibleHealthReport(
	report: SourceHealthReportSnapshot
): SourceHealthReportSnapshot | null {
	const warnings = userVisibleHealthWarnings(report.warnings);
	if (warnings.length === 0) return null;
	return {
		...report,
		status: warnings.some((warning) => warning.blocking) ? 'blocked' : 'warnings',
		warnings
	};
}
