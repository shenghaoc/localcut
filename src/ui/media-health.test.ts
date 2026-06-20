import { describe, expect, it } from 'vite-plus/test';
import type { MediaAssetSnapshot, SourceHealthWarningSnapshot } from '../protocol';
import {
	mediaTooltipMessages,
	passiveMediaInfoMessages,
	userVisibleHealthReport,
	userVisibleHealthWarnings
} from './media-health';

function warning(
	code: SourceHealthWarningSnapshot['code'],
	severity: SourceHealthWarningSnapshot['severity'] = 'warning',
	blocking = false
): SourceHealthWarningSnapshot {
	return {
		code,
		severity,
		blocking,
		sourceId: 'source-1',
		message: code,
		details: {}
	};
}

describe('userVisibleHealthWarnings', () => {
	it('hides handled media conformance metadata from ordinary warning surfaces', () => {
		expect(
			userVisibleHealthWarnings([
				warning('variable-frame-rate'),
				warning('non-zero-track-start'),
				warning('audio-video-offset'),
				warning('rotation-metadata', 'info'),
				warning('mixed-audio-sample-rates', 'info')
			])
		).toEqual([]);
	});

	it('keeps actionable health warnings visible', () => {
		const visible = [
			warning('unsupported-video-codec', 'error'),
			warning('missing-cleaned-audio'),
			warning('lottie-zip-unsupported', 'error', true)
		];
		expect(userVisibleHealthWarnings(visible)).toEqual(visible);
	});
});

describe('passiveMediaInfoMessages', () => {
	function asset(
		warnings: readonly SourceHealthWarningSnapshot[],
		proxyReason?: string
	): MediaAssetSnapshot {
		return {
			sourceId: 'source-1',
			fileName: 'screen-recording.mp4',
			kind: 'video',
			byteSize: 10,
			durationS: 1,
			mimeType: 'video/mp4',
			health: {
				sourceId: 'source-1',
				fileName: 'screen-recording.mp4',
				status: warnings.length > 0 ? 'warnings' : 'ok',
				warnings
			},
			...(proxyReason
				? {
						proxy: {
							status: 'recommended' as const,
							mode: 'original' as const,
							reason: proxyReason
						}
					}
				: {})
		};
	}

	it('keeps passive media and proxy recommendation text for hover/details only', () => {
		expect(
			passiveMediaInfoMessages(
				asset(
					[
						warning('variable-frame-rate'),
						warning('non-zero-track-start'),
						warning('unsupported-video-codec', 'error')
					],
					'Recommended for large resolution, variable frame rate, heavy codec.'
				)
			)
		).toEqual([
			'variable-frame-rate',
			'non-zero-track-start',
			'Recommended for large resolution, variable frame rate, heavy codec.'
		]);
	});

	it('builds tooltip messages from passive notes plus actionable warnings', () => {
		expect(
			mediaTooltipMessages(
				asset(
					[warning('audio-video-offset'), warning('unsupported-video-codec', 'error')],
					'Recommended for heavy codec.'
				)
			)
		).toEqual(['audio-video-offset', 'Recommended for heavy codec.', 'unsupported-video-codec']);
	});
});

describe('userVisibleHealthReport', () => {
	it('returns null when a report only contains passive metadata', () => {
		expect(
			userVisibleHealthReport({
				sourceId: 'source-1',
				fileName: 'screen-recording.mp4',
				status: 'warnings',
				warnings: [warning('variable-frame-rate'), warning('audio-video-offset')]
			})
		).toBeNull();
	});

	it('recomputes status from visible warnings', () => {
		expect(
			userVisibleHealthReport({
				sourceId: 'source-1',
				fileName: 'broken.mp4',
				status: 'blocked',
				warnings: [warning('variable-frame-rate'), warning('lottie-zip-unsupported', 'error', true)]
			})
		).toMatchObject({
			status: 'blocked',
			warnings: [warning('lottie-zip-unsupported', 'error', true)]
		});
	});
});
