import type { BundleDirectorySink } from './sinks';

/** In-memory bundle directory for unit/integration tests. */
export function createMemoryDirectorySink(): BundleDirectorySink & {
	files: Map<string, Uint8Array<ArrayBuffer>>;
} {
	const files = new Map<string, Uint8Array<ArrayBuffer>>();

	function keyOf(relativePath: string): string {
		return relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
	}

	return {
		files,
		async writeText(relativePath, text) {
			// TS 5.8's lib types encode() as Uint8Array<ArrayBufferLike>, but
			// TextEncoder always allocates a plain ArrayBuffer, never a SAB.
			const encoded = new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>;
			files.set(keyOf(relativePath), encoded);
		},
		async writeBlob(relativePath, blob, onProgress) {
			const reader = blob.stream().getReader();
			const chunks: Uint8Array[] = [];
			let total = 0;
			for (;;) {
				const { value, done } = await reader.read();
				if (done) break;
				if (value) {
					chunks.push(value);
					total += value.byteLength;
					onProgress?.(total);
				}
			}
			const merged = new Uint8Array(total);
			let offset = 0;
			for (const chunk of chunks) {
				merged.set(chunk, offset);
				offset += chunk.byteLength;
			}
			files.set(keyOf(relativePath), merged);
		},
		async readText(relativePath) {
			const bytes = files.get(keyOf(relativePath));
			if (!bytes) return null;
			return new TextDecoder().decode(bytes);
		},
		async readBlob(relativePath) {
			const bytes = files.get(keyOf(relativePath));
			if (!bytes) return null;
			return new Blob([bytes]);
		},
		async exists(relativePath) {
			return files.has(keyOf(relativePath));
		},
		async getSize(relativePath) {
			const bytes = files.get(keyOf(relativePath));
			return bytes ? bytes.byteLength : null;
		}
	};
}
