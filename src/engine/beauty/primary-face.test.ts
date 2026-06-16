/** Phase 32b: Primary face selection tests. */

import { describe, expect, it } from 'vite-plus/test';
import {
	scoreCandidate,
	selectPrimaryFace,
	createPrimaryFaceState,
	updatePrimaryFace,
	acknowledgeRamp,
	type FaceCandidate
} from './primary-face';

function makeCandidate(
	faceId: string,
	confidence: number,
	box: [number, number, number, number],
	t = 0
): FaceCandidate {
	return { faceId, confidence, box, t };
}

describe('scoreCandidate', () => {
	it('weights confidence highest', () => {
		const a = makeCandidate('a', 1.0, [0.3, 0.3, 0.4, 0.4]);
		const b = makeCandidate('b', 0.5, [0.3, 0.3, 0.4, 0.4]);
		expect(scoreCandidate(a, null)).toBeGreaterThan(scoreCandidate(b, null));
	});

	it('rewards larger bounding boxes', () => {
		const small = makeCandidate('s', 0.5, [0.4, 0.4, 0.1, 0.1]);
		const large = makeCandidate('l', 0.5, [0.2, 0.2, 0.6, 0.6]);
		expect(scoreCandidate(large, null)).toBeGreaterThan(scoreCandidate(small, null));
	});

	it('rewards centrality', () => {
		const center = makeCandidate('c', 0.5, [0.3, 0.3, 0.4, 0.4]);
		const edge = makeCandidate('e', 0.5, [0.0, 0.0, 0.2, 0.2]);
		expect(scoreCandidate(center, null)).toBeGreaterThan(scoreCandidate(edge, null));
	});

	it('rewards continuity with previous primary', () => {
		const same = makeCandidate('same', 0.5, [0.3, 0.3, 0.4, 0.4]);
		const diff = makeCandidate('diff', 0.5, [0.3, 0.3, 0.4, 0.4]);
		expect(scoreCandidate(same, 'same')).toBeGreaterThan(scoreCandidate(diff, 'other'));
	});
});

describe('selectPrimaryFace', () => {
	it('returns null for empty candidates', () => {
		expect(selectPrimaryFace([], null)).toBeNull();
	});

	it('selects the highest-scored candidate', () => {
		const candidates = [
			makeCandidate('a', 0.5, [0.4, 0.4, 0.1, 0.1]),
			makeCandidate('b', 0.9, [0.3, 0.3, 0.4, 0.4])
		];
		expect(selectPrimaryFace(candidates, null)?.faceId).toBe('b');
	});

	it('prefers the current primary when scores are close', () => {
		const candidates = [
			makeCandidate('a', 0.8, [0.3, 0.3, 0.3, 0.3]),
			makeCandidate('b', 0.8, [0.3, 0.3, 0.3, 0.3])
		];
		expect(selectPrimaryFace(candidates, 'a')?.faceId).toBe('a');
	});
});

describe('createPrimaryFaceState', () => {
	it('creates initial state', () => {
		const state = createPrimaryFaceState();
		expect(state.currentId).toBeNull();
		expect(state.noFaceFrames).toBe(0);
		expect(state.rampToIdentity).toBe(false);
	});
});

describe('updatePrimaryFace', () => {
	it('selects primary from candidates', () => {
		const state = createPrimaryFaceState();
		const candidates = [makeCandidate('face-1', 0.9, [0.3, 0.3, 0.4, 0.4])];
		const result = updatePrimaryFace(state, candidates, 0);
		expect(result?.faceId).toBe('face-1');
		expect(state.currentId).toBe('face-1');
	});

	it('increments noFaceFrames when no candidates', () => {
		const state = createPrimaryFaceState();
		updatePrimaryFace(state, [], 0);
		expect(state.noFaceFrames).toBe(1);
		expect(updatePrimaryFace(state, [], 0.1)).toBeNull();
		expect(state.noFaceFrames).toBe(2);
	});

	it('sets rampToIdentity on handoff', () => {
		const state = createPrimaryFaceState();
		updatePrimaryFace(state, [makeCandidate('a', 0.9, [0.3, 0.3, 0.4, 0.4])], 0);
		expect(state.rampToIdentity).toBe(false);

		// Different face wins
		updatePrimaryFace(state, [makeCandidate('b', 0.95, [0.3, 0.3, 0.5, 0.5])], 0.1);
		expect(state.rampToIdentity).toBe(true);
	});

	it('sets rampToIdentity on low confidence', () => {
		const state = createPrimaryFaceState();
		updatePrimaryFace(state, [makeCandidate('a', 0.9, [0.3, 0.3, 0.4, 0.4])], 0);

		// Same face, low confidence
		const result = updatePrimaryFace(state, [makeCandidate('a', 0.2, [0.3, 0.3, 0.4, 0.4])], 0.1);
		expect(result).toBeNull();
		expect(state.rampToIdentity).toBe(true);
		expect(state.currentId).toBeNull();
	});

	it('resets after prolonged no-face', () => {
		const state = createPrimaryFaceState();
		updatePrimaryFace(state, [makeCandidate('a', 0.9, [0.3, 0.3, 0.4, 0.4])], 0);

		// 31 frames with no face
		for (let i = 1; i <= 31; i++) {
			updatePrimaryFace(state, [], i * 0.033);
		}
		expect(state.currentId).toBeNull();
		expect(state.rampToIdentity).toBe(true);
	});
});

describe('acknowledgeRamp', () => {
	it('clears rampToIdentity', () => {
		const state = createPrimaryFaceState();
		updatePrimaryFace(state, [makeCandidate('a', 0.9, [0.3, 0.3, 0.4, 0.4])], 0);
		updatePrimaryFace(state, [makeCandidate('b', 0.95, [0.3, 0.3, 0.5, 0.5])], 0.1);
		expect(state.rampToIdentity).toBe(true);
		acknowledgeRamp(state);
		expect(state.rampToIdentity).toBe(false);
	});
});
