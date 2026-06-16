/** Phase 43: DOM event log for own-tab capture sessions.
 *
 *  During an own-tab (`getDisplayMedia` with `preferCurrentTab: true`) Phase 41
 *  recording session, capture-phase listeners record timestamped click and
 *  scroll events as a sidecar. The log is flushed to OPFS at session stop.
 *  Scroll position uses the event target when a sub-element scrolls, and
 *  `wheel` events provide optional deltaY because `scroll` events do not.
 */

/** One recorded DOM event during an own-tab capture session. */
export interface DomEventLogEntry {
	/** µs on the Phase 41 capture clock (epochUs + performance.now()*1000). */
	t: number;
	kind: 'click' | 'scroll';
	/** Normalised viewport position, 0–1. */
	x: number;
	/** Normalised viewport position, 0–1. */
	y: number;
	/** Scroll delta in pixels (wheel events only). */
	deltaY?: number;
	// NOTE: 'key' channel reserved for Phase 44 opt-in shortcut-keys extension.
}

/** Versioned JSON written to OPFS as events.json at session stop. */
export interface DomEventLog {
	eventLogSchemaVersion: 1;
	sessionId: string;
	events: DomEventLogEntry[];
	// NOTE: 'key' channel reserved for Phase 44 opt-in shortcut-keys extension.
}

/** Sidecar reference stored in ProjectDoc; the actual log stays in OPFS. */
export interface SessionEventLogRef {
	sessionId: string;
	sourceId: string;
	opfsPath: string;
}

/**
 * Main-thread capture-phase listener set, installed/removed by the capture
 * session manager for own-tab sessions only.
 */
export class CaptureSessionDomEventLogger {
	private clickHandler: ((e: Event) => void) | null = null;
	private scrollHandler: ((e: Event) => void) | null = null;
	private wheelHandler: ((e: Event) => void) | null = null;
	private _entries: DomEventLogEntry[] = [];
	private installed = false;

	constructor(
		private readonly epochUs: number,
		private readonly sessionId: string
	) {}

	get entries(): readonly DomEventLogEntry[] {
		return this._entries;
	}

	/** Install capture-phase click plus passive wheel/window and scroll/document listeners. */
	install(): void {
		if (this.installed) return;
		this.installed = true;

		const toUs = (perfNow: number) => this.epochUs + Math.round(perfNow * 1000);

		this.clickHandler = (e: Event) => {
			const ce = e as MouseEvent;
			const x = clamp01(ce.clientX / window.innerWidth);
			const y = clamp01(ce.clientY / window.innerHeight);
			this._entries.push({ t: toUs(performance.now()), kind: 'click', x, y });
		};

		// Wheel events carry deltaY (scroll events do not).
		this.wheelHandler = (e: Event) => {
			const we = e as WheelEvent;
			const pos = getScrollPosition(we.target);
			this._entries.push({
				t: toUs(performance.now()),
				kind: 'scroll',
				x: pos.x,
				y: pos.y,
				deltaY: we.deltaY
			});
		};

		// Scroll events track position changes (passive, never calls preventDefault).
		this.scrollHandler = (e: Event) => {
			const pos = getScrollPosition(e.target);
			this._entries.push({ t: toUs(performance.now()), kind: 'scroll', x: pos.x, y: pos.y });
		};

		window.addEventListener('click', this.clickHandler, { capture: true });
		window.addEventListener('wheel', this.wheelHandler, { passive: true });
		document.addEventListener('scroll', this.scrollHandler, { passive: true });
	}

	/** Remove listeners (idempotent). */
	remove(): void {
		if (!this.installed) return;
		this.installed = false;

		if (this.clickHandler) {
			window.removeEventListener('click', this.clickHandler, {
				capture: true
			} as EventListenerOptions);
			this.clickHandler = null;
		}
		if (this.wheelHandler) {
			window.removeEventListener('wheel', this.wheelHandler);
			this.wheelHandler = null;
		}
		if (this.scrollHandler) {
			document.removeEventListener('scroll', this.scrollHandler);
			this.scrollHandler = null;
		}
	}

	/** Flush the in-memory log to events.json in the session OPFS directory. */
	async flush(sessionDir: FileSystemDirectoryHandle): Promise<void> {
		const log: DomEventLog = {
			eventLogSchemaVersion: 1,
			sessionId: this.sessionId,
			events: this._entries
		};
		const handle = await sessionDir.getFileHandle('events.json', { create: true });
		const writable = await handle.createWritable();
		await writable.write(serializeDomEventLog(log));
		await writable.close();
	}
}

/**
 * Get normalised scroll position from the event target (sub-element aware).
 */
function getScrollPosition(target: EventTarget | null): { x: number; y: number } {
	// Try sub-element scroll first
	if (target && target instanceof HTMLElement && target !== document.documentElement) {
		const el = target;
		const maxScrollX = Math.max(1, el.scrollWidth - el.clientWidth);
		const maxScrollY = Math.max(1, el.scrollHeight - el.clientHeight);
		return {
			x: clamp01(el.scrollLeft / maxScrollX),
			y: clamp01(el.scrollTop / maxScrollY)
		};
	}
	// Fall back to window/document scroll
	const se = document.scrollingElement;
	if (!se) return { x: 0, y: 0 };
	const maxScrollX = Math.max(1, se.scrollWidth - window.innerWidth);
	const maxScrollY = Math.max(1, se.scrollHeight - window.innerHeight);
	return {
		x: clamp01(window.scrollX / maxScrollX),
		y: clamp01(window.scrollY / maxScrollY)
	};
}

function clamp01(v: number): number {
	return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
}

/** Normalise a raw entry: clamp x/y, require finite t, require valid kind. */
export function normalizeDomEventLogEntry(raw: unknown): DomEventLogEntry | null {
	if (typeof raw !== 'object' || raw === null) return null;
	const obj = raw as Record<string, unknown>;
	if (typeof obj.t !== 'number' || !Number.isFinite(obj.t)) return null;
	if (obj.kind !== 'click' && obj.kind !== 'scroll') return null;
	const x = typeof obj.x === 'number' ? clamp01(obj.x) : 0;
	const y = typeof obj.y === 'number' ? clamp01(obj.y) : 0;
	const entry: DomEventLogEntry = { t: obj.t, kind: obj.kind, x, y };
	if (obj.kind === 'scroll' && typeof obj.deltaY === 'number' && Number.isFinite(obj.deltaY)) {
		entry.deltaY = obj.deltaY;
	}
	return entry;
}

/** Parse a raw JSON value into a DomEventLog, or return null. */
export function parseDomEventLog(json: unknown): DomEventLog | null {
	if (typeof json !== 'object' || json === null) return null;
	const obj = json as Record<string, unknown>;
	if (obj.eventLogSchemaVersion !== 1) return null;
	if (typeof obj.sessionId !== 'string') return null;
	if (!Array.isArray(obj.events)) return null;
	const events: DomEventLogEntry[] = [];
	for (const raw of obj.events) {
		const entry = normalizeDomEventLogEntry(raw);
		if (entry) events.push(entry);
	}
	return { eventLogSchemaVersion: 1, sessionId: obj.sessionId, events };
}

/** Serialise a DomEventLog to JSON string. */
export function serializeDomEventLog(log: DomEventLog): string {
	return JSON.stringify(log);
}

/**
 * Stable synchronous hash for auto-zoom proposal IDs. This path is hot during
 * clustering, so use two FNV-1a 32-bit passes instead of async WebCrypto.
 */
export function stableProposalId(input: string): string {
	return `${fnv1a32(input, 0x811c9dc5).toString(16).padStart(8, '0')}${fnv1a32(input, 0x01000193).toString(16).padStart(8, '0')}`;
}

function fnv1a32(input: string, seed: number): number {
	let hash = seed >>> 0;
	for (let i = 0; i < input.length; i += 1) {
		hash ^= input.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}
