/** Phase 32b: Primary face selection and handoff.
 *
 *  Detection produces candidate boxes and sparse detector landmarks.
 *  This module selects the primary face using a weighted score of
 *  detection confidence, box area, centrality, and temporal continuity.
 */

// ─── Types ──────────────────────────────────────────────────────────────

export interface FaceCandidate {
	/** Unique face identifier for temporal continuity tracking. */
	faceId: string;
	/** Detection confidence [0, 1]. */
	confidence: number;
	/** Normalized bounding box [x, y, w, h] in clip-local coords [0, 1]. */
	box: [number, number, number, number];
	/** Timestamp of this detection in timeline seconds. */
	t: number;
}

export interface PrimaryFaceState {
	/** Currently selected primary face id, or null. */
	currentId: string | null;
	/** Timestamp of last primary face detection. */
	lastT: number;
	/** Number of consecutive frames with no face detected. */
	noFaceFrames: number;
	/** Whether the warp should ramp to identity. */
	rampToIdentity: boolean;
}

// ─── Scoring weights ────────────────────────────────────────────────────

const W_CONFIDENCE = 0.45;
const W_AREA = 0.25;
const W_CENTRALITY = 0.2;
const W_CONTINUITY = 0.1;
const MIN_CONFIDENCE = 0.3;

// ─── Helpers ────────────────────────────────────────────────────────────

/** Normalized area of the bounding box (w × h). */
function normalizedArea(box: [number, number, number, number]): number {
	return box[2] * box[3];
}

/** Centrality score: 1.0 when box center is at frame center, 0.0 at edges. */
function centralityScore(box: [number, number, number, number]): number {
	const cx = box[0] + box[2] / 2;
	const cy = box[1] + box[3] / 2;
	// Distance from center (0.5, 0.5), normalized so edge = 0
	const dx = (cx - 0.5) * 2;
	const dy = (cy - 0.5) * 2;
	const dist = Math.sqrt(dx * dx + dy * dy);
	return Math.max(0, 1 - dist);
}

/** Continuity bonus: 1.0 when same face as previous, 0.0 for new face. */
function continuityScore(candidateId: string, currentId: string | null): number {
	return candidateId === currentId ? 1.0 : 0.0;
}

// ─── Scoring ────────────────────────────────────────────────────────────

/** Compute the primary face score for a candidate. */
export function scoreCandidate(candidate: FaceCandidate, currentPrimaryId: string | null): number {
	return (
		candidate.confidence * W_CONFIDENCE +
		normalizedArea(candidate.box) * W_AREA +
		centralityScore(candidate.box) * W_CENTRALITY +
		continuityScore(candidate.faceId, currentPrimaryId) * W_CONTINUITY
	);
}

/** Select the primary face from a list of candidates. */
export function selectPrimaryFace(
	candidates: FaceCandidate[],
	currentPrimaryId: string | null
): FaceCandidate | null {
	if (candidates.length === 0) return null;

	let best = candidates[0]!;
	let bestScore = scoreCandidate(best, currentPrimaryId);

	for (let i = 1; i < candidates.length; i++) {
		const c = candidates[i]!;
		const s = scoreCandidate(c, currentPrimaryId);
		if (s > bestScore) {
			best = c;
			bestScore = s;
		}
	}

	return best;
}

// ─── State machine ──────────────────────────────────────────────────────

/** Create initial primary face state. */
export function createPrimaryFaceState(): PrimaryFaceState {
	return {
		currentId: null,
		lastT: 0,
		noFaceFrames: 0,
		rampToIdentity: false
	};
}

/** Maximum consecutive no-face frames before resetting. */
const MAX_NO_FACE_FRAMES = 30;

/**
 * Update primary face state with new detection results.
 * Returns the selected primary face, or null if no face is found.
 * Sets rampToIdentity when handoff or confidence loss occurs.
 */
export function updatePrimaryFace(
	state: PrimaryFaceState,
	candidates: FaceCandidate[],
	t: number
): FaceCandidate | null {
	if (candidates.length === 0) {
		state.noFaceFrames++;
		if (state.noFaceFrames > MAX_NO_FACE_FRAMES && state.currentId !== null) {
			// Lost face for too long — reset
			state.currentId = null;
			state.rampToIdentity = true;
		}
		return null;
	}

	state.noFaceFrames = 0;

	const selected = selectPrimaryFace(candidates, state.currentId);
	if (!selected) return null;

	// Check for handoff (different face selected)
	if (state.currentId !== null && selected.faceId !== state.currentId) {
		state.rampToIdentity = true;
	}

	// Confidence loss means the caller should stop using landmarks for this face.
	if (selected.confidence < MIN_CONFIDENCE) {
		if (state.currentId !== null) {
			state.rampToIdentity = true;
			state.currentId = null;
		}
		state.lastT = t;
		return null;
	}

	state.currentId = selected.faceId;
	state.lastT = t;

	return selected;
}

/** Acknowledge the identity ramp (called after warp strength reaches 0). */
export function acknowledgeRamp(state: PrimaryFaceState): void {
	state.rampToIdentity = false;
}
