import { describe, expect, it } from 'vitest';
import { parseManifest, parseManifestLine } from './chunk-manifest';

describe('parseManifestLine', () => {
	it('parses known record kinds', () => {
		expect(parseManifestLine('{"kind":"pause","atUs":1000}')).toEqual({
			kind: 'pause',
			atUs: 1000
		});
		expect(parseManifestLine('{"kind":"resume","atUs":2000}')).toEqual({
			kind: 'resume',
			atUs: 2000
		});
		expect(
			parseManifestLine(
				'{"kind":"source-added","source":{"sourceId":"s1","kind":"webcam","label":"cam"},"atUs":500}'
			)
		).toEqual({
			kind: 'source-added',
			source: { sourceId: 's1', kind: 'webcam', label: 'cam' },
			atUs: 500
		});
		expect(
			parseManifestLine('{"kind":"source-region-applied","sourceId":"s1","mode":"crop","atUs":300}')
		).toEqual({ kind: 'source-region-applied', sourceId: 's1', mode: 'crop', atUs: 300 });
	});

	it('skips unknown kind values (forward compatibility)', () => {
		expect(parseManifestLine('{"kind":"future-record","data":"something"}')).toBeUndefined();
		expect(parseManifestLine('{"kind":"unknown"}')).toBeUndefined();
	});

	it('skips malformed JSON (torn tail)', () => {
		expect(parseManifestLine('{"kind":"pause","atUs":100')).toBeUndefined();
		expect(parseManifestLine('not json at all')).toBeUndefined();
		expect(parseManifestLine('')).toBeUndefined();
	});

	it('skips lines without a kind field', () => {
		expect(parseManifestLine('{"atUs":1000}')).toBeUndefined();
		expect(parseManifestLine('null')).toBeUndefined();
	});
});

describe('parseManifest', () => {
	it('parses a full manifest with mixed record kinds', () => {
		const ndjson = [
			'{"kind":"header","version":1,"sessionId":"test","startedAtIso":"2025-01-01T00:00:00Z","epochUs":null,"sources":[],"chunkTargetS":2}',
			'{"kind":"chunk","sourceId":"s1","file":"video-s1.mp4","byteOffset":0,"byteLength":100,"fromUs":0,"toUs":100,"keyFrame":true,"preEncodeDrops":0}',
			'{"kind":"pause","atUs":1000}',
			'{"kind":"resume","atUs":2000}',
			'{"kind":"source-added","source":{"sourceId":"s2","kind":"webcam","label":"cam"},"atUs":2500}',
			'{"kind":"source-region-applied","sourceId":"s1","mode":"element","atUs":3000}',
			'{"kind":"future-record","unknown":true}',
			'{"kind":"finalize","endedAtIso":"2025-01-01T00:01:00Z","reason":"user-stop"}'
		].join('\n');

		const records = parseManifest(ndjson);
		expect(records).toHaveLength(7); // future-record is skipped
		expect(records[0].kind).toBe('header');
		expect(records[1].kind).toBe('chunk');
		expect(records[2].kind).toBe('pause');
		expect(records[3].kind).toBe('resume');
		expect(records[4].kind).toBe('source-added');
		expect(records[5].kind).toBe('source-region-applied');
		expect(records[6].kind).toBe('finalize');
	});

	it('handles torn-tail at end of manifest', () => {
		const ndjson = [
			'{"kind":"pause","atUs":1000}',
			'{"kind":"resume","atUs":2000}',
			'{"kind":"pause","atUs":3000' // torn tail — missing closing brace
		].join('\n');

		const records = parseManifest(ndjson);
		expect(records).toHaveLength(2);
		expect(records[0]).toEqual({ kind: 'pause', atUs: 1000 });
		expect(records[1]).toEqual({ kind: 'resume', atUs: 2000 });
	});

	it('handles empty manifest', () => {
		expect(parseManifest('')).toEqual([]);
		expect(parseManifest('\n\n')).toEqual([]);
	});
});
