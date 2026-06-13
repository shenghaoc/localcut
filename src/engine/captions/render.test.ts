import { describe, expect, it } from 'vite-plus/test';
import { activeCaptionPayloadsAt, captionTextureId } from './render';
import { createCaptionTrack } from './types';
import type { CaptionTrack } from './types';
import { CAPTION_ANIM_IDENTITY } from './animation-curves';
import { ANIM_CAPTION_PRESETS } from './anim-style';

/** Helper: a single-segment track active at t=0..5 */
function trackWithSegment(
	extras: {
		presetId?: string;
		words?: readonly { text: string; startS: number; endS: number }[];
	} = {}
): CaptionTrack {
	return createCaptionTrack({
		id: 'trk',
		burnedIn: true,
		segments: [
			{
				id: 'seg',
				start: 0,
				duration: 5,
				text: 'Hello world',
				style: extras.presetId ? { presetId: extras.presetId as never } : undefined,
				words: extras.words
			}
		]
	});
}

describe('activeCaptionPayloadsAt (Phase 30)', () => {
	it('returns empty array when no segment is active', () => {
		const track = trackWithSegment();
		expect(activeCaptionPayloadsAt([track], 10)).toHaveLength(0);
	});

	it('returns identity uniforms for a no-animation preset (subtitle)', () => {
		const track = trackWithSegment({ presetId: 'subtitle' });
		const [payload] = activeCaptionPayloadsAt([track], 2.5, []);
		expect(payload).toBeDefined();
		expect(payload!.animUniforms).toEqual(CAPTION_ANIM_IDENTITY);
	});

	it('returns non-identity uniforms inside enter window for pop-card', () => {
		const track = trackWithSegment({ presetId: 'pop-card' });
		const preset = ANIM_CAPTION_PRESETS.find((p) => p.id === 'pop-card')!;
		const dur = preset.animation!.durationS;
		// At t = dur/2 we are inside the enter window. Pop overshoots to 1.15 so scaleX > 1.
		const [payload] = activeCaptionPayloadsAt([track], dur / 2, []);
		expect(payload).toBeDefined();
		expect(payload!.animUniforms.opacity).toBeLessThan(1);
		expect(payload!.animUniforms.scaleX).not.toEqual(1); // Animated — not identity scale.
	});

	it('returns identity uniforms during hold phase for pop-card', () => {
		const track = trackWithSegment({ presetId: 'pop-card' });
		const preset = ANIM_CAPTION_PRESETS.find((p) => p.id === 'pop-card')!;
		const dur = preset.animation!.durationS;
		// At t = dur + 0.5 we are in the hold phase.
		const [payload] = activeCaptionPayloadsAt([track], dur + 0.5, []);
		expect(payload!.animUniforms).toEqual(CAPTION_ANIM_IDENTITY);
	});

	it('returns non-identity uniforms during exit window for slide-news', () => {
		const track = trackWithSegment({ presetId: 'slide-news' });
		// Verify slide-news has an exit animation configured.
		expect(ANIM_CAPTION_PRESETS.find((p) => p.id === 'slide-news')!.animation!.exit).not.toBe(
			'none'
		);
		// At t = 4.9 (near segment end at 5s, inside exit window).
		const [payload] = activeCaptionPayloadsAt([track], 4.9, []);
		expect(payload!.animUniforms.opacity).toBeLessThan(1);
	});

	it('uses full-line texture id when words are absent', () => {
		const track = trackWithSegment({ presetId: 'karaoke' });
		const [payload] = activeCaptionPayloadsAt([track], 1.0, []);
		expect(payload!.textureId).toBe(captionTextureId('trk', 'seg'));
	});

	it('switches to highlight texture id when currentTimeS is within a word range', () => {
		const track = trackWithSegment({
			presetId: 'karaoke',
			words: [
				{ text: 'Hello', startS: 0.5, endS: 1.5 },
				{ text: 'world', startS: 1.5, endS: 2.5 }
			]
		});
		const [payload] = activeCaptionPayloadsAt([track], 1.0, []);
		expect(payload!.textureId).toBe(captionTextureId('trk', 'seg', 'highlight'));
	});

	it('populates extras.highlightWord with the active word index for karaoke', () => {
		const track = trackWithSegment({
			presetId: 'karaoke',
			words: [
				{ text: 'Hello', startS: 0.5, endS: 1.5 },
				{ text: 'world', startS: 1.5, endS: 2.5 }
			]
		});
		// Second word is active at t=2.0.
		const [payload] = activeCaptionPayloadsAt([track], 2.0, []);
		expect(payload!.extras?.highlightWord).toBeDefined();
		expect(payload!.extras!.highlightWord!.wordIndex).toBe(1);
		expect(typeof payload!.extras!.highlightWord!.color).toBe('string');
		expect(payload!.extras!.highlightWord!.color.length).toBeGreaterThan(0);
	});

	it('omits extras.highlightWord when outside word ranges', () => {
		const track = trackWithSegment({
			presetId: 'karaoke',
			words: [{ text: 'Hello', startS: 1.0, endS: 2.0 }]
		});
		// t=0.5 is before the first word.
		const [payload] = activeCaptionPayloadsAt([track], 0.5, []);
		expect(payload!.extras?.highlightWord).toBeUndefined();
	});

	it('omits extras.highlightWord for non-karaoke presets even with words', () => {
		const track = trackWithSegment({
			presetId: 'subtitle',
			words: [{ text: 'Hello', startS: 0.5, endS: 1.5 }]
		});
		const [payload] = activeCaptionPayloadsAt([track], 1.0, []);
		expect(payload!.extras?.highlightWord).toBeUndefined();
	});

	it('uses full-line texture id when currentTimeS is outside all word ranges', () => {
		const track = trackWithSegment({
			presetId: 'karaoke',
			words: [{ text: 'Hello', startS: 1.0, endS: 2.0 }]
		});
		// At t=0.5 — before the word.
		const [payload] = activeCaptionPayloadsAt([track], 0.5, []);
		expect(payload!.textureId).toBe(captionTextureId('trk', 'seg'));
	});

	it('uses full-line texture id for karaoke preset without words', () => {
		const track = trackWithSegment({ presetId: 'karaoke' });
		const [payload] = activeCaptionPayloadsAt([track], 1.0, []);
		expect(payload!.textureId).toBe(captionTextureId('trk', 'seg'));
	});

	it('uses full-line texture id for non-karaoke preset even with words', () => {
		const track = trackWithSegment({
			presetId: 'subtitle',
			words: [{ text: 'Hello', startS: 0.5, endS: 1.5 }]
		});
		const [payload] = activeCaptionPayloadsAt([track], 1.0, []);
		expect(payload!.textureId).toBe(captionTextureId('trk', 'seg'));
	});

	it('merges preset.titleStyle into the payload content (Phase 30 colour reaches raster)', () => {
		const neonGlow = ANIM_CAPTION_PRESETS.find((p) => p.id === 'neon-glow')!;
		const track = trackWithSegment({ presetId: 'neon-glow' });
		const [payload] = activeCaptionPayloadsAt([track], 2.5, []);
		expect(payload).toBeDefined();
		// neon-glow preset.titleStyle.color is the cyan glow text colour. The
		// payload content style must reflect it — otherwise the raster falls back
		// to the layout-only CAPTION_PRESETS subtitle entry and renders white.
		expect(payload!.content.style.color).toBe(neonGlow.titleStyle.color);
	});

	it('resolves a custom preset passed via customPresets', () => {
		const custom = {
			...ANIM_CAPTION_PRESETS[0]!,
			id: 'my-custom',
			label: 'Custom',
			builtIn: false,
			animation: { enter: 'pop' as const, exit: 'none' as const, durationS: 0.3 }
		};
		const track = trackWithSegment({ presetId: 'my-custom' });
		const [payload] = activeCaptionPayloadsAt([track], 0.1, [custom]);
		// Inside enter window — should have non-identity uniforms.
		expect(payload!.animUniforms.opacity).toBeLessThan(1);
	});
});
