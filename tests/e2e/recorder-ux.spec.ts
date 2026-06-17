import { expect, test } from '@playwright/test';

declare global {
	interface Window {
		__localcutCapabilityOverrides?: {
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

test.describe.configure({ mode: 'serial' });

test.use({
	launchOptions: {
		args: FAKE_MEDIA_ARGS
	}
});

async function openRecordPanel(page: import('@playwright/test').Page): Promise<void> {
	await page.goto('/');
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
	await page.addInitScript(() => {
		window.__localcutCapabilityOverrides = {
			captureUx: {
				documentPip: 'unsupported',
				cropTarget: 'unsupported',
				elementCapture: 'unsupported'
			}
		};
	});
	await openRecordPanel(page);

	await page.getByRole('button', { name: 'Camera' }).click();
	await page.getByRole('button', { name: 'Start' }).click();

	const strip = page.getByTestId('recorder-control-strip-inpage');
	await expect(strip).toBeVisible();
	await expect(strip).not.toHaveCSS('display', 'none');
	await strip.getByRole('button', { name: 'Stop recording' }).click();

	await expect.poll(() => page.getByTestId('timeline-track').count()).toBeGreaterThanOrEqual(1);
});
