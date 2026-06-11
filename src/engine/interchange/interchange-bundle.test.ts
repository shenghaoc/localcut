import { describe, expect, it } from 'vite-plus/test';
import { exportProjectBundle } from '../project-bundle/export';
import { importProjectBundle } from '../project-bundle/import';
import { createMemoryDirectorySink } from '../project-bundle/memory-sink';
import { PROJECT_OTIO_PATH, PROJECT_PATH } from '../project-bundle/paths';
import { buildMultiTrackFixtureDoc } from './fixture-docs';
import type { OtioClip, OtioTimeline } from './otio';
import { validateOtioDocument } from './otio-validate';

function fixtureFile(name: string): File {
	return new File([new Uint8Array([1, 2, 3, 4])], name, { type: 'video/mp4' });
}

function exportOptions() {
	const doc = buildMultiTrackFixtureDoc();
	for (const source of doc.sources) source.byteSize = 4;
	return {
		doc,
		displayName: 'Fixture Project',
		policy: { mode: 'embed-media' as const },
		resolveSourceFile: async (sourceId: string) =>
			fixtureFile(doc.sources.find((source) => source.sourceId === sourceId)!.fileName),
		collectLuts: () => []
	};
}

describe('project.otio in the bundle root (R7)', () => {
	it('writes a valid project.otio with bundle-relative media paths', async () => {
		const sink = createMemoryDirectorySink();
		const { report } = await exportProjectBundle(sink, exportOptions());
		expect(report.ok).toBe(true);

		const text = await sink.readText(PROJECT_OTIO_PATH);
		expect(text).not.toBeNull();
		const timeline = JSON.parse(text!) as OtioTimeline;
		expect(validateOtioDocument(timeline)).toEqual([]);

		const clip = timeline.tracks.children[0]!.children.find(
			(child) => child.OTIO_SCHEMA === 'Clip.2'
		) as OtioClip;
		const ref = clip.media_references[clip.active_media_reference_key]!;
		if (ref.OTIO_SCHEMA !== 'ExternalReference.1') throw new Error('expected external ref');
		expect(ref.target_url).toMatch(/^media\/[a-f0-9]{16}_/);
		expect(sink.files.has(ref.target_url)).toBe(true);
		// The fingerprint computed during this export rides in the metadata.
		const localcut = ref.metadata.localcut as { fingerprint?: { digest: string } };
		expect(localcut.fingerprint?.digest).toMatch(/^[a-f0-9]{64}$/);
	});

	it('adds a warning and still succeeds when the otio write fails', async () => {
		const sink = createMemoryDirectorySink();
		const writeText = sink.writeText.bind(sink);
		sink.writeText = async (relativePath, text) => {
			if (relativePath === PROJECT_OTIO_PATH) throw new Error('disk full');
			return writeText(relativePath, text);
		};
		const { report } = await exportProjectBundle(sink, exportOptions());
		const item = report.items.find((entry) => entry.code === 'interchange-export-failed');
		expect(item).toBeDefined();
		expect(item?.severity).toBe('warning');
		expect(item?.message).toContain(PROJECT_OTIO_PATH);
		// A derived artifact failing must not block the bundle.
		expect(report.ok).toBe(true);
		expect(sink.files.has(PROJECT_PATH)).toBe(true);
		expect(sink.files.has('manifest.json')).toBe(true);
	});

	it('is ignored by bundle import — project.json stays authoritative', async () => {
		const sink = createMemoryDirectorySink();
		await exportProjectBundle(sink, exportOptions());
		// Corrupt the derived artifact; import must not even look at it.
		await sink.writeText(PROJECT_OTIO_PATH, '{ not otio');
		const imported = await importProjectBundle(sink, {
			attachSource: async () => ({ ok: true })
		});
		expect(imported.ok).toBe(true);
		expect(imported.doc?.projectId).toBe('fixture-multi-track');
	});
});
