import { describe, it, expect } from 'vite-plus/test';
import {
	calloutContentHash,
	normalizeCalloutPayload,
	parseCalloutPayload,
	type CalloutPayload
} from './callout';

describe('calloutContentHash', () => {
	it('changes when style.color changes', () => {
		const base: CalloutPayload = {
			calloutKind: 'arrow',
			geometry: { kind: 'arrow', x1: 0, y1: 0, x2: 1, y2: 1 },
			style: {
				color: '#FFD700',
				strokeWidth: 3,
				fillOpacity: 0,
				fontSize: 28,
				arrowheadSize: 14,
				blurRadius: 12,
				darkenStrength: 0.7
			}
		};
		const h1 = calloutContentHash(base);
		const h2 = calloutContentHash({ ...base, style: { ...base.style, color: '#FF0000' } });
		expect(h1).not.toBe(h2);
	});

	it('changes when style.strokeWidth changes', () => {
		const base: CalloutPayload = {
			calloutKind: 'box',
			geometry: { kind: 'box', x: 0, y: 0, w: 1, h: 1 },
			style: {
				color: '#FFD700',
				strokeWidth: 3,
				fillOpacity: 0,
				fontSize: 28,
				arrowheadSize: 14,
				blurRadius: 12,
				darkenStrength: 0.7
			}
		};
		const h1 = calloutContentHash(base);
		const h2 = calloutContentHash({ ...base, style: { ...base.style, strokeWidth: 6 } });
		expect(h1).not.toBe(h2);
	});

	it('changes when geometry.x1 changes (arrow)', () => {
		const base: CalloutPayload = {
			calloutKind: 'arrow',
			geometry: { kind: 'arrow', x1: 0.2, y1: 0.3, x2: 0.8, y2: 0.7 },
			style: {
				color: '#FFD700',
				strokeWidth: 3,
				fillOpacity: 0,
				fontSize: 28,
				arrowheadSize: 14,
				blurRadius: 12,
				darkenStrength: 0.7
			}
		};
		const h1 = calloutContentHash(base);
		const h2 = calloutContentHash({
			...base,
			geometry: { kind: 'arrow', x1: 0.5, y1: 0.3, x2: 0.8, y2: 0.7 }
		});
		expect(h1).not.toBe(h2);
	});

	it('does not change on identical inputs', () => {
		const payload: CalloutPayload = {
			calloutKind: 'step',
			geometry: { kind: 'step', cx: 0.5, cy: 0.5, r: 0.05, number: 1 },
			style: {
				color: '#FFD700',
				strokeWidth: 3,
				fillOpacity: 0,
				fontSize: 28,
				arrowheadSize: 14,
				blurRadius: 12,
				darkenStrength: 0.7
			}
		};
		expect(calloutContentHash(payload)).toBe(calloutContentHash(payload));
	});
});

describe('parseCalloutPayload', () => {
	it('accepts valid arrow payload', () => {
		const result = parseCalloutPayload({
			calloutKind: 'arrow',
			geometry: { kind: 'arrow', x1: 0, y1: 0, x2: 1, y2: 1 },
			style: {
				color: '#FFD700',
				strokeWidth: 3,
				fillOpacity: 0,
				fontSize: 28,
				arrowheadSize: 14,
				blurRadius: 12,
				darkenStrength: 0.7
			}
		});
		expect(result).not.toBeNull();
		expect(result!.calloutKind).toBe('arrow');
	});

	it('rejects missing calloutKind', () => {
		expect(parseCalloutPayload({ geometry: {}, style: {} })).toBeNull();
	});

	it('rejects unknown calloutKind', () => {
		expect(parseCalloutPayload({ calloutKind: 'unknown', geometry: {}, style: {} })).toBeNull();
	});

	it('rejects geometry missing required field', () => {
		expect(
			parseCalloutPayload({
				calloutKind: 'arrow',
				geometry: { kind: 'arrow', x1: 0, y1: 0 }, // missing x2, y2
				style: {}
			})
		).toBeNull();
	});
});

describe('normalizeCalloutPayload', () => {
	it('fills style defaults', () => {
		const result = normalizeCalloutPayload({ calloutKind: 'box' });
		expect(result.style.color).toBe('#FFD700');
		expect(result.style.strokeWidth).toBe(3);
		expect(result.style.fillOpacity).toBe(0);
	});

	it('round-trips through parse/normalize for all five kinds', () => {
		const kinds = ['arrow', 'box', 'step', 'spotlight', 'blur'] as const;
		for (const kind of kinds) {
			const normalized = normalizeCalloutPayload({ calloutKind: kind });
			const json = JSON.stringify(normalized);
			const parsed = parseCalloutPayload(JSON.parse(json));
			expect(parsed).not.toBeNull();
			expect(parsed).toEqual(normalized);
		}
	});
});
