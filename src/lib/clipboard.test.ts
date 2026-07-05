import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { copyToClipboard } from './clipboard';

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('copyToClipboard', () => {
	it('returns a clear error when the Clipboard API is unavailable', async () => {
		vi.stubGlobal('navigator', {});

		await expect(copyToClipboard('hello')).resolves.toEqual({
			ok: false,
			error: 'Clipboard API is not available (requires a secure HTTPS context)'
		});
	});

	it('writes text through the Clipboard API when available', async () => {
		const writeText = vi.fn(async () => undefined);
		vi.stubGlobal('navigator', { clipboard: { writeText } });

		await expect(copyToClipboard('hello')).resolves.toEqual({ ok: true });
		expect(writeText).toHaveBeenCalledWith('hello');
	});

	it('returns write failures without throwing', async () => {
		vi.stubGlobal('navigator', {
			clipboard: {
				writeText: vi.fn(async () => {
					throw new Error('blocked');
				})
			}
		});

		await expect(copyToClipboard('hello')).resolves.toEqual({
			ok: false,
			error: 'blocked'
		});
	});
});
