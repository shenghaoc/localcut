import { describe, expect, it } from 'vite-plus/test';
import {
	ASR_MODEL_CATALOG,
	ASR_TRUSTED_MODEL_HOSTS,
	assertTrustedModelUrl,
	defaultModel,
	isTrustedModelUrl,
	modelById,
	UntrustedModelHostError
} from './model-catalog';

const ORIGIN = 'https://app.example.com';

describe('isTrustedModelUrl', () => {
	it('allows same-origin absolute and relative URLs', () => {
		expect(isTrustedModelUrl('/models/whisper-onnx/encoder.onnx', ORIGIN)).toBe(true);
		expect(isTrustedModelUrl(`${ORIGIN}/models/whisper-onnx/encoder.onnx`, ORIGIN)).toBe(true);
	});

	it('allows HTTPS URLs on allowlisted hosts (incl. HF CDN redirect targets)', () => {
		expect(
			isTrustedModelUrl('https://huggingface.co/openai/whisper-base/resolve/main/x', ORIGIN)
		).toBe(true);
		// The resolve URL 302-redirects to a signed Xet/LFS CDN host — covered by suffix.
		expect(isTrustedModelUrl('https://cas-bridge.xethub.hf.co/xet/abc', ORIGIN)).toBe(true);
		expect(isTrustedModelUrl('https://cdn-lfs-us-1.huggingface.co/repo/x', ORIGIN)).toBe(true);
		expect(isTrustedModelUrl('https://storage.googleapis.com/kaggle/x.onnx', ORIGIN)).toBe(true);
	});

	it('rejects untrusted hosts and non-HTTPS schemes', () => {
		expect(isTrustedModelUrl('https://evil.example/x.onnx', ORIGIN)).toBe(false);
		expect(isTrustedModelUrl('http://huggingface.co/x.onnx', ORIGIN)).toBe(false);
		expect(isTrustedModelUrl('ftp://huggingface.co/x.onnx', ORIGIN)).toBe(false);
		// A look-alike that merely embeds the trusted domain as a label is rejected.
		expect(isTrustedModelUrl('https://huggingface.co.evil.example/x', ORIGIN)).toBe(false);
		expect(isTrustedModelUrl('https://nothf.co/x', ORIGIN)).toBe(false);
	});

	it('treats a bare relative path as same-origin (trusted)', () => {
		// `new URL('models/x', origin)` resolves to a same-origin path.
		expect(isTrustedModelUrl('models/whisper-onnx/encoder.onnx', ORIGIN)).toBe(true);
	});
});

describe('assertTrustedModelUrl', () => {
	it('throws UntrustedModelHostError for an untrusted host', () => {
		expect(() => assertTrustedModelUrl('https://evil.example/x', ORIGIN)).toThrow(
			UntrustedModelHostError
		);
	});

	it('does not throw for an allowlisted host', () => {
		expect(() => assertTrustedModelUrl('https://hf.co/x', ORIGIN)).not.toThrow();
	});
});

describe('catalog', () => {
	it('has a single recommended default with a valid HTTPS info link', () => {
		const recommended = ASR_MODEL_CATALOG.filter((entry) => entry.recommended);
		expect(recommended).toHaveLength(1);
		expect(defaultModel().id).toBe(recommended[0].id);
		for (const entry of ASR_MODEL_CATALOG) {
			expect(entry.infoUrl).toMatch(/^https:\/\//);
			expect(entry.manifestUrl.length).toBeGreaterThan(0);
		}
	});

	it('every catalog manifest URL is fetchable from a trusted host', () => {
		for (const entry of ASR_MODEL_CATALOG) {
			expect(isTrustedModelUrl(entry.manifestUrl, ORIGIN)).toBe(true);
		}
	});

	it('modelById falls back to the default for unknown ids', () => {
		expect(modelById('whisper-base-onnx-int8').id).toBe('whisper-base-onnx-int8');
		expect(modelById('does-not-exist').id).toBe(defaultModel().id);
		expect(modelById(null).id).toBe(defaultModel().id);
	});

	it('offers ONNX Whisper base + tiny variants with distinct manifests', () => {
		const ids = ASR_MODEL_CATALOG.map((entry) => entry.id);
		expect(defaultModel().id).toBe('whisper-base-onnx-int8');
		expect(ids).toContain('whisper-base-onnx-int8');
		expect(ids).toContain('whisper-tiny-onnx-int8');
		expect(ids).toHaveLength(2);
		expect(modelById('whisper-tiny-onnx-int8').id).toBe('whisper-tiny-onnx-int8');
		// Distinct manifest URLs so each model caches + switches independently.
		const manifests = new Set(ASR_MODEL_CATALOG.map((entry) => entry.manifestUrl));
		expect(manifests.size).toBe(ASR_MODEL_CATALOG.length);
	});

	it('exposes a non-empty trusted-host allowlist', () => {
		expect(ASR_TRUSTED_MODEL_HOSTS.length).toBeGreaterThan(0);
		expect(ASR_TRUSTED_MODEL_HOSTS).toContain('.huggingface.co');
	});
});
