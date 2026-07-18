import { expect, test } from '@playwright/test';

declare global {
	interface Window {
		__localcutCapabilityOverrides?: {
			tier?: 'core-webgpu';
			capture?: {
				mediaStreamTrackProcessor: 'supported';
				transferableMediaStreamTrack: 'unsupported';
				displayCapture: 'supported';
				displayAudioCapture: 'supported';
				videoEncodeRealtime: 'supported';
				audioEncodeOpus: 'supported';
				audioEncodeAac: 'supported';
				opfsSyncAccessHandle: 'supported';
			};
			captureUx?: {
				documentPip?: 'supported' | 'unsupported' | 'unknown';
				cropTarget?: 'supported' | 'unsupported' | 'unknown';
				elementCapture?: 'supported' | 'unsupported' | 'unknown';
			};
		};
	}
}

const FAKE_MEDIA_ARGS = [
	'--use-fake-device-for-media-stream',
	'--use-fake-ui-for-media-stream',
	'--auto-select-desktop-capture-source'
];

const CAPTURE_VIDEO_CONFIGS: VideoEncoderConfig[] = [
	{ codec: 'avc1.64002a', width: 1920, height: 1080, bitrate: 5_000_000 },
	{ codec: 'avc1.42e02a', width: 1920, height: 1080, bitrate: 5_000_000 },
	{ codec: 'avc1.42002a', width: 1920, height: 1080, bitrate: 5_000_000 }
].map((config) => ({
	...config,
	latencyMode: 'realtime',
	hardwareAcceleration: 'prefer-hardware'
}));

test.describe.configure({ mode: 'serial' });

test.use({
	launchOptions: {
		args: FAKE_MEDIA_ARGS
	}
});

test.beforeEach(async ({ page }) => {
	await page.goto('/');
	const hasCaptureEncoder = await page.evaluate(async (configs) => {
		if (
			typeof VideoEncoder === 'undefined' ||
			typeof VideoEncoder.isConfigSupported !== 'function'
		) {
			return false;
		}
		const results = await Promise.all(
			configs.map((config) =>
				VideoEncoder.isConfigSupported(config)
					.then((result) => result.supported === true)
					.catch(() => false)
			)
		);
		return results.some(Boolean);
	}, CAPTURE_VIDEO_CONFIGS);

	test.skip(
		!hasCaptureEncoder,
		'This browser build has no realtime H.264 encoder; the product correctly capability-gates recording.'
	);
});

async function openRecordPanel(
	page: import('@playwright/test').Page,
	captureUx: NonNullable<NonNullable<Window['__localcutCapabilityOverrides']>['captureUx']> = {
		documentPip: 'unsupported',
		cropTarget: 'unsupported',
		elementCapture: 'unsupported'
	}
): Promise<void> {
	await page.addInitScript((uxOverrides) => {
		window.__localcutCapabilityOverrides = {
			tier: 'core-webgpu',
			capture: {
				mediaStreamTrackProcessor: 'supported',
				// Exercise the real main-frames compatibility path; pretending a
				// headless track is transferable would make the test less honest.
				transferableMediaStreamTrack: 'unsupported',
				displayCapture: 'supported',
				displayAudioCapture: 'supported',
				videoEncodeRealtime: 'supported',
				audioEncodeOpus: 'supported',
				audioEncodeAac: 'supported',
				opfsSyncAccessHandle: 'supported'
			},
			captureUx: uxOverrides
		};
	}, captureUx);
	await page.goto('/');
	await page.getByRole('tab', { name: 'Capture' }).click();
	await page.getByRole('tab', { name: 'Record' }).click();
	await expect(page.getByRole('heading', { name: 'Record' })).toBeVisible();
	await page.getByLabel('0s').check();
}

test('records, pauses, resumes, stops, and lands tracks with a seam marker', async ({ page }) => {
	await openRecordPanel(page);

	await page.getByRole('button', { name: 'Camera' }).click();
	await page.getByRole('button', { name: 'Add screen' }).click();
	await page.getByRole('button', { name: 'Start' }).click();

	await expect(page.getByTestId('recorder-control-strip-inpage')).toBeVisible();
	await page.getByRole('button', { name: 'Pause recording' }).click();
	await expect(page.getByLabel('Paused')).toBeVisible();
	await page.getByRole('button', { name: 'Resume recording' }).click();
	await page.waitForTimeout(2000);
	await page.getByRole('button', { name: 'Stop recording' }).click();

	await expect.poll(() => page.getByTestId('timeline-track').count()).toBeGreaterThanOrEqual(2);
	await expect(page.getByTestId('timeline-marker').filter({ hasText: 'Resume 1' })).toBeVisible();
});

test('uses the in-page recorder strip when Document PiP is unavailable', async ({ page }) => {
	await openRecordPanel(page, {
		documentPip: 'unsupported',
		cropTarget: 'unsupported',
		elementCapture: 'unsupported'
	});

	await page.getByRole('button', { name: 'Camera' }).click();
	await page.getByRole('button', { name: 'Start' }).click();

	const strip = page.getByTestId('recorder-control-strip-inpage');
	await expect(strip).toBeVisible();
	await expect(strip).not.toHaveCSS('display', 'none');
	await strip.getByRole('button', { name: 'Stop recording' }).click();

	await expect.poll(() => page.getByTestId('timeline-track').count()).toBeGreaterThanOrEqual(1);
});
