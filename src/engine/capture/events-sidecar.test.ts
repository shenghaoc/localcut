/** Phase 41 T13.9 — events.ndjson sidecar parser tolerance.
 *
 *  The OPFS-side `readCaptureEventsSidecar` is hard to test in node (no
 *  real `navigator.storage.getDirectory`), but the parser body is pure and
 *  has all the interesting edge cases: torn final line, mixed kinds,
 *  blank lines, malformed JSON.
 */

import { describe, expect, it } from 'vite-plus/test';
import { parseEventsSidecar, parseEventsSidecarStream } from './events-sidecar';
import type { CaptureEventLogEntry } from './event-log';

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	return new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
			controller.close();
		}
	});
}

describe('parseEventsSidecar', () => {
	it('returns an empty array for empty input', () => {
		expect(parseEventsSidecar('')).toEqual([]);
	});

	it('parses well-formed JSONL into typed entries', () => {
		const text =
			JSON.stringify({ kind: 'key', combo: 'Ctrl+S', t: 1.5 }) +
			'\n' +
			JSON.stringify({ kind: 'pointer-down', t: 1.6, x: 100, y: 200, modifierFlags: 0 }) +
			'\n';
		const entries = parseEventsSidecar(text);
		expect(entries).toEqual([
			{ kind: 'key', combo: 'Ctrl+S', t: 1.5 },
			{ kind: 'pointer-down', t: 1.6, x: 100, y: 200, modifierFlags: 0 }
		]);
	});

	it('tolerates a torn final line (partial JSON)', () => {
		// First two lines are valid, the third is mid-write (no closing brace).
		const text =
			JSON.stringify({ kind: 'key', combo: 'Ctrl+S', t: 1 }) +
			'\n' +
			JSON.stringify({ kind: 'key', combo: 'Escape', t: 2 }) +
			'\n' +
			'{"kind":"key","combo":"Alt+';
		const entries = parseEventsSidecar(text);
		expect(entries).toHaveLength(2);
		expect((entries[1] as { combo: string }).combo).toBe('Escape');
	});

	it('skips blank lines without failing', () => {
		const text = '\n' + JSON.stringify({ kind: 'key', combo: 'F12', t: 0.5 }) + '\n\n\n';
		expect(parseEventsSidecar(text)).toEqual([{ kind: 'key', combo: 'F12', t: 0.5 }]);
	});

	it('skips records that are not objects with a string `kind`', () => {
		const text =
			'null\n' +
			'42\n' +
			'"key"\n' +
			JSON.stringify({ noKind: true, t: 1 }) +
			'\n' +
			JSON.stringify({ kind: 'key', combo: 'Ctrl+S', t: 1 }) +
			'\n';
		const entries = parseEventsSidecar(text);
		expect(entries).toHaveLength(1);
		expect(entries[0]).toEqual({ kind: 'key', combo: 'Ctrl+S', t: 1 });
	});

	it('preserves entries in file order', () => {
		const lines = [
			{ kind: 'key', combo: 'A', t: 3 },
			{ kind: 'key', combo: 'B', t: 1 },
			{ kind: 'key', combo: 'C', t: 2 }
		];
		const text = lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
		const parsed = parseEventsSidecar(text);
		expect(parsed.map((e) => (e as { combo: string }).combo)).toEqual(['A', 'B', 'C']);
	});
});

describe('parseEventsSidecarStream', () => {
	it('parses an NDJSON stream chunked at arbitrary byte boundaries', async () => {
		const entries: CaptureEventLogEntry[] = [
			{ kind: 'key', combo: 'Ctrl+S', t: 0.5 },
			{ kind: 'pointer-down', t: 0.6, x: 10, y: 20, modifierFlags: 0 },
			{ kind: 'key', combo: 'Escape', t: 0.7 }
		];
		const text = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
		// Split the text at a mid-line boundary so the parser must reassemble.
		const mid = Math.floor(text.length / 2);
		const chunks = [text.slice(0, mid), text.slice(mid)];
		const parsed = await parseEventsSidecarStream(streamFromChunks(chunks));
		expect(parsed).toEqual(entries);
	});

	it('tolerates a torn final line in the stream', async () => {
		const text =
			JSON.stringify({ kind: 'key', combo: 'Ctrl+S', t: 1 }) +
			'\n' +
			JSON.stringify({ kind: 'key', combo: 'Escape', t: 2 }) +
			'\n' +
			'{"kind":"key","combo":"Alt+';
		const parsed = await parseEventsSidecarStream(streamFromChunks([text]));
		expect(parsed).toHaveLength(2);
		expect((parsed[1] as { combo: string }).combo).toBe('Escape');
	});

	it('returns an empty array for an empty stream', async () => {
		const parsed = await parseEventsSidecarStream(streamFromChunks([]));
		expect(parsed).toEqual([]);
	});

	it('splits a line that straddles a chunk boundary mid-JSON-token', async () => {
		// Force a chunk boundary inside the combo string so the parser must
		// keep accumulating before parsing.
		const chunks = ['{"kind":"key","combo":"Ctrl+', 'Shift+Z","t":1}\n'];
		const parsed = await parseEventsSidecarStream(streamFromChunks(chunks));
		expect(parsed).toEqual([{ kind: 'key', combo: 'Ctrl+Shift+Z', t: 1 }]);
	});
});
