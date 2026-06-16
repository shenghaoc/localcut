import { describe, expect, it } from 'vite-plus/test';
import { validateSafeZoneFile } from './safe-zones';

const safeZoneData = {
	safeZoneSchemaVersion: 1,
	platforms: [
		{
			id: 'douyin',
			label: 'Douyin',
			aspect: '9:16',
			zones: [
				{
					id: 'douyin-bottom-bar',
					label: 'Bottom UI bar',
					rect: { x: 0, y: 0.75, w: 1, h: 0.25 },
					kind: 'occluded'
				},
				{
					id: 'douyin-right-column',
					label: 'Right column',
					rect: { x: 0.78, y: 0.2, w: 0.22, h: 0.55 },
					kind: 'occluded'
				},
				{
					id: 'douyin-safe',
					label: 'Safe area',
					rect: { x: 0.05, y: 0.08, w: 0.7, h: 0.64 },
					kind: 'caution'
				}
			]
		},
		{
			id: 'xiaohongshu',
			label: 'Xiaohongshu',
			aspect: '9:16',
			zones: [
				{
					id: 'xhs-bottom-bar',
					label: 'Bottom nav',
					rect: { x: 0, y: 0.8, w: 1, h: 0.2 },
					kind: 'occluded'
				},
				{
					id: 'xhs-top-bar',
					label: 'Top bar',
					rect: { x: 0, y: 0, w: 1, h: 0.07 },
					kind: 'occluded'
				},
				{
					id: 'xhs-safe',
					label: 'Safe area',
					rect: { x: 0.05, y: 0.1, w: 0.9, h: 0.68 },
					kind: 'caution'
				}
			]
		},
		{
			id: 'shorts',
			label: 'YouTube Shorts',
			aspect: '9:16',
			zones: [
				{
					id: 'shorts-bottom-bar',
					label: 'Bottom bar',
					rect: { x: 0, y: 0.72, w: 1, h: 0.28 },
					kind: 'occluded'
				},
				{
					id: 'shorts-right-column',
					label: 'Right column',
					rect: { x: 0.8, y: 0.2, w: 0.2, h: 0.52 },
					kind: 'occluded'
				},
				{
					id: 'shorts-safe',
					label: 'Safe area',
					rect: { x: 0.05, y: 0.06, w: 0.7, h: 0.65 },
					kind: 'caution'
				}
			]
		},
		{
			id: 'reels',
			label: 'Instagram Reels',
			aspect: '9:16',
			zones: [
				{
					id: 'reels-bottom-bar',
					label: 'Bottom bar',
					rect: { x: 0, y: 0.7, w: 1, h: 0.3 },
					kind: 'occluded'
				},
				{
					id: 'reels-right-column',
					label: 'Right column',
					rect: { x: 0.78, y: 0.18, w: 0.22, h: 0.52 },
					kind: 'occluded'
				},
				{
					id: 'reels-safe',
					label: 'Safe area',
					rect: { x: 0.05, y: 0.08, w: 0.68, h: 0.6 },
					kind: 'caution'
				}
			]
		}
	]
};

describe('validateSafeZoneFile', () => {
	it('accepts valid data', () => {
		const result = validateSafeZoneFile(safeZoneData);
		expect(result).not.toBeNull();
		expect(result!.platforms.length).toBe(4);
	});

	it('rejects safeZoneSchemaVersion !== 1', () => {
		expect(validateSafeZoneFile({ safeZoneSchemaVersion: 2, platforms: [] })).toBeNull();
	});

	it('rejects empty platforms', () => {
		expect(validateSafeZoneFile({ safeZoneSchemaVersion: 1, platforms: [] })).toBeNull();
	});

	it('rejects rect where x + w > 1', () => {
		expect(
			validateSafeZoneFile({
				safeZoneSchemaVersion: 1,
				platforms: [
					{
						id: 't',
						label: 'T',
						aspect: '9:16',
						zones: [{ id: 'z', label: 'Z', rect: { x: 0.5, y: 0, w: 0.6, h: 1 }, kind: 'occluded' }]
					}
				]
			})
		).toBeNull();
	});

	it('rejects unknown kind', () => {
		expect(
			validateSafeZoneFile({
				safeZoneSchemaVersion: 1,
				platforms: [
					{
						id: 't',
						label: 'T',
						aspect: '9:16',
						zones: [{ id: 'z', label: 'Z', rect: { x: 0, y: 0, w: 1, h: 1 }, kind: 'bad' }]
					}
				]
			})
		).toBeNull();
	});

	it('returns null for null input', () => {
		expect(validateSafeZoneFile(null)).toBeNull();
	});
	it('returns null for string input', () => {
		expect(validateSafeZoneFile('x')).toBeNull();
	});

	it('validates all zones in shipped data', () => {
		const result = validateSafeZoneFile(safeZoneData);
		expect(result).not.toBeNull();
		for (const p of result!.platforms) {
			for (const z of p.zones) {
				expect(['occluded', 'caution']).toContain(z.kind);
				expect(z.rect.x + z.rect.w).toBeLessThanOrEqual(1.0001);
			}
		}
	});
});
