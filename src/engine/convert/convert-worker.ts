/**
 * Media converter worker. Runs Mediabunny's high-level `Conversion` (one at a
 * time) entirely off the main thread: stream-copies when the source codec fits
 * the target container, transcodes via WebCodecs when it doesn't. Spawned
 * lazily by `convert-bridge.ts` only when the Convert view is opened, so nothing
 * here enters the startup module graph.
 *
 * No WebGPU, no SharedArrayBuffer, no pipeline-worker coupling — WebCodecs needs
 * no cross-origin isolation, so conversion works in the limited tier too.
 */

/// <reference lib="webworker" />

import {
	ALL_FORMATS,
	BlobSource,
	BufferTarget,
	Conversion,
	ConversionCanceledError,
	Input,
	Output
} from 'mediabunny';
import type { ConvertTargetSpec, ConvertWorkerCommand, ConvertWorkerState } from '../../protocol';
import {
	createOutputFormat,
	probeInput,
	qualityFor,
	resolveAudioCodec,
	resolveVideoCodec
} from './convert';
import { convertFormatById, outputFileName } from '../../features/convert/convert-formats';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let activeConversion: Conversion | null = null;
let activeJobId: string | null = null;

function post(message: ConvertWorkerState, transfer?: Transferable[]): void {
	if (transfer?.length) ctx.postMessage(message, transfer);
	else ctx.postMessage(message);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function openInput(file: File): Input {
	return new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
}

async function handleProbe(jobId: string, file: File): Promise<void> {
	try {
		const info = await probeInput(file.name, openInput(file));
		post({ type: 'convert-probed', jobId, info });
	} catch (error) {
		post({ type: 'convert-probe-failed', jobId, message: errorMessage(error) });
	}
}

async function handleStart(command: {
	jobId: string;
	file: File;
	target: ConvertTargetSpec;
}): Promise<void> {
	const { jobId, file, target } = command;

	// Conversions are strictly sequential (one encoder pipeline at a time). The
	// UI already serializes, but guard here too so a stray concurrent start can't
	// clobber `activeConversion`/`activeJobId` and break cancellation.
	if (activeJobId !== null) {
		post({ type: 'convert-failed', jobId, message: 'Another conversion is already in progress.' });
		return;
	}

	// Everything that can throw (including `convertFormatById` for a malformed
	// command) lives inside the try so a failure always posts `convert-failed`
	// and the finally resets state — the UI job never sticks in `converting`.
	try {
		activeJobId = jobId;
		const descriptor = convertFormatById(target.formatId);
		const startedAt = performance.now();
		const input = openInput(file);
		const format = createOutputFormat(target.formatId);
		const output = new Output({ format, target: new BufferTarget() });
		const quality = qualityFor(target.quality);

		// Audio-only containers discard video; video containers keep both. Codecs
		// are resolved to what the browser can encode *and* the container holds.
		const wantsVideo = descriptor.kind === 'video';
		const videoCodec = wantsVideo ? await resolveVideoCodec(target.formatId, format) : null;
		const audioCodec = await resolveAudioCodec(target.formatId, format);

		if (descriptor.kind === 'audio' && audioCodec === null) {
			post({
				type: 'convert-failed',
				jobId,
				message: `This browser can't encode audio for ${descriptor.shortLabel}.`
			});
			return;
		}

		const conversion = await Conversion.init({
			input,
			output,
			video: wantsVideo && videoCodec ? { codec: videoCodec, bitrate: quality } : { discard: true },
			audio: audioCodec ? { codec: audioCodec, bitrate: quality } : { discard: true },
			showWarnings: false
		});

		if (!conversion.isValid) {
			const reasons = conversion.discardedTracks.map((track) => track.reason);
			post({
				type: 'convert-failed',
				jobId,
				message: describeInvalid(reasons, descriptor.shortLabel)
			});
			return;
		}

		conversion.onProgress = (fraction, processedSeconds) => {
			post({ type: 'convert-progress', jobId, fraction, processedSeconds });
		};

		activeConversion = conversion;
		await conversion.execute();

		const buffer = (output.target as BufferTarget).buffer;
		if (!buffer) {
			post({ type: 'convert-failed', jobId, message: 'Conversion produced no output.' });
			return;
		}
		post(
			{
				type: 'convert-done',
				jobId,
				output: buffer,
				fileName: outputFileName(file.name, target.formatId),
				mimeType: format.mimeType,
				bytes: buffer.byteLength,
				elapsedSeconds: (performance.now() - startedAt) / 1000
			},
			[buffer]
		);
	} catch (error) {
		if (error instanceof ConversionCanceledError) {
			post({ type: 'convert-canceled', jobId });
		} else {
			post({ type: 'convert-failed', jobId, message: errorMessage(error) });
		}
	} finally {
		activeConversion = null;
		activeJobId = null;
	}
}

/** Turns Mediabunny discard reasons into one user-facing sentence. */
function describeInvalid(reasons: readonly string[], formatLabel: string): string {
	if (reasons.includes('no_encodable_target_codec')) {
		return `This browser can't encode a codec that fits ${formatLabel}.`;
	}
	if (reasons.includes('undecodable_source_codec')) {
		return "This browser can't decode the source codec.";
	}
	if (reasons.includes('unknown_source_codec')) {
		return 'The source codec is unknown and cannot be converted.';
	}
	return `Nothing in this file can be written to ${formatLabel}.`;
}

ctx.addEventListener('message', (event: MessageEvent<ConvertWorkerCommand>) => {
	const command = event.data;
	switch (command.type) {
		case 'convert-probe':
			void handleProbe(command.jobId, command.file);
			return;
		case 'convert-start':
			void handleStart(command);
			return;
		case 'convert-cancel':
			if (activeConversion && activeJobId === command.jobId) {
				void activeConversion.cancel();
			}
			return;
	}
});
