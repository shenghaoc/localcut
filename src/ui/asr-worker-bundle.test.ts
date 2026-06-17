import { describe, expect, it } from 'vite-plus/test';

import bridgeSource from './asr-bridge.ts?raw';

describe('ASR worker production bundle', () => {
	it('launches the ASR worker as a module worker for ORT chunk imports', () => {
		expect(bridgeSource).toContain("type: 'module'");
		expect(bridgeSource).not.toContain("type: 'classic'");
	});
});
