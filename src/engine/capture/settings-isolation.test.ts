import { describe, expect, it } from 'vite-plus/test';
import { CAPTURE_SETTINGS_STORE } from '../persistence';
import { DEFAULT_MASTER_GAIN } from '../timeline';
import { serializeProject } from '../project';

describe('capture settings bundle isolation', () => {
	it('keeps device-scoped recorder settings out of ProjectDoc serialization', () => {
		const doc = serializeProject({
			projectId: 'project-recorder-isolation',
			timeline: [],
			captionTracks: [],
			transitions: [],
			markers: [],
			sources: [],
			masterGain: DEFAULT_MASTER_GAIN
		});

		const json = JSON.stringify(doc);
		expect(json).not.toContain(CAPTURE_SETTINGS_STORE);
		expect(json).not.toContain('webcamPreset');
		expect(json).not.toContain('countdownS');
	});
});
