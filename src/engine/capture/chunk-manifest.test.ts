/**
 * Phase 45: Chunk Manifest — unit tests for scene-switch record parsing.
 */

import { describe, it, expect } from 'vite-plus/test';
import { parseManifestLine, parseManifest } from './chunk-manifest';

describe('parseManifestLine', () => {
	it('parses a header record', () => {
		const line = JSON.stringify({
			kind: 'header',
			version: 1,
			sessionId: 'test',
			startedAtIso: '2024-01-01T00:00:00Z',
			epochUs: null,
			sources: [],
			chunkTargetS: 2
		});
		const record = parseManifestLine(line);
		expect(record).not.toBeNull();
		expect(record!.kind).toBe('header');
	});

	it('parses a scene-switch record', () => {
		const line = JSON.stringify({
			kind: 'scene-switch',
			sceneId: 'scene-2',
			atUs: 5_300_000
		});
		const record = parseManifestLine(line);
		expect(record).not.toBeNull();
		expect(record!.kind).toBe('scene-switch');
		if (record!.kind === 'scene-switch') {
			expect(record!.sceneId).toBe('scene-2');
			expect(record!.atUs).toBe(5_300_000);
		}
	});

	it('returns null for malformed JSON', () => {
		expect(parseManifestLine('not json')).toBeNull();
		expect(parseManifestLine('')).toBeNull();
	});

	it('returns null for non-object', () => {
		expect(parseManifestLine('42')).toBeNull();
		expect(parseManifestLine('"string"')).toBeNull();
		expect(parseManifestLine('null')).toBeNull();
	});

	it('returns null for unrecognised kind', () => {
		const line = JSON.stringify({ kind: 'unknown-record', data: 'test' });
		expect(parseManifestLine(line)).toBeNull();
	});

	it('returns null for scene-switch with missing sceneId', () => {
		const line = JSON.stringify({ kind: 'scene-switch', atUs: 5_000_000 });
		expect(parseManifestLine(line)).toBeNull();
	});

	it('returns null for scene-switch with missing atUs', () => {
		const line = JSON.stringify({ kind: 'scene-switch', sceneId: 'scene-1' });
		expect(parseManifestLine(line)).toBeNull();
	});

	it('returns null for scene-switch with non-string sceneId', () => {
		const line = JSON.stringify({ kind: 'scene-switch', sceneId: 123, atUs: 5_000_000 });
		expect(parseManifestLine(line)).toBeNull();
	});

	it('returns null for scene-switch with non-number atUs', () => {
		const line = JSON.stringify({ kind: 'scene-switch', sceneId: 'scene-1', atUs: 'not-number' });
		expect(parseManifestLine(line)).toBeNull();
	});
});

describe('parseManifest', () => {
	it('parses NDJSON with scene-switch records', () => {
		const text = [
			JSON.stringify({
				kind: 'header',
				version: 1,
				sessionId: 'test',
				startedAtIso: '2024-01-01T00:00:00Z',
				epochUs: null,
				sources: [],
				chunkTargetS: 2
			}),
			JSON.stringify({ kind: 'epoch', epochUs: 0 }),
			JSON.stringify({ kind: 'scene-switch', sceneId: 'scene-2', atUs: 5_300_000 }),
			JSON.stringify({ kind: 'scene-switch', sceneId: 'scene-1', atUs: 9_800_000 }),
			JSON.stringify({ kind: 'finalize', endedAtIso: '2024-01-01T00:00:15Z', reason: 'user' })
		].join('\n');

		const records = parseManifest(text);
		expect(records).toHaveLength(5);
		expect(records[0].kind).toBe('header');
		expect(records[1].kind).toBe('epoch');
		expect(records[2].kind).toBe('scene-switch');
		expect(records[3].kind).toBe('scene-switch');
		expect(records[4].kind).toBe('finalize');
	});

	it('skips malformed lines', () => {
		const text = [
			JSON.stringify({
				kind: 'header',
				version: 1,
				sessionId: 'test',
				startedAtIso: '2024-01-01T00:00:00Z',
				epochUs: null,
				sources: [],
				chunkTargetS: 2
			}),
			'not json',
			JSON.stringify({ kind: 'finalize', endedAtIso: '2024-01-01T00:00:15Z', reason: 'user' })
		].join('\n');

		const records = parseManifest(text);
		expect(records).toHaveLength(2);
	});

	it('skips unknown kind values', () => {
		const text = [
			JSON.stringify({
				kind: 'header',
				version: 1,
				sessionId: 'test',
				startedAtIso: '2024-01-01T00:00:00Z',
				epochUs: null,
				sources: [],
				chunkTargetS: 2
			}),
			JSON.stringify({ kind: 'future-record', data: 'test' }),
			JSON.stringify({ kind: 'finalize', endedAtIso: '2024-01-01T00:00:15Z', reason: 'user' })
		].join('\n');

		const records = parseManifest(text);
		expect(records).toHaveLength(2);
		expect(records[0].kind).toBe('header');
		expect(records[1].kind).toBe('finalize');
	});

	it('handles torn tail after scene-switch', () => {
		const text = [
			JSON.stringify({
				kind: 'header',
				version: 1,
				sessionId: 'test',
				startedAtIso: '2024-01-01T00:00:00Z',
				epochUs: null,
				sources: [],
				chunkTargetS: 2
			}),
			JSON.stringify({ kind: 'scene-switch', sceneId: 'scene-2', atUs: 5_000_000 }),
			'incomplete json'
		].join('\n');

		const records = parseManifest(text);
		expect(records).toHaveLength(2);
		expect(records[1].kind).toBe('scene-switch');
	});
});
