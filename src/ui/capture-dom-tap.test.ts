/** Phase 41 — main-thread CaptureDomTap lifecycle.
 *
 *  Verifies the listener install/uninstall lifecycle, the cross-origin attach
 *  rejection, and that events flowing through the registered listeners land in
 *  the SAB ring in a form the worker-side reader can drain.
 */

import { describe, expect, it } from 'vite-plus/test';
import { createCaptureDomTap } from './capture-dom-tap';
import { allocateCaptureEventRing, CaptureEventRingReader } from '../engine/capture/event-ring';
import { CaptureEventModifier } from '../protocol';

type EventName = 'keydown' | 'pointerdown' | 'pointerup';

interface FakeDocument {
	defaultView: { location: { origin: string } } | null;
	listeners: Map<EventName, EventListener[]>;
	addEventListener: (name: EventName, fn: EventListener, opts?: AddEventListenerOptions) => void;
	removeEventListener: (name: EventName, fn: EventListener, opts?: EventListenerOptions) => void;
	dispatch: (name: EventName, event: unknown) => void;
}

function makeFakeDocument(opts: { crossOrigin?: boolean } = {}): FakeDocument {
	const listeners = new Map<EventName, EventListener[]>();
	const defaultView: FakeDocument['defaultView'] = opts.crossOrigin
		? // Touching `location.origin` should throw — emulate the cross-origin gate.
			({
				get location() {
					throw new DOMException('cross-origin', 'SecurityError');
				}
			} as unknown as FakeDocument['defaultView'])
		: { location: { origin: 'https://app.example' } };
	return {
		defaultView,
		listeners,
		addEventListener(name, fn) {
			const list = listeners.get(name) ?? [];
			list.push(fn);
			listeners.set(name, list);
		},
		removeEventListener(name, fn) {
			const list = listeners.get(name);
			if (!list) return;
			listeners.set(
				name,
				list.filter((l) => l !== fn)
			);
		},
		dispatch(name, event) {
			const list = listeners.get(name) ?? [];
			for (const fn of list) fn(event as Event);
		}
	};
}

describe('createCaptureDomTap', () => {
	it('start() and stop() install + remove capture-phase listeners on the top-level document', () => {
		const tap = createCaptureDomTap();
		const ring = allocateCaptureEventRing(1);
		const fakeDoc = makeFakeDocument();
		// Override `document` for the duration of this test by stubbing the module
		// — we can't mutate the real `document`, so we drive lifecycle through the
		// public attachDocument API instead.
		tap.start('session-x', ring, performance.now());
		expect(tap.attachDocument(fakeDoc as unknown as Document)).toBe(true);

		// All three listeners installed.
		expect(fakeDoc.listeners.get('keydown')?.length).toBe(1);
		expect(fakeDoc.listeners.get('pointerdown')?.length).toBe(1);
		expect(fakeDoc.listeners.get('pointerup')?.length).toBe(1);

		tap.stop();

		// All three listeners removed.
		expect(fakeDoc.listeners.get('keydown')?.length ?? 0).toBe(0);
		expect(fakeDoc.listeners.get('pointerdown')?.length ?? 0).toBe(0);
		expect(fakeDoc.listeners.get('pointerup')?.length ?? 0).toBe(0);
	});

	it('attachDocument before start() returns false (no listeners installed)', () => {
		const tap = createCaptureDomTap();
		const fakeDoc = makeFakeDocument();
		expect(tap.attachDocument(fakeDoc as unknown as Document)).toBe(false);
		expect(fakeDoc.listeners.size).toBe(0);
	});

	it('attachDocument rejects cross-origin documents (no listeners installed)', () => {
		const tap = createCaptureDomTap();
		const ring = allocateCaptureEventRing(1);
		tap.start('session-x', ring, performance.now());
		const crossOrigin = makeFakeDocument({ crossOrigin: true });
		expect(tap.attachDocument(crossOrigin as unknown as Document)).toBe(false);
		expect(crossOrigin.listeners.size).toBe(0);
		tap.stop();
	});

	it('keydown that passes the gate lands in the SAB ring; printable text does not', () => {
		const tap = createCaptureDomTap();
		const ring = allocateCaptureEventRing(1);
		const reader = new CaptureEventRingReader(ring);
		const fakeDoc = makeFakeDocument();
		const epoch = performance.now();
		tap.start('session-x', ring, epoch);
		tap.attachDocument(fakeDoc as unknown as Document);

		// Recordable shortcut: Ctrl+S in a non-text element.
		const target = { tagName: 'BODY', getAttribute: () => null, isContentEditable: false };
		fakeDoc.dispatch('keydown', {
			key: 's',
			ctrlKey: true,
			altKey: false,
			metaKey: false,
			shiftKey: false,
			target
		});
		// Plain printable typing: just "a" — gate rejects.
		fakeDoc.dispatch('keydown', {
			key: 'a',
			ctrlKey: false,
			altKey: false,
			metaKey: false,
			shiftKey: false,
			target
		});

		const entries = reader.drain();
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({ kind: 'key', combo: 'Ctrl+S' });

		tap.stop();
	});

	it('pointerdown/pointerup are recorded with coords and modifier flags', () => {
		const tap = createCaptureDomTap();
		const ring = allocateCaptureEventRing(1);
		const reader = new CaptureEventRingReader(ring);
		const fakeDoc = makeFakeDocument();
		tap.start('session-x', ring, performance.now());
		tap.attachDocument(fakeDoc as unknown as Document);

		fakeDoc.dispatch('pointerdown', {
			clientX: 42,
			clientY: 7,
			altKey: true,
			ctrlKey: false,
			metaKey: false,
			shiftKey: false
		});
		fakeDoc.dispatch('pointerup', {
			clientX: 50,
			clientY: 9,
			altKey: false,
			ctrlKey: false,
			metaKey: false,
			shiftKey: false
		});

		const entries = reader.drain();
		expect(entries).toHaveLength(2);
		expect(entries[0]).toMatchObject({
			kind: 'pointer-down',
			x: 42,
			y: 7,
			modifierFlags: CaptureEventModifier.ALT
		});
		expect(entries[1]).toMatchObject({
			kind: 'pointer-up',
			x: 50,
			y: 9,
			modifierFlags: 0
		});

		tap.stop();
	});

	it('detachDocument removes the listeners for that document only', () => {
		const tap = createCaptureDomTap();
		const ring = allocateCaptureEventRing(1);
		const fakeDocA = makeFakeDocument();
		const fakeDocB = makeFakeDocument();
		tap.start('session-x', ring, performance.now());
		tap.attachDocument(fakeDocA as unknown as Document);
		tap.attachDocument(fakeDocB as unknown as Document);
		tap.detachDocument(fakeDocA as unknown as Document);

		expect(fakeDocA.listeners.get('keydown')?.length ?? 0).toBe(0);
		expect(fakeDocB.listeners.get('keydown')?.length).toBe(1);

		tap.stop();
	});

	it('stop() is idempotent — a second call after stop is a no-op', () => {
		const tap = createCaptureDomTap();
		const ring = allocateCaptureEventRing(1);
		tap.start('session-x', ring, performance.now());
		expect(tap.activeSessionId()).toBe('session-x');
		tap.stop();
		expect(tap.activeSessionId()).toBeNull();
		// Calling stop again must not throw.
		expect(() => tap.stop()).not.toThrow();
	});

	it('start() during an active session tears down the previous and starts fresh', () => {
		const tap = createCaptureDomTap();
		const ringA = allocateCaptureEventRing(1);
		const ringB = allocateCaptureEventRing(2);
		const fakeDoc = makeFakeDocument();
		tap.start('session-a', ringA, performance.now());
		tap.attachDocument(fakeDoc as unknown as Document);
		expect(fakeDoc.listeners.get('keydown')?.length).toBe(1);

		tap.start('session-b', ringB, performance.now());
		// Previous listeners removed (no longer pointing at ringA's writer).
		expect(tap.activeSessionId()).toBe('session-b');
		// The previous fakeDoc is not auto-reattached; that's the caller's job.
		expect(fakeDoc.listeners.get('keydown')?.length ?? 0).toBe(0);
		tap.stop();
	});
});
