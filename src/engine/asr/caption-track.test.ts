import { describe, expect, it } from 'vite-plus/test';
import { createAsrCaptionTrack } from './caption-track';

describe('createAsrCaptionTrack', () => {
	it('creates visible sidecar subtitle tracks from ASR segments', () => {
		const track = createAsrCaptionTrack({
			segments: [{ id: 'worker-seg-0', start: 0, duration: 1.5, text: 'hello world' }],
			trackName: 'Auto (en) - sample.mp4',
			language: 'en',
			engine: 'ort-whisper',
			accelerator: 'wasm',
			phraseLevel: false,
			createdAt: '2026-06-13T00:00:00.000Z'
		});

		expect(track.name).toBe('Auto (en) - sample.mp4');
		expect(track.visible).toBe(true);
		expect(track.burnedIn).toBe(false);
		expect(track.segments).toHaveLength(1);
		expect(track.segments[0]!.id).not.toBe('worker-seg-0');
		expect(JSON.parse(track.generatedBy ?? '{}')).toMatchObject({
			generatedBy: 'auto-captions-phase-29',
			engine: 'ort-whisper',
			accelerator: 'wasm',
			language: 'en',
			phraseLevel: false,
			createdAt: '2026-06-13T00:00:00.000Z'
		});
	});
});
