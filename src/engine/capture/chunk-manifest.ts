import type { CaptureSourceSnapshot } from '../../protocol';

export type CaptureManifestRecord =
	| {
			kind: 'header';
			version: 1;
			sessionId: string;
			startedAtIso: string;
			epochUs: number | null;
			sources: CaptureSourceSnapshot[];
			chunkTargetS: number;
	  }
	| { kind: 'epoch'; epochUs: number }
	| {
			kind: 'chunk';
			sourceId: string;
			file: string;
			byteOffset: number;
			byteLength: number;
			fromUs: number;
			toUs: number;
			keyFrame: boolean;
			preEncodeDrops: number;
	  }
	| { kind: 'source-ended'; sourceId: string; reason: string }
	| { kind: 'finalize'; endedAtIso: string; reason: string };

export const MANIFEST_VERSION = 1;
