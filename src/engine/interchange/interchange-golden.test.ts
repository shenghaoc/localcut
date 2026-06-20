import { describe, expect, it } from 'vite-plus/test';
import missingSourceGolden from '../../../test-fixtures/interchange/missing-source.otio?raw';
import multiTrackBundleGolden from '../../../test-fixtures/interchange/multi-track-bundle.otio?raw';
import multiTrackEdlGolden from '../../../test-fixtures/interchange/multi-track.edl?raw';
import multiTrackGolden from '../../../test-fixtures/interchange/multi-track.otio?raw';
import { serializeTimelineToEdl, validateCmx3600Document } from './edl';
import { buildMissingSourceFixtureDoc, buildMultiTrackFixtureDoc } from './fixture-docs';
import { serializeTimelineToOtio } from './otio';
import { validateOtioDocument } from './otio-validate';

/**
 * Golden-fixture tests (R11.3): serialiser output must be byte-identical to
 * the checked-in fixtures in test-fixtures/interchange/. The same fixtures
 * are parsed by the reference Python opentimelineio package in CI (R11.5,
 * scripts/validate-otio-fixtures.py).
 *
 * Regenerate after an intentional output change with:
 *   UPDATE_INTERCHANGE_GOLDENS=1 npm test -- interchange-golden
 */

const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
const UPDATE = env?.UPDATE_INTERCHANGE_GOLDENS === '1';

async function compareToGolden(name: string, golden: string, text: string): Promise<void> {
	if (UPDATE) {
		// Dynamic specifier so the browser-typed tsconfig never resolves node:fs;
		// vitest runs in a node environment where this import always succeeds.
		const fs = (await import(/* @vite-ignore */ ['node', 'fs'].join(':'))) as {
			writeFileSync: (path: string, data: string) => void;
		};
		const url = new URL(`../../../test-fixtures/interchange/${name}`, import.meta.url);
		fs.writeFileSync(url.pathname, text);
		return;
	}
	expect(text).toBe(golden);
}

const OPTIONS = { displayName: 'Fixture Project', appVersion: '1.0.0' };

describe('interchange golden fixtures', () => {
	it('multi-track .otio matches the golden', async () => {
		const { text } = serializeTimelineToOtio(buildMultiTrackFixtureDoc(), OPTIONS);
		expect(validateOtioDocument(JSON.parse(text))).toEqual([]);
		await compareToGolden('multi-track.otio', multiTrackGolden, text);
	});

	it('multi-track .otio with bundle-relative paths matches the golden', async () => {
		const { text } = serializeTimelineToOtio(buildMultiTrackFixtureDoc(), {
			...OPTIONS,
			resolveTargetUrl: (sourceId) =>
				sourceId === 'source-a' ? 'media/a1b2c3d4a1b2c3d4_beach.mp4' : null
		});
		expect(validateOtioDocument(JSON.parse(text))).toEqual([]);
		await compareToGolden('multi-track-bundle.otio', multiTrackBundleGolden, text);
	});

	it('missing-source .otio matches the golden', async () => {
		const { text } = serializeTimelineToOtio(buildMissingSourceFixtureDoc(), OPTIONS);
		expect(validateOtioDocument(JSON.parse(text))).toEqual([]);
		await compareToGolden('missing-source.otio', missingSourceGolden, text);
	});

	it('multi-track .edl matches the golden and the CMX3600 grammar', async () => {
		const { text } = serializeTimelineToEdl(buildMultiTrackFixtureDoc(), {
			displayName: 'Fixture Project'
		});
		expect(validateCmx3600Document(text, 30)).toEqual([]);
		await compareToGolden('multi-track.edl', multiTrackEdlGolden, text);
	});
});
