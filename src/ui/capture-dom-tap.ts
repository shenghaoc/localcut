/** Phase 41 — main-thread own-tab DOM event tap.
 *
 *  Owned by App.tsx as a singleton; the worker drives the lifecycle by posting
 *  `capture-dom-tap-init` (when a CaptureSession starts) and `capture-dom-tap-stop`
 *  (when it ends). Between those messages this module installs capture-phase
 *  passive listeners on `document` plus any explicitly attached same-origin iframe
 *  documents, runs each `keydown` through the existing `shouldRecordKey` gate, and
 *  writes records into the SAB ring the worker allocated. No DOM listeners are
 *  installed when no session is active — installing only on `init` keeps the cost
 *  zero outside recording and prevents the panel/tap from double-capturing.
 *
 *  Same-origin iframes attach explicitly via `attachDocument(doc)`. Cross-origin
 *  documents are rejected at attach time (we cannot read their `defaultView.location`
 *  without throwing). Callers are responsible for `detachDocument(doc)` before the
 *  iframe is removed from the DOM — we don't observe iframe lifecycle.
 */

import {
	CaptureEventRingWriter,
	packModifierFlags,
	validateCaptureEventRing
} from '../engine/capture/event-ring';
import { formatKeyCombo, shouldRecordKey } from '../engine/capture/event-log';
import { CaptureEventType } from '../protocol';

export interface CaptureDomTap {
	/** Default `document` is auto-attached on session start. Use this to add
	 *  same-origin iframe documents. Returns `false` for cross-origin documents
	 *  (no listeners installed); also returns `false` when called outside an
	 *  active session — callers should attach during session lifetime. */
	attachDocument(doc: Document): boolean;
	/** Detach must be called before the document is destroyed (e.g. iframe unmount). */
	detachDocument(doc: Document): void;
	/** Internal: called when the worker signals a session start. */
	start(sessionId: string, ring: SharedArrayBuffer, epochMs: number): void;
	/** Internal: pause the tap clock so events recorded during the session pause
	 *  don't drift from the gap-collapsed media. Listeners stay attached so the
	 *  pause itself is captured at its true t and so resumes resume cleanly. */
	pause(): void;
	/** Internal: resume the tap clock. */
	resume(): void;
	/** Internal: called on session stop or unload. */
	stop(): void;
	/** Currently active session id, or null. */
	activeSessionId(): string | null;
	/** For diagnostics: number of records dropped because the ring was full. */
	droppedSinceStart(): number;
}

interface AttachedDocument {
	doc: Document;
	handlers: {
		keydown: (event: KeyboardEvent) => void;
		pointerdown: (event: PointerEvent) => void;
		pointerup: (event: PointerEvent) => void;
	};
}

/** True if we can read `doc.defaultView.location.origin` without throwing. */
function isSameOriginDocument(doc: Document): boolean {
	try {
		const view = doc.defaultView;
		if (!view) return false;
		// Touching `location.origin` on a cross-origin frame throws SecurityError.
		// We don't compare against window.origin — same-origin iframes may live at
		// the same origin under a different path, and that's what we want.
		void view.location.origin;
		return true;
	} catch {
		return false;
	}
}

export function createCaptureDomTap(): CaptureDomTap {
	let writer: CaptureEventRingWriter | null = null;
	let sessionId: string | null = null;
	let epochMs = 0;
	/** Accumulated paused-millis across all completed pause intervals. */
	let pausedAccumulatorMs = 0;
	/** `performance.timeOrigin + performance.now()` at the start of the current
	 *  pause, or null when not paused. */
	let pauseStartedAtMs: number | null = null;
	const attached = new Map<Document, AttachedDocument>();

	function nowUsSinceEpoch(): number {
		// epochMs from the worker is `performance.timeOrigin + performance.now()` —
		// a wall-clock-equivalent absolute timestamp. We compute the same on main so
		// the subtraction yields the wall-clock delta, immune to per-realm `timeOrigin`
		// differences. Subtract pausedAccumulator + current paused interval so
		// timestamps mirror the session's gap-collapsed media clock.
		const nowAbsMs = performance.timeOrigin + performance.now();
		let activeMs = nowAbsMs - epochMs - pausedAccumulatorMs;
		if (pauseStartedAtMs !== null) {
			activeMs -= nowAbsMs - pauseStartedAtMs;
		}
		return Math.max(0, Math.floor(activeMs * 1000));
	}

	function buildHandlers(): AttachedDocument['handlers'] {
		return {
			keydown: (event: KeyboardEvent) => {
				if (!writer) return;
				if (!shouldRecordKey(event)) return;
				writer.writeKey(formatKeyCombo(event), packModifierFlags(event), nowUsSinceEpoch());
			},
			pointerdown: (event: PointerEvent) => {
				if (!writer) return;
				writer.writePointer(
					CaptureEventType.POINTER_DOWN,
					packModifierFlags(event),
					nowUsSinceEpoch(),
					event.clientX,
					event.clientY
				);
			},
			pointerup: (event: PointerEvent) => {
				if (!writer) return;
				writer.writePointer(
					CaptureEventType.POINTER_UP,
					packModifierFlags(event),
					nowUsSinceEpoch(),
					event.clientX,
					event.clientY
				);
			}
		};
	}

	function attachInternal(doc: Document): AttachedDocument | null {
		if (attached.has(doc)) return attached.get(doc)!;
		if (!isSameOriginDocument(doc)) return null;
		const handlers = buildHandlers();
		// Capture-phase + passive so we never block UI and run before per-element handlers.
		const opts: AddEventListenerOptions = { capture: true, passive: true };
		doc.addEventListener('keydown', handlers.keydown, opts);
		doc.addEventListener('pointerdown', handlers.pointerdown, opts);
		doc.addEventListener('pointerup', handlers.pointerup, opts);
		const entry: AttachedDocument = { doc, handlers };
		attached.set(doc, entry);
		return entry;
	}

	function detachInternal(entry: AttachedDocument): void {
		const opts: EventListenerOptions = { capture: true };
		try {
			entry.doc.removeEventListener('keydown', entry.handlers.keydown, opts);
			entry.doc.removeEventListener('pointerdown', entry.handlers.pointerdown, opts);
			entry.doc.removeEventListener('pointerup', entry.handlers.pointerup, opts);
		} catch {
			// Document may already be torn down; best-effort removal is fine.
		}
	}

	return {
		attachDocument(doc: Document): boolean {
			if (!writer) return false;
			return attachInternal(doc) !== null;
		},
		detachDocument(doc: Document): void {
			const entry = attached.get(doc);
			if (!entry) return;
			detachInternal(entry);
			attached.delete(doc);
		},
		start(newSessionId: string, ring: SharedArrayBuffer, newEpochMs: number): void {
			// Idempotent restart: if a session was somehow still bound, tear it down first.
			if (writer) this.stop();
			validateCaptureEventRing(ring);
			writer = new CaptureEventRingWriter(ring);
			sessionId = newSessionId;
			epochMs = newEpochMs;
			pausedAccumulatorMs = 0;
			pauseStartedAtMs = null;
			// Always attach the top-level document; iframes opt-in via attachDocument.
			if (typeof document !== 'undefined') attachInternal(document);
		},
		pause(): void {
			if (!writer || pauseStartedAtMs !== null) return;
			pauseStartedAtMs = performance.timeOrigin + performance.now();
		},
		resume(): void {
			if (!writer || pauseStartedAtMs === null) return;
			pausedAccumulatorMs += performance.timeOrigin + performance.now() - pauseStartedAtMs;
			pauseStartedAtMs = null;
		},
		stop(): void {
			for (const entry of attached.values()) detachInternal(entry);
			attached.clear();
			writer = null;
			sessionId = null;
			epochMs = 0;
			pausedAccumulatorMs = 0;
			pauseStartedAtMs = null;
		},
		activeSessionId(): string | null {
			return sessionId;
		},
		droppedSinceStart(): number {
			return writer?.dropCount() ?? 0;
		}
	};
}
