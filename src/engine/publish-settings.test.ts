import { describe, expect, it } from 'vite-plus/test';
import { serializeProject } from './project';
import {
	clampPublishSettings,
	defaultPublishSettings,
	effectiveCodec,
	ENDPOINT_GUIDANCE,
	isValidWhipEndpointUrl,
	parsePublishSettings,
	sanitizeForPersist
} from './publish-settings';

describe('defaults and guidance', () => {
	it('defaults to H.264 at 4500 kbps with a 2 s keyframe interval', () => {
		const settings = defaultPublishSettings('twitch-whip');
		expect(settings.codec).toBe('h264');
		expect(settings.videoBitrateKbps).toBe(4500);
		expect(settings.keyframeIntervalS).toBe(2);
		expect(settings.rememberToken).toBe(false);
		expect(settings.bearerToken).toBeUndefined();
	});

	it('Twitch guidance caps at 6000 kbps and disallows AV1', () => {
		expect(ENDPOINT_GUIDANCE['twitch-whip'].maxBitrateKbps).toBe(6000);
		expect(ENDPOINT_GUIDANCE['twitch-whip'].allowsAv1).toBe(false);
		expect(ENDPOINT_GUIDANCE.mediamtx.allowsAv1).toBe(true);
	});
});

describe('effectiveCodec', () => {
	it('grants AV1 only with probe support AND an endpoint that takes it', () => {
		const onMediamtx = { ...defaultPublishSettings('mediamtx'), codec: 'av1' as const };
		expect(effectiveCodec(onMediamtx, true)).toBe('av1');
		expect(effectiveCodec(onMediamtx, false)).toBe('h264');

		const onTwitch = { ...defaultPublishSettings('twitch-whip'), codec: 'av1' as const };
		expect(effectiveCodec(onTwitch, true)).toBe('h264');
	});
});

describe('clampPublishSettings', () => {
	it('clamps bitrate into the endpoint range and keyframe interval to 1–10 s', () => {
		const wild = {
			...defaultPublishSettings('twitch-whip'),
			videoBitrateKbps: 50_000,
			keyframeIntervalS: 0
		};
		const clamped = clampPublishSettings(wild);
		expect(clamped.videoBitrateKbps).toBe(6000);
		expect(clamped.keyframeIntervalS).toBe(1);

		const tiny = { ...defaultPublishSettings('mediamtx'), videoBitrateKbps: 1 };
		expect(clampPublishSettings(tiny).videoBitrateKbps).toBe(500);
	});
});

describe('isValidWhipEndpointUrl', () => {
	it('accepts http(s) URLs and rejects everything else', () => {
		expect(isValidWhipEndpointUrl('https://ingest.example.com/live/whip')).toBe(true);
		expect(isValidWhipEndpointUrl('http://localhost:8889/live/whip')).toBe(true);
		expect(isValidWhipEndpointUrl('rtmp://live.example.com/app')).toBe(false);
		expect(isValidWhipEndpointUrl('not a url')).toBe(false);
	});
});

describe('token handling (R7.2/R7.3)', () => {
	it('sanitizeForPersist strips the token without the opt-in', () => {
		const settings = {
			...defaultPublishSettings('mediamtx'),
			bearerToken: 'stream-key',
			rememberToken: false
		};
		expect(sanitizeForPersist(settings).bearerToken).toBeUndefined();

		const remembered = { ...settings, rememberToken: true };
		expect(sanitizeForPersist(remembered).bearerToken).toBe('stream-key');
	});

	it('parsePublishSettings drops a persisted token that lacks the opt-in flag', () => {
		const parsed = parsePublishSettings({
			...defaultPublishSettings('mediamtx'),
			rememberToken: false,
			bearerToken: 'stale-secret'
		});
		expect(parsed).not.toBeNull();
		expect(parsed?.bearerToken).toBeUndefined();
	});

	it('parsePublishSettings rejects malformed records', () => {
		expect(parsePublishSettings(null)).toBeNull();
		expect(parsePublishSettings({ endpointType: 'rtmp' })).toBeNull();
		expect(
			parsePublishSettings({ ...defaultPublishSettings(), videoBitrateKbps: 'fast' })
		).toBeNull();
	});

	it('project serialization structurally excludes publish settings and tokens', () => {
		// R7.3: ProjectDoc (the input to autosave and Phase 23 bundles) carries no
		// publish fields, so a bundle cannot leak a destination or token.
		const serialized = serializeProject({ projectId: 'project-1', timeline: [], sources: [] });
		const json = JSON.stringify(serialized).toLowerCase();
		expect(json).not.toContain('bearertoken');
		expect(json).not.toContain('endpointurl');
		expect(json).not.toContain('publish');
	});
});
