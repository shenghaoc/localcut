/**
 * Phase 40 (T4.3): translated caption-track creation.
 */
import { describe, expect, it } from 'vite-plus/test';
import { createTranslatedCaptionTrack } from './caption-track';

describe('createTranslatedCaptionTrack', () => {
	it('copies segment timing verbatim and stamps phase-40 metadata', () => {
		const track = createTranslatedCaptionTrack({
			segments: [
				{ id: 'w0', start: 0, duration: 1.5, text: '你好' },
				{ id: 'w1', start: 1.5, duration: 2, text: '世界' }
			],
			trackName: 'Clip (zh)',
			language: 'zh',
			sourceTrackId: 'src-1',
			createdAt: '2026-06-15T00:00:00.000Z'
		});

		expect(track.name).toBe('Clip (zh)');
		expect(track.language).toBe('zh');
		expect(track.visible).toBe(true);
		expect(track.burnedIn).toBe(false);
		expect(track.segments).toHaveLength(2);
		// Timing preserved 1:1.
		expect(track.segments[0]!.start).toBe(0);
		expect(track.segments[0]!.duration).toBe(1.5);
		expect(track.segments[1]!.start).toBe(1.5);
		expect(track.segments[1]!.duration).toBe(2);
		// Worker re-assigns ids.
		expect(track.segments[0]!.id).not.toBe('w0');
		expect(track.segments[0]!.id).not.toBe(track.segments[1]!.id);
		expect(JSON.parse(track.generatedBy ?? '{}')).toMatchObject({
			generatedBy: 'language-tools-phase-40',
			sourceTrackId: 'src-1',
			language: 'zh',
			createdAt: '2026-06-15T00:00:00.000Z'
		});
	});
});
