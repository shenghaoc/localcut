import type {
	MediaKind,
	MediaMetadata,
	NormalizedSourceTimingSnapshot,
	SourceColorHintsSnapshot,
	SourceHealthReportSnapshot,
	SourceHealthWarningSnapshot,
	SourceTrackTimingSnapshot
} from '../../protocol';
import type { SequentialAudioSource } from '../audio-source';
import type { VideoFrameProvider } from '../frame-source';

export type MediaAdapterId = 'mediabunny' | 'web-demuxer-diagnostics';
export type MediaAdapterRole = 'primary' | 'diagnostic';
export type SourceContainerKind =
	| 'mp4'
	| 'mov'
	| 'webm'
	| 'mp3'
	| 'ogg'
	| 'wav'
	| 'image'
	| 'unknown';
export type SourceFrameRateMode = 'constant' | 'variable' | 'unknown';
export type SourceColorHints = SourceColorHintsSnapshot;
export type NormalizedTrackTiming = SourceTrackTimingSnapshot;
export type NormalizedSourceTiming = NormalizedSourceTimingSnapshot;
export type SourceHealthWarning = SourceHealthWarningSnapshot;
export type SourceHealthReport = SourceHealthReportSnapshot;

export interface MediaAdapterOpenInput {
	readonly sourceId: string;
	readonly file: File;
}

export interface MediaAdapterInspectionResult {
	readonly inspection: SourceInspection;
	readonly warnings: readonly SourceHealthWarning[];
}

export interface PrimaryMediaAdapterOpenResult extends MediaAdapterInspectionResult {
	readonly handle: MediaInputHandle;
	readonly conformance: SourceConformance;
}

export interface MediaAdapter {
	readonly id: MediaAdapterId;
	readonly role: MediaAdapterRole;
	canInspect(file: File): boolean;
	inspect(input: MediaAdapterOpenInput): Promise<MediaAdapterInspectionResult>;
	open?(input: MediaAdapterOpenInput): Promise<PrimaryMediaAdapterOpenResult>;
}

export interface SourceInspection {
	readonly sourceId: string;
	readonly adapterId: MediaAdapterId;
	readonly fileName: string;
	readonly byteSize: number;
	readonly mimeType: string | null;
	readonly container: SourceContainerKind;
	readonly durationS: number | null;
	readonly tracks: readonly SourceTrackInspection[];
}

export type SourceTrackInspection = SourceVideoTrackInspection | SourceAudioTrackInspection;

export interface SourceBaseTrackInspection {
	readonly trackId: string;
	readonly codec: string | null;
	readonly canDecode: boolean;
	readonly startS: number;
	readonly durationS: number | null;
}

export interface SourceVideoTrackInspection extends SourceBaseTrackInspection {
	readonly kind: 'video';
	readonly codedWidth: number;
	readonly codedHeight: number;
	readonly displayWidth: number;
	readonly displayHeight: number;
	readonly frameRate: number | null;
	readonly frameRateMode: SourceFrameRateMode;
	readonly rotationDeg: number;
	readonly color: SourceColorHints;
}

export interface SourceAudioTrackInspection extends SourceBaseTrackInspection {
	readonly kind: 'audio';
	readonly sampleRate: number;
	readonly channels: number;
}

export interface SourceConformance {
	readonly sourceId: string;
	readonly adapterId: MediaAdapterId;
	readonly kind: MediaKind;
	readonly primaryVideoTrackId?: string;
	readonly primaryAudioTrackId?: string;
	readonly durationS: number;
	readonly timing: NormalizedSourceTiming;
	readonly health: 'ok' | 'warnings' | 'blocked';
}

export interface MediaInputHandle {
	readonly sourceId: string;
	readonly kind: MediaKind;
	readonly adapterId: MediaAdapterId;
	readonly metadata: MediaMetadata;
	readonly inspection: SourceInspection;
	readonly conformance: SourceConformance;
	readonly timing: NormalizedSourceTiming;
	readonly warnings: readonly SourceHealthWarning[];
	/** Decoded-frame provider for the primary video track / still; null if none. */
	readonly frameSource: VideoFrameProvider | null;
	/**
	 * Opens an additional sequential decode sink over the same video track, so a
	 * transition between two clips of one source can read both sides of the cut
	 * without thrashing the primary sink's iterator (Phase 13 T2.2). Returns null
	 * when the source has no decodable video. Created sinks are owned by the
	 * handle and released by {@link dispose}.
	 */
	readonly createSecondaryFrameSource?: () => VideoFrameProvider | null;
	/** Sequential decoded-audio source; null if none/undecodable. */
	readonly audioSource: SequentialAudioSource | null;
	readonly audioChannels: number;
	readonly audioSampleRate: number;
	/** Source display dimensions (after rotation/aspect), or 0 when no video. */
	readonly displayWidth: number;
	readonly displayHeight: number;
	/** Effective frame rate used for frame-step and the playback cadence. */
	readonly frameRate: number;
	/** Normalized decodable media duration. */
	readonly duration: number;
	/**
	 * Decodes a single normalized-source frame for thumbnail generation through a
	 * dedicated sink. The caller owns and must close the returned VideoFrame.
	 */
	readonly thumbnailAt: (timestamp: number) => Promise<VideoFrame | null>;
	readonly dispose: () => void;
}
