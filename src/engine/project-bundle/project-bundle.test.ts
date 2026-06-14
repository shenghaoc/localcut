import { describe, expect, it } from 'vite-plus/test';
import { DEFAULT_TRACK_MIX, type Timeline } from '../timeline';
import {
	PROJECT_SCHEMA_VERSION,
	deserializeProject,
	serializeProject,
	type SourceDescriptor
} from '../project';
import { fingerprintBlob } from './fingerprint';
import { parseBundleManifest, serializeBundleManifest } from './manifest';
import { createMemoryDirectorySink } from './memory-sink';
import { BundleJobCanceledError } from './errors';
import { exportProjectBundle } from './export';
import { serializeProjectDocForBundle } from './serialize-doc';
import { importProjectBundle, validateProjectBundle } from './import';
import { BUNDLE_SCHEMA_VERSION } from './types';
import { createCaptionTrack } from '../captions/types';

function sourceFixture(overrides: Partial<SourceDescriptor> = {}): SourceDescriptor {
	return {
		sourceId: 'source-1',
		fileName: 'clip.mp4',
		kind: 'video',
		byteSize: 11,
		durationS: 2,
		mimeType: 'video/mp4',
		video: {
			width: 640,
			height: 360,
			frameRate: 30,
			codec: 'avc1',
			canDecode: true
		},
		...overrides
	};
}

function timelineFixture(): Timeline {
	return [
		{
			id: 'track-1',
			type: 'video',
			...DEFAULT_TRACK_MIX,
			clips: [
				{
					id: 'clip-1',
					sourceId: 'source-1',
					start: 0,
					duration: 2,
					inPoint: 0,
					effects: {
						brightness: 0,
						contrast: 0,
						saturation: 1,
						temperature: 0,
						temperatureStrength: 0,
						lutStrength: 0,
						skinSmoothStrength: 0
					},
					transform: {
						x: 0,
						y: 0,
						scale: 1,
						rotation: 0,
						opacity: 1,
						anchorX: 0.5,
						anchorY: 0.5,
						fit: 'fill'
					},
					audioFadeIn: 0,
					audioFadeOut: 0
				}
			]
		}
	];
}

describe('project bundle manifest', () => {
	it('round-trips manifest JSON', () => {
		const manifest = {
			bundleSchemaVersion: BUNDLE_SCHEMA_VERSION as typeof BUNDLE_SCHEMA_VERSION,
			bundleId: 'bundle-1',
			createdAt: new Date().toISOString(),
			appVersion: '0.1.0',
			projectSchemaVersion: PROJECT_SCHEMA_VERSION,
			projectId: 'project-1',
			displayName: 'clip',
			policy: { mode: 'embed-media' as const },
			sources: [],
			assets: []
		};
		const parsed = parseBundleManifest(JSON.parse(serializeBundleManifest(manifest)));
		expect(parsed.ok).toBe(true);
		if (parsed.ok) expect(parsed.manifest.bundleId).toBe('bundle-1');
	});

	it('rejects unknown bundle schema versions', () => {
		const parsed = parseBundleManifest({ bundleSchemaVersion: 99, bundleId: 'x' });
		expect(parsed.ok).toBe(false);
		if (!parsed.ok) expect(parsed.reason).toContain('Unsupported bundle');
	});
});

describe('project bundle fingerprint', () => {
	it('deduplicates identical media bytes', async () => {
		const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
		const a = await fingerprintBlob(new Blob([bytes]));
		const b = await fingerprintBlob(new Blob([bytes]));
		expect(a.digest).toBe(b.digest);
	});

	it('tracks bounded chunk sizes for small blobs', async () => {
		const blob = new Blob([new Uint8Array([1, 2, 3, 4, 5])]);
		let maxChunk = 0;
		await fingerprintBlob(blob, {
			trackMaxChunkBytes: (n) => {
				maxChunk = Math.max(maxChunk, n);
			}
		});
		expect(maxChunk).toBe(blob.size);
	});
});

describe('project bundle fingerprint limits', () => {
	it('rejects fingerprinting large blobs without DigestStream', async () => {
		const previous = (globalThis as { DigestStream?: unknown }).DigestStream;
		(globalThis as { DigestStream?: unknown }).DigestStream = undefined;
		try {
			const big = new Blob([new Uint8Array(65 * 1024)]);
			await expect(fingerprintBlob(big)).rejects.toThrow(/DigestStream/);
		} finally {
			(globalThis as { DigestStream?: unknown }).DigestStream = previous;
		}
	});
});

describe('project bundle export/import', () => {
	it('round-trips an embedded bundle through memory sink', async () => {
		const sink = createMemoryDirectorySink();
		const mediaBytes = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]);
		const file = new File([mediaBytes], 'clip.mp4', { type: 'video/mp4' });
		const descriptor = sourceFixture({ byteSize: file.size });
		const doc = serializeProject({
			projectId: 'project-roundtrip',
			timeline: timelineFixture(),
			captionTracks: [
				createCaptionTrack({
					id: 'captions-1',
					burnedIn: true,
					segments: [{ id: 'seg-1', start: 0, duration: 1.5, text: 'Hello' }]
				})
			],
			sources: [descriptor]
		});

		await exportProjectBundle(sink, {
			doc,
			displayName: 'clip',
			policy: { mode: 'embed-media' },
			resolveSourceFile: async () => file,
			collectLuts: () => []
		});

		const imported = await importProjectBundle(sink, {
			attachSource: async () => ({ ok: true })
		});
		expect(imported.ok).toBe(true);
		expect(imported.doc?.projectId).toBe('project-roundtrip');
		expect(imported.boundSourceIds).toEqual(['source-1']);
		expect(imported.doc?.captionTracks).toHaveLength(1);
		expect(imported.doc?.captionTracks[0]?.segments[0]?.text).toBe('Hello');
	});

	it('reports missing media without blocking manifest parse', async () => {
		const sink = createMemoryDirectorySink();
		const file = new File([new Uint8Array([1, 2, 3])], 'clip.mp4', { type: 'video/mp4' });
		const doc = serializeProject({
			projectId: 'project-missing',
			timeline: timelineFixture(),
			sources: [sourceFixture({ byteSize: file.size })]
		});
		await exportProjectBundle(sink, {
			doc,
			displayName: 'clip',
			policy: { mode: 'embed-media' },
			resolveSourceFile: async () => file,
			collectLuts: () => []
		});
		sink.files.delete(
			'media/' + [...sink.files.keys()].find((k) => k.startsWith('media/'))!.slice('media/'.length)
		);

		const result = await validateProjectBundle(sink);
		expect(result.ok).toBe(false);
		expect(result.report.items.some((item) => item.code === 'missing-file')).toBe(true);
	});

	it('imports reference-only bundles with offline sources', async () => {
		const sink = createMemoryDirectorySink();
		const doc = serializeProject({
			projectId: 'project-ref',
			timeline: timelineFixture(),
			sources: [sourceFixture()]
		});
		await exportProjectBundle(sink, {
			doc,
			displayName: 'clip',
			policy: { mode: 'reference-only' },
			resolveSourceFile: async () => null,
			collectLuts: () => []
		});

		const result = await importProjectBundle(sink, {
			attachSource: async () => ({ ok: true })
		});
		expect(result.ok).toBe(true);
		expect(result.doc?.projectId).toBe('project-ref');
		expect(result.boundSourceIds).toEqual([]);
		expect(result.report.summary.sourcesOffline).toBeGreaterThan(0);
	});

	it('rejects fingerprint mismatch', async () => {
		const sink = createMemoryDirectorySink();
		const file = new File([new Uint8Array([9, 9, 9])], 'clip.mp4', { type: 'video/mp4' });
		const doc = serializeProject({
			projectId: 'project-tamper',
			timeline: timelineFixture(),
			sources: [sourceFixture({ byteSize: file.size })]
		});
		await exportProjectBundle(sink, {
			doc,
			displayName: 'clip',
			policy: { mode: 'embed-media' },
			resolveSourceFile: async () => file,
			collectLuts: () => []
		});
		const mediaKey = [...sink.files.keys()].find((key) => key.startsWith('media/'))!;
		sink.files.set(mediaKey, new Uint8Array([1, 2, 3]));

		const result = await importProjectBundle(sink, {
			attachSource: async () => ({ ok: true })
		});
		expect(result.boundSourceIds).toEqual([]);
		expect(result.report.items.some((item) => item.code === 'fingerprint-mismatch')).toBe(true);
	});
});

describe('bundle project.json serialization', () => {
	it('writes LUT sample tables as JSON arrays', () => {
		const doc = serializeProject({
			projectId: 'lut-project',
			timeline: [
				{
					id: 'track-1',
					type: 'video',
					...DEFAULT_TRACK_MIX,
					clips: [
						{
							id: 'clip-1',
							sourceId: 'source-1',
							start: 0,
							duration: 2,
							inPoint: 0,
							effects: {
								brightness: 0,
								contrast: 0,
								saturation: 1,
								temperature: 0,
								temperatureStrength: 0,
								lutStrength: 0.5,
								skinSmoothStrength: 0
							},
							transform: {
								x: 0,
								y: 0,
								scale: 1,
								rotation: 0,
								opacity: 1,
								anchorX: 0.5,
								anchorY: 0.5,
								fit: 'fill'
							},
							lut: {
								key: 'grade.cube:8:1',
								fileName: 'grade.cube',
								title: 'Grade',
								size: 2,
								domainMin: [0, 0, 0],
								domainMax: [1, 1, 1],
								values: new Float32Array([
									0, 0, 0, 1, 1, 1, 0.5, 0.5, 0.5, 0.25, 0.25, 0.25, 0.75, 0.75, 0.75, 0.1, 0.2,
									0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9
								])
							},
							audioFadeIn: 0,
							audioFadeOut: 0
						}
					]
				}
			],
			sources: [sourceFixture()]
		});
		const json = serializeProjectDocForBundle(doc);
		const parsed = JSON.parse(json) as {
			timeline: Array<{ clips: Array<{ lut?: { values: unknown } }> }>;
		};
		expect(Array.isArray(parsed.timeline[0]?.clips[0]?.lut?.values)).toBe(true);
		const result = deserializeProject(parsed);
		expect(result.ok).toBe(true);
	});
});

describe('bundle export cancellation', () => {
	it('does not finalize manifest after cancel', async () => {
		const sink = createMemoryDirectorySink();
		const file = new File([new Uint8Array([1, 2, 3])], 'clip.mp4', { type: 'video/mp4' });
		const doc = serializeProject({
			projectId: 'cancel-export',
			timeline: timelineFixture(),
			sources: [sourceFixture({ byteSize: file.size })]
		});
		let cancel = false;
		await expect(
			exportProjectBundle(sink, {
				doc,
				displayName: 'clip',
				policy: { mode: 'embed-media' },
				resolveSourceFile: async () => {
					cancel = true;
					return file;
				},
				collectLuts: () => [],
				isCancelled: () => cancel
			})
		).rejects.toBeInstanceOf(BundleJobCanceledError);
		expect(await sink.exists('manifest.json')).toBe(false);
		expect(await sink.exists('project.json')).toBe(false);
	});
});

describe('bundle export integrity summary', () => {
	it('does not count reference-only sources as embedded', async () => {
		const sink = createMemoryDirectorySink();
		const doc = serializeProject({
			projectId: 'project-ref-summary',
			timeline: timelineFixture(),
			sources: [sourceFixture()]
		});
		const { report } = await exportProjectBundle(sink, {
			doc,
			displayName: 'clip',
			policy: { mode: 'reference-only' },
			resolveSourceFile: async () => null,
			collectLuts: () => []
		});
		expect(report.summary.sourcesEmbedded).toBe(0);
		expect(report.items.some((item) => item.code === 'ok' && item.sourceId)).toBe(true);
	});
});
