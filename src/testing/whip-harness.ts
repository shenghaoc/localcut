/**
 * Phase 47 (T10): browser harness for the WHIP integration test. Served by the
 * Vite dev server at /whip-harness.html and driven by Playwright against a
 * MediaMTX container in CI. Test-only: this module is not part of the app
 * build, and the Canvas2D synthetic feed here is a fixture generator, not an
 * editor pipeline path.
 */

import { createWhipSession, type WhipSession } from '../engine/whip-session';
import { defaultPublishSettings } from '../engine/publish-settings';
import type { PublishState } from '../protocol';

interface WhipHarness {
	start(endpointUrl: string, bearerToken?: string): Promise<void>;
	stop(): Promise<void>;
	state(): PublishState['phase'];
	/** Every phase the session passed through, in order, for assertions. */
	phases(): string[];
	lastFailure(): string | null;
}

declare global {
	interface Window {
		__whipHarness: WhipHarness;
	}
}

/** A moving test pattern so the encoder produces real, changing frames. */
function makeSyntheticTrack(): MediaStreamTrack {
	const canvas = document.createElement('canvas');
	canvas.width = 1280;
	canvas.height = 720;
	document.body.append(canvas);
	const context = canvas.getContext('2d');
	if (!context) throw new Error('Canvas2D unavailable in the harness.');

	let frame = 0;
	const draw = () => {
		frame += 1;
		context.fillStyle = '#16161a';
		context.fillRect(0, 0, canvas.width, canvas.height);
		context.fillStyle = `hsl(${(frame * 3) % 360} 80% 55%)`;
		const x = (frame * 7) % (canvas.width - 160);
		context.fillRect(x, 280, 160, 160);
		context.fillStyle = '#ffffff';
		context.font = '48px monospace';
		context.fillText(`frame ${frame}`, 40, 80);
		requestAnimationFrame(draw);
	};
	requestAnimationFrame(draw);

	const stream = (
		canvas as HTMLCanvasElement & { captureStream(frameRate?: number): MediaStream }
	).captureStream(30);
	return stream.getVideoTracks()[0];
}

let session: WhipSession | null = null;
const phases: string[] = [];
let lastFailure: string | null = null;

window.__whipHarness = {
	async start(endpointUrl: string, bearerToken?: string) {
		if (session) throw new Error('Harness session already started.');
		session = createWhipSession({
			createPeerConnection: (config) => new RTCPeerConnection(config)
		});
		session.onState((state: PublishState) => {
			phases.push(state.phase);
			if (state.phase === 'failed') lastFailure = state.reason;
		});
		const settings = {
			...defaultPublishSettings('mediamtx'),
			endpointUrl,
			videoBitrateKbps: 2500,
			maxHeight: 720,
			...(bearerToken !== undefined ? { bearerToken } : {})
		};
		await session.start(settings, { video: makeSyntheticTrack(), audio: null });
	},
	async stop() {
		await session?.stop();
	},
	state() {
		return session?.state.phase ?? 'idle';
	},
	phases() {
		return [...phases];
	},
	lastFailure() {
		return lastFailure;
	}
};
