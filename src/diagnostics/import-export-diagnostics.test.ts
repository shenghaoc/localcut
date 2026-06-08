import { describe, expect, it } from 'vitest';
import { classifyImportError, classifyExportError } from './import-export-diagnostics';

describe('classifyImportError', () => {
	it('classifies permission errors', () => {
		const result = classifyImportError('The request is not allowed by the user agent');
		expect(result.code).toBe('import.permission_denied');
		expect(result.severity).toBe('error');
	});

	it('classifies user cancellation', () => {
		const result = classifyImportError('The user aborted a request');
		expect(result.code).toBe('import.user_canceled');
		expect(result.severity).toBe('info');
	});

	it('classifies unsupported codec', () => {
		const result = classifyImportError('Unsupported codec: prores');
		expect(result.code).toBe('import.unsupported_codec');
	});

	it('classifies unsupported container', () => {
		const result = classifyImportError('Not recognized container format');
		expect(result.code).toBe('import.unsupported_container');
	});

	it('classifies corrupt media', () => {
		const result = classifyImportError('Invalid MP4 structure: malformed atom');
		expect(result.code).toBe('import.corrupt_media');
	});

	it('classifies read errors', () => {
		const result = classifyImportError('IO error: network read failed');
		expect(result.code).toBe('import.read_error');
	});

	it('falls back to unknown', () => {
		const result = classifyImportError('Something went terribly wrong');
		expect(result.code).toBe('import.unknown');
		expect(result.recoveryHint).toBeTruthy();
	});

	it('preserves original error message', () => {
		const msg = 'The file is corrupted beyond repair';
		const result = classifyImportError(msg);
		expect(result.message).toBe(msg);
	});
});

describe('classifyExportError', () => {
	it('classifies device-lost errors', () => {
		const result = classifyExportError('GPU device_lost during render pass');
		expect(result.code).toBe('export.device_lost');
		expect(result.settingsPreserved).toBe(true);
	});

	it('classifies permission errors', () => {
		const result = classifyExportError('Permission denied writing to output');
		expect(result.code).toBe('export.permission_lost');
		expect(result.settingsPreserved).toBe(true);
	});

	it('classifies encode errors', () => {
		const result = classifyExportError('VideoEncoder threw: encode error');
		expect(result.code).toBe('export.encode_failed');
	});

	it('classifies decode errors', () => {
		const result = classifyExportError('VideoDecoder error during decode');
		expect(result.code).toBe('export.decode_failed');
	});

	it('classifies mux errors', () => {
		const result = classifyExportError('Container mux failed: invalid track');
		expect(result.code).toBe('export.mux_failed');
	});

	it('classifies write/disk errors', () => {
		const result = classifyExportError('Quota exceeded during write');
		expect(result.code).toBe('export.write_failed');
	});

	it('falls back to unknown', () => {
		const result = classifyExportError('Unexpected failure in pipeline');
		expect(result.code).toBe('export.unknown');
		expect(result.settingsPreserved).toBe(true);
	});

	it('all codes preserve settings', () => {
		const messages = [
			'device_lost',
			'permission denied',
			'encode error',
			'decode error',
			'mux failed',
			'write error',
			'unknown error'
		];
		for (const msg of messages) {
			expect(classifyExportError(msg).settingsPreserved).toBe(true);
		}
	});
});
