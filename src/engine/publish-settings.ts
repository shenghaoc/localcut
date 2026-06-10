/**
 * Phase 47 (T6.1/T7): publish-settings defaults per endpoint type (the design
 * guidance table), validation/clamping, and the persistence sanitizer that
 * enforces the token opt-in (R7.2). Pure logic; IndexedDB wiring lives in
 * `persistence.ts`.
 */

import type { PublishEndpointType, PublishSettingsDoc, PublishVideoCodec } from '../protocol';

export interface EndpointGuidance {
	label: string;
	defaultBitrateKbps: number;
	/** Platform-recommended ceiling shown in the UI; user input clamps to it. */
	maxBitrateKbps: number;
	/** Whether the endpoint type is known to accept AV1 (R2.2). */
	allowsAv1: boolean;
	urlHint: string;
}

export const ENDPOINT_GUIDANCE: Record<PublishEndpointType, EndpointGuidance> = {
	'twitch-whip': {
		label: 'Twitch (WHIP)',
		defaultBitrateKbps: 4500,
		maxBitrateKbps: 6000,
		allowsAv1: false,
		urlHint: 'https://g.webrtc.live-video.net:4443/v2/offer'
	},
	'cloudflare-whip': {
		label: 'Cloudflare-class CDN (WHIP)',
		defaultBitrateKbps: 4500,
		maxBitrateKbps: 8000,
		allowsAv1: false,
		urlHint: 'https://customer-<id>.cloudflarestream.com/<input>/webRTC/publish'
	},
	mediamtx: {
		label: 'Self-hosted MediaMTX',
		defaultBitrateKbps: 4500,
		maxBitrateKbps: 20000,
		allowsAv1: true,
		urlHint: 'http://<host>:8889/<path>/whip'
	},
	custom: {
		label: 'Custom WHIP URL',
		defaultBitrateKbps: 4500,
		maxBitrateKbps: 20000,
		allowsAv1: true,
		urlHint: 'https://<server>/<path>/whip'
	}
};

const MIN_BITRATE_KBPS = 500;
const MIN_KEYFRAME_S = 1;
const MAX_KEYFRAME_S = 10;

export function defaultPublishSettings(
	endpointType: PublishEndpointType = 'mediamtx'
): PublishSettingsDoc {
	return {
		endpointType,
		endpointUrl: '',
		codec: 'h264',
		videoBitrateKbps: ENDPOINT_GUIDANCE[endpointType].defaultBitrateKbps,
		keyframeIntervalS: 2,
		maxHeight: 1080,
		maxFps: 30,
		rememberToken: false
	};
}

/**
 * AV1 needs the Phase 26 probe AND an endpoint type known to take it (R2.2);
 * everything else falls back to the H.264 baseline default.
 */
export function effectiveCodec(
	settings: PublishSettingsDoc,
	av1EncodeSupported: boolean
): PublishVideoCodec {
	if (
		settings.codec === 'av1' &&
		av1EncodeSupported &&
		ENDPOINT_GUIDANCE[settings.endpointType].allowsAv1
	) {
		return 'av1';
	}
	return 'h264';
}

/** Clamps user input into the validated range for the endpoint type (R2.3). */
export function clampPublishSettings(settings: PublishSettingsDoc): PublishSettingsDoc {
	const guidance = ENDPOINT_GUIDANCE[settings.endpointType];
	return {
		...settings,
		videoBitrateKbps: Math.min(
			guidance.maxBitrateKbps,
			Math.max(MIN_BITRATE_KBPS, Math.round(settings.videoBitrateKbps))
		),
		keyframeIntervalS: Math.min(
			MAX_KEYFRAME_S,
			Math.max(MIN_KEYFRAME_S, Math.round(settings.keyframeIntervalS))
		)
	};
}

export function isValidWhipEndpointUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		return parsed.protocol === 'https:' || parsed.protocol === 'http:';
	} catch {
		return false;
	}
}

/**
 * What actually goes to IndexedDB: the token is stripped unless the user
 * explicitly opted into remembering it on this device (R7.2).
 */
export function sanitizeForPersist(settings: PublishSettingsDoc): PublishSettingsDoc {
	const { bearerToken, ...rest } = settings;
	return settings.rememberToken && bearerToken !== undefined
		? { ...rest, rememberToken: true, bearerToken }
		: { ...rest, rememberToken: settings.rememberToken };
}

const ENDPOINT_TYPES: readonly PublishEndpointType[] = [
	'twitch-whip',
	'cloudflare-whip',
	'mediamtx',
	'custom'
];

/** Validates an untrusted IndexedDB record back into a settings doc. */
export function parsePublishSettings(value: unknown): PublishSettingsDoc | null {
	if (typeof value !== 'object' || value === null) return null;
	const record = value as Record<string, unknown>;
	if (!ENDPOINT_TYPES.includes(record.endpointType as PublishEndpointType)) return null;
	if (typeof record.endpointUrl !== 'string') return null;
	if (record.codec !== 'h264' && record.codec !== 'av1') return null;
	if (typeof record.videoBitrateKbps !== 'number') return null;
	if (typeof record.keyframeIntervalS !== 'number') return null;
	if (typeof record.rememberToken !== 'boolean') return null;
	const maxHeight = typeof record.maxHeight === 'number' ? record.maxHeight : null;
	const maxFps = typeof record.maxFps === 'number' ? record.maxFps : null;
	const settings: PublishSettingsDoc = {
		endpointType: record.endpointType as PublishEndpointType,
		endpointUrl: record.endpointUrl,
		codec: record.codec,
		videoBitrateKbps: record.videoBitrateKbps,
		keyframeIntervalS: record.keyframeIntervalS,
		maxHeight,
		maxFps,
		rememberToken: record.rememberToken
	};
	if (record.rememberToken === true && typeof record.bearerToken === 'string') {
		settings.bearerToken = record.bearerToken;
	}
	return clampPublishSettings(settings);
}
