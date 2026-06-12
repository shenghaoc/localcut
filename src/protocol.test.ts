import { describe, expect, it } from 'vite-plus/test';
import {
	DEFAULT_VOICE_CLEANUP_SETTINGS,
	type WorkerCommand,
	type WorkerStateMessage
} from './protocol';

describe('voice cleanup protocol', () => {
	it('keeps analysis and settings messages structured-clone safe', () => {
		const analyse: WorkerCommand = {
			type: 'voice-cleanup-analyse-loudness',
			targetLufs: -14
		};
		const result: WorkerStateMessage = {
			type: 'voice-cleanup-analysis-result',
			measuredLufs: -20,
			normalisationGainDb: 6,
			normalisedLufs: -14
		};
		const update: WorkerCommand = {
			type: 'voice-cleanup-update-settings',
			settings: {
				...DEFAULT_VOICE_CLEANUP_SETTINGS,
				denoiserEnabledTracks: ['voice-a']
			}
		};

		expect(structuredClone(analyse)).toEqual(analyse);
		expect(structuredClone(result)).toEqual(result);
		expect(structuredClone(update)).toEqual(update);
	});
});
