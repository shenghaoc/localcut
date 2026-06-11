import { describe, expect, it } from 'vite-plus/test';
import { applyIceRestartAnswer, buildIceRestartFragment } from './whip-sdp';

const LOCAL_SDP = [
	'v=0',
	'o=- 1 2 IN IP4 127.0.0.1',
	's=-',
	't=0 0',
	'a=ice-ufrag:newUfrag',
	'a=ice-pwd:newPwd',
	'm=video 9 UDP/TLS/RTP/SAVPF 96',
	'a=mid:0',
	'a=candidate:1 1 udp 2113937151 192.0.2.10 50000 typ host',
	'a=candidate:2 1 udp 1677729535 198.51.100.10 50001 typ srflx',
	'm=audio 9 UDP/TLS/RTP/SAVPF 111',
	'a=mid:1',
	'a=candidate:3 1 udp 2113937151 192.0.2.10 50002 typ host'
].join('\r\n');

describe('buildIceRestartFragment', () => {
	it('emits ufrag/pwd, m-lines, mids, candidates, and end-of-candidates', () => {
		const fragment = buildIceRestartFragment(LOCAL_SDP);
		const fragmentLines = fragment.trimEnd().split('\r\n');
		expect(fragmentLines[0]).toBe('a=ice-ufrag:newUfrag');
		expect(fragmentLines[1]).toBe('a=ice-pwd:newPwd');
		expect(fragmentLines).toContain('m=video 9 UDP/TLS/RTP/SAVPF 96');
		expect(fragmentLines).toContain('a=mid:0');
		expect(fragmentLines).toContain('a=candidate:3 1 udp 2113937151 192.0.2.10 50002 typ host');
		expect(fragmentLines.filter((line) => line === 'a=end-of-candidates')).toHaveLength(2);
	});

	it('does not duplicate an end-of-candidates marker the local SDP already has', () => {
		const withMarker = LOCAL_SDP.replace('m=audio', 'a=end-of-candidates\r\nm=audio');
		const fragment = buildIceRestartFragment(withMarker);
		const videoSection = fragment.slice(fragment.indexOf('m=video'), fragment.indexOf('m=audio'));
		expect(videoSection.match(/a=end-of-candidates/g)).toHaveLength(1);
	});

	it('throws when the local description lacks ICE credentials', () => {
		expect(() => buildIceRestartFragment('v=0\r\nm=video 9 RTP 96')).toThrow();
	});
});

describe('applyIceRestartAnswer', () => {
	const remoteSdp = [
		'v=0',
		'o=- 9 8 IN IP4 203.0.113.5',
		's=-',
		't=0 0',
		'm=video 9 UDP/TLS/RTP/SAVPF 96',
		'a=mid:0',
		'a=ice-ufrag:oldUfrag',
		'a=ice-pwd:oldPwd',
		'a=candidate:9 1 udp 1 203.0.113.5 4000 typ host',
		'a=end-of-candidates',
		'a=rtpmap:96 H264/90000',
		'm=audio 9 UDP/TLS/RTP/SAVPF 111',
		'a=mid:1',
		'a=ice-ufrag:oldUfrag',
		'a=ice-pwd:oldPwd',
		'a=candidate:9 2 udp 1 203.0.113.5 4001 typ host'
	].join('\r\n');

	const answerFragment = [
		'a=ice-ufrag:srvUfrag',
		'a=ice-pwd:srvPwd',
		'm=video 9 UDP/TLS/RTP/SAVPF 96',
		'a=mid:0',
		'a=candidate:21 1 udp 2 203.0.113.5 4100 typ host',
		'a=end-of-candidates',
		'm=audio 9 UDP/TLS/RTP/SAVPF 111',
		'a=mid:1',
		'a=candidate:22 1 udp 2 203.0.113.5 4101 typ host',
		'a=end-of-candidates'
	].join('\r\n');

	it('swaps credentials and replaces stale candidates per mid', () => {
		const merged = applyIceRestartAnswer(remoteSdp, answerFragment);
		expect(merged).not.toContain('oldUfrag');
		expect(merged).not.toContain('oldPwd');
		expect(merged).not.toContain('a=candidate:9');
		expect(merged.match(/a=ice-ufrag:srvUfrag/g)).toHaveLength(2);

		// The fresh candidates land in their own m-sections.
		const videoSection = merged.slice(merged.indexOf('m=video'), merged.indexOf('m=audio'));
		const audioSection = merged.slice(merged.indexOf('m=audio'));
		expect(videoSection).toContain('a=candidate:21');
		expect(videoSection).not.toContain('a=candidate:22');
		expect(audioSection).toContain('a=candidate:22');

		// Non-ICE attributes survive untouched.
		expect(merged).toContain('a=rtpmap:96 H264/90000');

		// The fragment's end-of-candidates markers are preserved per section —
		// strict implementations require the signal.
		expect(merged.match(/a=end-of-candidates/g)).toHaveLength(2);
	});

	it('throws when the fragment lacks credentials', () => {
		expect(() =>
			applyIceRestartAnswer(remoteSdp, 'a=candidate:1 1 udp 1 1.2.3.4 1 typ host')
		).toThrow();
	});
});
