import { describe, it, expect } from 'vite-plus/test';
import {
	normalizeDomEventLogEntry,
	parseDomEventLog,
	serializeDomEventLog,
	CaptureSessionEventLogger,
	type DomEventLog
} from './dom-event-log';

describe('normalizeDomEventLogEntry', () => {
	it('clamps x/y to 0–1', () => {
		const entry = normalizeDomEventLogEntry({ t: 1000, kind: 'click', x: -0.5, y: 1.5 });
		expect(entry).not.toBeNull();
		expect(entry!.x).toBe(0);
		expect(entry!.y).toBe(1);
	});

	it('rejects non-finite t', () => {
		expect(normalizeDomEventLogEntry({ t: Infinity, kind: 'click', x: 0.5, y: 0.5 })).toBeNull();
		expect(normalizeDomEventLogEntry({ t: NaN, kind: 'click', x: 0.5, y: 0.5 })).toBeNull();
	});

	it('rejects invalid kind', () => {
		expect(normalizeDomEventLogEntry({ t: 1000, kind: 'invalid', x: 0.5, y: 0.5 })).toBeNull();
	});

	it('accepts kind: scroll with deltaY', () => {
		const entry = normalizeDomEventLogEntry({
			t: 1000,
			kind: 'scroll',
			x: 0.5,
			y: 0.5,
			deltaY: -120
		});
		expect(entry).not.toBeNull();
		expect(entry!.kind).toBe('scroll');
		expect(entry!.deltaY).toBe(-120);
	});

	it('returns null for non-object input', () => {
		expect(normalizeDomEventLogEntry(null)).toBeNull();
		expect(normalizeDomEventLogEntry('string')).toBeNull();
		expect(normalizeDomEventLogEntry(42)).toBeNull();
	});
});

describe('parseDomEventLog', () => {
	it('accepts a valid schema-v1 object', () => {
		const log = parseDomEventLog({
			eventLogSchemaVersion: 1,
			sessionId: 'test-session',
			events: [{ t: 1000, kind: 'click', x: 0.5, y: 0.5 }]
		});
		expect(log).not.toBeNull();
		expect(log!.eventLogSchemaVersion).toBe(1);
		expect(log!.sessionId).toBe('test-session');
		expect(log!.events).toHaveLength(1);
	});

	it('rejects missing eventLogSchemaVersion', () => {
		expect(parseDomEventLog({ sessionId: 'test', events: [] })).toBeNull();
	});

	it('rejects wrong version', () => {
		expect(
			parseDomEventLog({ eventLogSchemaVersion: 2, sessionId: 'test', events: [] })
		).toBeNull();
	});

	it('preserves reserved key channel entries for forward compatibility', () => {
		const raw = {
			eventLogSchemaVersion: 1,
			sessionId: 'test',
			events: [
				{ t: 1000, kind: 'click', x: 0.5, y: 0.5 },
				{ t: 2000, kind: 'key', combo: 'Ctrl+Z' }
			]
		};
		const log = parseDomEventLog(raw);
		expect(log).not.toBeNull();
		expect(log!.events).toHaveLength(2);
		expect(log!.events[0]!.kind).toBe('click');
		expect(log!.events[1]!.kind).toBe('key');
	});
});

describe('serializeDomEventLog', () => {
	it('produces valid JSON that round-trips', () => {
		const log: DomEventLog = {
			eventLogSchemaVersion: 1,
			sessionId: 'test-session',
			events: [
				{ t: 1000, kind: 'click', x: 0.5, y: 0.3 },
				{ t: 2000, kind: 'scroll', x: 0.2, y: 0.8, deltaY: -50 }
			]
		};
		const json = serializeDomEventLog(log);
		const parsed = parseDomEventLog(JSON.parse(json));
		expect(parsed).not.toBeNull();
		expect(parsed!.sessionId).toBe('test-session');
		expect(parsed!.events).toHaveLength(2);
		expect(parsed!.events[0]!.t).toBe(1000);
		expect(parsed!.events[1]!.deltaY).toBe(-50);
	});
});

describe('CaptureSessionEventLogger.flush', () => {
	it('writes valid events.json to a directory handle', async () => {
		let written = '';
		const directory = {
			async getFileHandle(name: string, options: { create: boolean }) {
				expect(name).toBe('events.json');
				expect(options.create).toBe(true);
				return {
					async createWritable() {
						return {
							async write(value: string) {
								written = value;
							},
							async close() {}
						};
					}
				};
			}
		} as unknown as FileSystemDirectoryHandle;
		const logger = new CaptureSessionEventLogger(0, 'session-a');
		await logger.flush(directory);
		const parsed = parseDomEventLog(JSON.parse(written));
		expect(parsed).not.toBeNull();
		expect(parsed!.sessionId).toBe('session-a');
	});
});
