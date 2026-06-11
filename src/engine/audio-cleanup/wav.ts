/** Minimal RIFF/WAVE encoder for cleaned-audio asset candidates (PCM16). */

export function encodeWavPcm16(
	pcm: Float32Array,
	sampleRate: number,
	channels: number
): ArrayBuffer {
	if (sampleRate <= 0 || !Number.isInteger(sampleRate)) {
		throw new Error('WAV sample rate must be a positive integer');
	}
	if (channels <= 0 || !Number.isInteger(channels)) {
		throw new Error('WAV channel count must be a positive integer');
	}
	const bytesPerSample = 2;
	const dataBytes = pcm.length * bytesPerSample;
	const buffer = new ArrayBuffer(44 + dataBytes);
	const view = new DataView(buffer);

	const writeAscii = (offset: number, text: string) => {
		for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
	};

	writeAscii(0, 'RIFF');
	view.setUint32(4, 36 + dataBytes, true);
	writeAscii(8, 'WAVE');
	writeAscii(12, 'fmt ');
	view.setUint32(16, 16, true); // PCM fmt chunk size
	view.setUint16(20, 1, true); // PCM format
	view.setUint16(22, channels, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * channels * bytesPerSample, true);
	view.setUint16(32, channels * bytesPerSample, true);
	view.setUint16(34, 16, true); // bits per sample
	writeAscii(36, 'data');
	view.setUint32(40, dataBytes, true);

	let offset = 44;
	for (let i = 0; i < pcm.length; i++) {
		const clamped = Math.max(-1, Math.min(1, pcm[i]!));
		view.setInt16(offset, Math.round(clamped < 0 ? clamped * 32768 : clamped * 32767), true);
		offset += 2;
	}
	return buffer;
}
