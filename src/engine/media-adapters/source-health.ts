import type {
	SourceAudioTrackInspection,
	SourceConformance,
	SourceHealthReport,
	SourceHealthWarning,
	SourceInspection,
	SourceTrackInspection,
	SourceVideoTrackInspection
} from './types';

const OFFSET_WARNING_S = 0.02;
const START_WARNING_S = 0.001;

function warning(
	code: SourceHealthWarning['code'],
	severity: SourceHealthWarning['severity'],
	blocking: boolean,
	sourceId: string,
	message: string,
	details: SourceHealthWarning['details'] = {},
	trackId?: string
): SourceHealthWarning {
	return {
		code,
		severity,
		blocking,
		sourceId,
		...(trackId ? { trackId } : {}),
		message,
		details
	};
}

function trackLabel(track: SourceTrackInspection): string {
	return `${track.kind} track ${track.trackId}`;
}

function videoWarnings(
	inspection: SourceInspection,
	conformance: SourceConformance,
	track: SourceVideoTrackInspection
): SourceHealthWarning[] {
	const warnings: SourceHealthWarning[] = [];
	if (track.frameRateMode === 'variable') {
		warnings.push(
			warning(
				'variable-frame-rate',
				'warning',
				false,
				inspection.sourceId,
				`${inspection.fileName} appears to use variable frame rate video.`,
				{ frameRate: track.frameRate },
				track.trackId
			)
		);
	}
	if (Math.abs(track.startS) > START_WARNING_S) {
		warnings.push(
			warning(
				'non-zero-track-start',
				'warning',
				false,
				inspection.sourceId,
				`${trackLabel(track)} starts at ${track.startS.toFixed(3)}s.`,
				{ startS: track.startS },
				track.trackId
			)
		);
	}
	if (Math.abs(track.rotationDeg) % 360 !== 0) {
		warnings.push(
			warning(
				'rotation-metadata',
				'info',
				false,
				inspection.sourceId,
				`${inspection.fileName} carries ${track.rotationDeg}° rotation metadata.`,
				{ rotationDeg: track.rotationDeg },
				track.trackId
			)
		);
	}
	if (!track.canDecode) {
		const blocking =
			conformance.health === 'blocked' ||
			(conformance.kind === 'video' && conformance.primaryVideoTrackId === track.trackId);
		warnings.push(
			warning(
				'unsupported-video-codec',
				'error',
				blocking,
				inspection.sourceId,
				`${trackLabel(track)} uses an unsupported video codec (${track.codec ?? 'unknown codec'}).`,
				{ codec: track.codec },
				track.trackId
			)
		);
	}
	return warnings;
}

function audioWarnings(
	inspection: SourceInspection,
	conformance: SourceConformance,
	track: SourceAudioTrackInspection
): SourceHealthWarning[] {
	const warnings: SourceHealthWarning[] = [];
	if (Math.abs(track.startS) > START_WARNING_S) {
		warnings.push(
			warning(
				'non-zero-track-start',
				'warning',
				false,
				inspection.sourceId,
				`${trackLabel(track)} starts at ${track.startS.toFixed(3)}s.`,
				{ startS: track.startS },
				track.trackId
			)
		);
	}
	if (!track.canDecode) {
		const blocking =
			conformance.health === 'blocked' ||
			(conformance.kind === 'audio' && conformance.primaryAudioTrackId === track.trackId);
		warnings.push(
			warning(
				'unsupported-audio-codec',
				'error',
				blocking,
				inspection.sourceId,
				`${trackLabel(track)} uses an unsupported audio codec (${track.codec ?? 'unknown codec'}).`,
				{ codec: track.codec },
				track.trackId
			)
		);
	}
	return warnings;
}

export function generateSourceHealthWarnings(
	inspection: SourceInspection,
	conformance: SourceConformance
): SourceHealthWarning[] {
	const warnings: SourceHealthWarning[] = [];
	if (inspection.durationS === null || inspection.durationS <= 0) {
		warnings.push(
			warning(
				'missing-duration',
				'error',
				conformance.health === 'blocked',
				inspection.sourceId,
				`${inspection.fileName} does not expose a usable media duration.`,
				{ durationS: inspection.durationS }
			)
		);
	}

	const videoTracks = inspection.tracks.filter(
		(track): track is SourceVideoTrackInspection => track.kind === 'video'
	);
	const audioTracks = inspection.tracks.filter(
		(track): track is SourceAudioTrackInspection => track.kind === 'audio'
	);

	for (const track of videoTracks) warnings.push(...videoWarnings(inspection, conformance, track));
	for (const track of audioTracks) warnings.push(...audioWarnings(inspection, conformance, track));

	if (conformance.timing.video && conformance.timing.audio) {
		const offset = conformance.timing.avOffsetS;
		if (Math.abs(offset) > OFFSET_WARNING_S) {
			warnings.push(
				warning(
					'audio-video-offset',
					'warning',
					false,
					inspection.sourceId,
					`${inspection.fileName} audio and video start ${Math.abs(offset).toFixed(3)}s apart.`,
					{ offsetS: offset }
				)
			);
		}
	}

	const audioSampleRates = new Set(
		audioTracks.map((track) => track.sampleRate).filter((rate) => rate > 0)
	);
	if (audioSampleRates.size > 1) {
		warnings.push(
			warning(
				'mixed-audio-sample-rates',
				'warning',
				false,
				inspection.sourceId,
				`${inspection.fileName} contains audio tracks with mixed sample rates.`,
				{ sampleRates: [...audioSampleRates].join(', ') }
			)
		);
	}

	const hasDecodableTrack = inspection.tracks.some((track) => track.canDecode);
	if (!hasDecodableTrack) {
		warnings.push(
			warning(
				'undecodable-track',
				'error',
				true,
				inspection.sourceId,
				`${inspection.fileName} has no decodable audio, video, or still-image stream.`,
				{ trackCount: inspection.tracks.length }
			)
		);
	}

	return warnings;
}

export function reportFromWarnings(
	sourceId: string,
	fileName: string,
	warnings: readonly SourceHealthWarning[]
): SourceHealthReport {
	return {
		sourceId,
		fileName,
		status: warnings.some((item) => item.blocking)
			? 'blocked'
			: warnings.length > 0
				? 'warnings'
				: 'ok',
		warnings
	};
}

export function sourceHealthReportFromError(
	sourceId: string,
	fileName: string,
	message: string
): SourceHealthReport {
	return reportFromWarnings(sourceId, fileName, [
		warning(
			'corrupt-or-truncated-file',
			'error',
			true,
			sourceId,
			`${fileName} could not be inspected: ${message}`,
			{ reason: message }
		)
	]);
}
