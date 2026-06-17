/** WebGPU device, OffscreenCanvas, and the zero-copy layered compositor (Phase 2/4/12/21). */

import presentSource from './shaders/present.wgsl?raw';
import clearSource from './shaders/clear.wgsl?raw';
import transformF32 from './shaders/transform.wgsl?raw';
import transformF16 from './shaders/transform.f16.wgsl?raw';
import compositeOverF32 from './shaders/composite-over.wgsl?raw';
import compositeOverF16 from './shaders/composite-over.f16.wgsl?raw';
import transitionMixF32 from './shaders/transition-mix.wgsl?raw';
import transitionMixF16 from './shaders/transition-mix.f16.wgsl?raw';
import sourceNormalizeF32 from './shaders/source-normalize.wgsl?raw';
import sourceNormalizeF16 from './shaders/source-normalize.f16.wgsl?raw';
import outputConvertF32 from './shaders/output-convert.wgsl?raw';
import outputConvertF16 from './shaders/output-convert.f16.wgsl?raw';
import opacityF32 from './shaders/opacity.wgsl?raw';
import opacityF16 from './shaders/opacity.f16.wgsl?raw';
import matteApplyF32 from './shaders/matte-apply.wgsl?raw';
import matteApplyF16 from './shaders/matte-apply.f16.wgsl?raw';
import matteBlurF32 from './shaders/matte-blur.wgsl?raw';
import matteBlurF16 from './shaders/matte-blur.f16.wgsl?raw';
import spotlightF32 from './shaders/spotlight.wgsl?raw';
import spotlightF16 from './shaders/spotlight.f16.wgsl?raw';
import blurRegionF32 from './shaders/blur-region.wgsl?raw';
import blurRegionF16 from './shaders/blur-region.f16.wgsl?raw';
import paddedBackgroundF32 from './shaders/padded-background.wgsl?raw';
import paddedBackgroundF16 from './shaders/padded-background.f16.wgsl?raw';
import clippingOverlaySource from './shaders/clipping-overlay.wgsl?raw';
import skinSmoothPrepareSource from './shaders/skin-smooth-prepare.wgsl?raw';
import skinSmoothBoxSource from './shaders/skin-smooth-box.wgsl?raw';
import skinSmoothCoeffsSource from './shaders/skin-smooth-coeffs.wgsl?raw';
import skinSmoothApplySource from './shaders/skin-smooth-apply.wgsl?raw';
import beautyWarpSource from './shaders/beauty-warp.wgsl?raw';
import scopesSource from './shaders/scopes.wgsl?raw';
import vectorscopeSource from './shaders/vectorscope.wgsl?raw';
import { EffectChain, type ClipEffectParams, isSkinSmoothActive } from './effects';
import { createComputePipeline } from './gpu-pipeline';
import type { ClipLut } from './lut';
import { packSkinBoxUniform, packSkinApplyUniform, radiusForHeight } from './skin-smooth';
import type { BeautyEffectSnapshot, SkinMaskSnapshot } from '../protocol';
import {
	isBeautyActive,
	LANDMARK_FLOATS,
	packBeautyUniform,
	packLandmarkBuffer
} from './beauty/beauty-params';
import {
	DEFAULT_TRANSFORM,
	packTransformUniform,
	TRANSFORM_UNIFORM_BYTES,
	type TransformParams
} from './transform';
import { OutputTransfer } from './colour';
import {
	DEFAULT_PADDED_BACKGROUND,
	normalizePaddedBackground,
	type PaddedBackgroundParams
} from './padded-background';
import {
	SCOPES_FEATURE_ENABLED,
	SCOPE_RES_X,
	SCOPE_HISTOGRAM_DATA_FLOATS,
	SCOPE_VECTORSCOPE_SIZE,
	histogramSlotOffset,
	waveformSlotOffset,
	paradeSlotOffset,
	vectorscopeSlotOffset,
	scopeWaveformDataFloats,
	scopeParadeDataFloats,
	scopeVectorscopeDataFloats,
	scopeTotalBufferFloats,
	writeScopeHeader,
	beginScopeWrite,
	endScopeWrite
} from './scopes';

const TRANSITION_KIND_MAP: Record<string, number> = {
	'cross-dissolve': 0,
	'dip-to-black': 1,
	wipe: 2,
	slide: 3
};
const TRANSITION_DIR_MAP: Record<string, number> = { left: 0, right: 1, up: 2, down: 3 };

export interface DeviceLostInfo {
	readonly reason: GPUDeviceLostReason;
	readonly message: string;
}

export interface GpuInit {
	/** Ready renderer, or null when WebGPU is unavailable. */
	renderer: PreviewRenderer | null;
	features: string[];
	/** Specific, actionable reason WebGPU is unavailable, or null when ready. */
	unavailableReason: string | null;
	limits: Record<string, number>;
	/** Resolves when device is lost. Only set when renderer is non-null. */
	deviceLost: Promise<DeviceLostInfo> | null;
}

/**
 * One composite layer.
 *  - `'frame'` — per-frame decoded video, re-imported every frame, colour-graded.
 *  - `'texture'` — a pre-rendered RGBA texture (Phase 14 title raster) uploaded
 *    once on edit and cached; it skips the colour chain and feeds the transform
 *    pass directly. Both kinds composite inside the one per-frame submission.
 */
export interface FrameCompositeLayer {
	kind: 'frame';
	/** Caller-owned; valid only for the submission issued by this call. */
	frame: VideoFrame;
	effects: ClipEffectParams;
	transform: TransformParams;
	lut?: ClipLut;
	/** Phase 32a: optional skin-mask sidecar. */
	skinMask?: SkinMaskSnapshot;
	/** Phase 32a: session-only bypass flag (never serialised). */
	skinSmoothBypass?: boolean;
	/** Phase 31: optional portrait matte texture view (alpha mask). */
	matteView?: GPUTextureView;
	/** Phase 31: matte strength (0..1). Only meaningful when matteView is set. */
	matteStrength?: number;
	/** Phase 31: matte mode — remove/replace share the apply pass; blur defocuses
	 *  the background. Defaults to 'remove' when matteView is set. */
	matteMode?: 'remove' | 'replace' | 'blur';
	/** Phase 31: blur-mode background radius (px at compositor resolution). */
	matteBlurRadius?: number;
	/** Phase 31: export path — guided-upsample refinement of the matte sample. */
	matteRefine?: boolean;
	/** Phase 32b: optional beauty effect sidecar. */
	beauty?: BeautyEffectSnapshot;
	/** Phase 32b: smoothed/interpolated 478x3 primary-face landmarks for this frame. */
	beautyLandmarks?: Float32Array;
	/** Phase 43: padded-background card render for screencast clips. */
	paddedBackground?: PaddedBackgroundParams;
	/** Phase 13: present when this layer participates in a transition blend. */
	transition?: import('./timeline').TransitionResolveMeta;
}

/**
 * A cached-texture layer. The view is owned by the caller's texture cache (Phase
 * 14 title raster) and must outlive the submission. Carries straight-alpha RGBA;
 * the transform pass premultiplies it like any graded frame.
 */
export interface TextureCompositeLayer {
	kind: 'texture';
	view: GPUTextureView;
	sourceWidth: number;
	sourceHeight: number;
	transform: TransformParams;
	/** Phase 13: present when this layer participates in a transition blend. */
	transition?: import('./timeline').TransitionResolveMeta;
	/**
	 * Phase 30: UV horizontal crop for typewriter animation. Default [1.0, 1.0]
	 * (no crop). Caption layers pass [cropRightFrac, 1.0]; non-caption layers
	 * omit this field or pass [1.0, 1.0]. Only U is cropped (horizontal reveal);
	 * V is unclamped. Applied in the transform shader as a UV clamp.
	 */
	uvCropMax?: [number, number];
}

export interface SpotlightCompositeLayer {
	kind: 'spotlight';
	transform: TransformParams;
	darkenStrength: number;
	transition?: import('./timeline').TransitionResolveMeta;
}

export interface BlurRegionCompositeLayer {
	kind: 'blur-region';
	transform: TransformParams;
	blurRadius: number;
	transition?: import('./timeline').TransitionResolveMeta;
}

export type CompositeLayer =
	| FrameCompositeLayer
	| TextureCompositeLayer
	| SpotlightCompositeLayer
	| BlurRegionCompositeLayer;

type RenderableCompositeLayer = FrameCompositeLayer | TextureCompositeLayer;

const DIAGNOSTIC_LIMIT_KEYS = [
	'maxTextureDimension2D',
	'maxBufferSize',
	'maxColorAttachments',
	'maxComputeWorkgroupSizeX',
	'maxComputeWorkgroupSizeY'
] as const;

function unavailable(reason: string): GpuInit {
	return { renderer: null, features: [], unavailableReason: reason, limits: {}, deviceLost: null };
}

function isRenderableLayer(layer: CompositeLayer | undefined): layer is RenderableCompositeLayer {
	return layer?.kind === 'frame' || layer?.kind === 'texture';
}

function clampUnit(value: number): number {
	return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function clampRange(value: number, min: number, max: number): number {
	return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : min;
}

function colourFromHex(hex: string): [number, number, number, number] {
	const normalised = /^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : '1a1a2e';
	const int = Number.parseInt(normalised, 16);
	return [((int >> 16) & 0xff) / 255, ((int >> 8) & 0xff) / 255, (int & 0xff) / 255, 1];
}

function packSpotlightUniform(layer: SpotlightCompositeLayer): Float32Array {
	const radius = clampRange(layer.transform.scale * 0.25, 0.025, 0.5);
	return new Float32Array([
		clampUnit(0.5 + layer.transform.x),
		clampUnit(0.5 + layer.transform.y),
		radius,
		radius,
		clampUnit(layer.darkenStrength),
		0,
		0,
		0
	]);
}

function packBlurRegionUniform(layer: BlurRegionCompositeLayer): Float32Array {
	const size = clampRange(layer.transform.scale, 0.03, 1);
	const cx = clampUnit(0.5 + layer.transform.x);
	const cy = clampUnit(0.5 + layer.transform.y);
	const rx = clampRange(cx - size * 0.5, 0, 1);
	const ry = clampRange(cy - size * 0.5, 0, 1);
	const rw = Math.min(size, 1 - rx);
	const rh = Math.min(size, 1 - ry);
	return new Float32Array([rx, ry, rw, rh, clampRange(layer.blurRadius, 1, 48), 0, 0, 0]);
}

function packPaddedBackgroundUniform(
	raw: PaddedBackgroundParams,
	outputWidth: number,
	outputHeight: number
): ArrayBuffer {
	const params = normalizePaddedBackground(raw);
	const buffer = new ArrayBuffer(144);
	const f32 = new Float32Array(buffer);
	const u32 = new Uint32Array(buffer);
	const marginX = params.insetMargin * (outputHeight / Math.max(1, outputWidth));
	const marginY = params.insetMargin;
	f32[0] = clampRange(marginX, 0, 0.45);
	f32[1] = clampRange(marginY, 0, 0.45);
	f32[2] = clampRange(marginX, 0, 0.45);
	f32[3] = clampRange(marginY, 0, 0.45);
	f32[4] = clampRange(params.cornerRadius / Math.max(1, outputHeight), 0, 0.08);
	f32[5] = clampUnit(params.shadowOpacity);
	f32[6] = params.shadowOffsetY / Math.max(1, outputHeight);
	u32[7] = params.background.kind === 'solid' ? 0 : params.background.kind === 'wallpaper' ? 2 : 1;
	const defaultGradient =
		DEFAULT_PADDED_BACKGROUND.background.kind === 'gradient'
			? DEFAULT_PADDED_BACKGROUND.background
			: {
					kind: 'gradient' as const,
					stops: [
						{ color: '#1a1a2e', pos: 0 },
						{ color: '#16213e', pos: 1 }
					],
					angleDeg: 0
				};

	const solid =
		params.background.kind === 'solid'
			? colourFromHex(params.background.color)
			: colourFromHex(defaultGradient.stops[0]!.color);
	f32.set(solid, 8);

	const gradient = params.background.kind === 'gradient' ? params.background : defaultGradient;
	const angle = ((gradient.angleDeg ?? 0) * Math.PI) / 180;
	f32[12] = Math.cos(angle);
	f32[13] = Math.sin(angle);
	const stops = [...gradient.stops]
		.slice(0, 5)
		.sort((a, b) => a.pos - b.pos)
		.map((stop) => ({ ...stop, pos: clampUnit(stop.pos) }));
	const safeStops = stops.length > 0 ? stops : defaultGradient.stops;
	u32[14] = safeStops.length;
	u32[15] = 0;
	for (let i = 0; i < 5; i += 1) {
		const stop = safeStops[Math.min(i, safeStops.length - 1)]!;
		const [r, g, b] = colourFromHex(stop.color);
		const base = 16 + i * 4;
		f32[base] = r;
		f32[base + 1] = g;
		f32[base + 2] = b;
		f32[base + 3] = clampUnit(stop.pos);
	}
	return buffer;
}

/**
 * Owns the WebGPU device and the per-frame zero-copy layered compositor.
 *
 * Per frame, inside ONE `GPUCommandEncoder` and ONE `queue.submit`:
 *   clear accumulator (opaque black)
 *   for each layer (bottom → top):
 *     importExternalTexture(frame)            // re-imported every frame, never cached
 *     colour chain (A/B/C scratch, per-layer params)
 *     transform pass (position/scale/rotation/anchor/fit) → premultiplied T
 *     composite-over (premultiplied) → accumulator ping-pong
 *   present(final accumulator)
 *
 * Multiple `importExternalTexture` calls per frame are expected and allowed — the
 * architecture gate bans caching imports *across* frames, not several within one.
 * No CPU pixel readback ever happens.
 */
export class PreviewRenderer {
	private readonly device: GPUDevice;
	private readonly context: GPUCanvasContext;
	private readonly format: GPUTextureFormat;
	private readonly canvas: OffscreenCanvas;

	private readonly effectChain: EffectChain;
	private readonly presentPipeline: GPURenderPipeline;
	private readonly clearPipeline: GPUComputePipeline;
	private readonly transformPipeline: GPUComputePipeline;
	private readonly compositePipeline: GPUComputePipeline;
	// Phase 13: transition-mix pipeline (replaces over-blend for transition pairs)
	private readonly transitionMixPipeline: GPUComputePipeline;
	// Phase 21: new pipeline stages
	private readonly sourceNormalizePipeline: GPUComputePipeline;
	private readonly outputConvertPipeline: GPUComputePipeline;
	private readonly opacityPipeline: GPUComputePipeline;
	// Phase 31: matte-apply pipeline (alpha mask multiplication).
	private readonly mattePipeline: GPUComputePipeline;
	// Phase 31: matte-blur pipeline (mask-driven background blur).
	private readonly matteBlurPipeline: GPUComputePipeline;
	// Phase 43: source-less callout effect layers over the current accumulator.
	private readonly spotlightPipeline: GPUComputePipeline;
	private readonly blurRegionHorizontalPipeline: GPUComputePipeline;
	private readonly blurRegionVerticalPipeline: GPUComputePipeline;
	private readonly paddedBackgroundPipeline: GPUComputePipeline;
	private readonly clippingOverlayPipeline: GPUComputePipeline | null;
	private readonly sampler: GPUSampler;

	// Colour-grade scratch (shared sequentially across layers within a frame).
	private storageA: GPUTexture | null = null;
	private storageB: GPUTexture | null = null;
	private storageC: GPUTexture | null = null;
	private storageAView: GPUTextureView | null = null;
	private storageBView: GPUTextureView | null = null;
	private storageCView: GPUTextureView | null = null;
	// Per-layer transform output.
	private transformTex: GPUTexture | null = null;
	private transformView: GPUTextureView | null = null;
	// Phase 13: second transform output for transition pairs.
	private transformTexB: GPUTexture | null = null;
	private transformViewB: GPUTextureView | null = null;
	// Accumulator ping-pong.
	private accTex: [GPUTexture, GPUTexture] | null = null;
	private accView: [GPUTextureView, GPUTextureView] | null = null;
	// Phase 21: output-conversion scratch (post-composite, before present).
	private outConvTex: GPUTexture | null = null;
	private outConvView: GPUTextureView | null = null;
	// Phase 21: opacity scratch (dedicated texture to avoid aliasing with storage.c).
	private opacityTex: GPUTexture | null = null;
	private opacityView: GPUTextureView | null = null;
	// Phase 21: zebra overlay texture (only allocated when toggled on).
	private zebraTex: GPUTexture | null = null;
	private zebraView: GPUTextureView | null = null;
	private _zebraUniform: GPUBuffer | null = null;
	private zebraEnabled = false;

	// Phase 21: per-layer normalization uniform buffers.
	private readonly normalizeBuffers: GPUBuffer[] = [];
	private readonly normalizeGroupLayout: GPUBindGroupLayout;
	// Per-layer opacity uniform buffers.
	private readonly opacityBuffers: GPUBuffer[] = [];
	private readonly opacityGroupLayout: GPUBindGroupLayout;
	// Phase 31: per-layer matte uniform buffers.
	private readonly matteBuffers: GPUBuffer[] = [];
	private readonly matteGroupLayout: GPUBindGroupLayout;
	private readonly matteBlurGroupLayout: GPUBindGroupLayout;
	private readonly spotlightGroupLayout: GPUBindGroupLayout;
	private readonly blurRegionHorizontalGroupLayout: GPUBindGroupLayout;
	private readonly blurRegionVerticalGroupLayout: GPUBindGroupLayout;
	private readonly paddedBackgroundGroupLayout: GPUBindGroupLayout;
	private readonly spotlightUniformBuffers: GPUBuffer[] = [];
	private readonly blurRegionUniformBuffers: GPUBuffer[] = [];
	private readonly paddedBackgroundUniformBuffers: GPUBuffer[] = [];
	// Phase 13: transition-mix uniform buffers.
	private readonly transitionUniformBuffers: GPUBuffer[] = [];
	private readonly transitionGroupLayout: GPUBindGroupLayout;
	// Output-conversion uniform buffer.
	private outConvUniform: GPUBuffer | null = null;
	private readonly outConvGroupLayout: GPUBindGroupLayout;

	// Phase 32a: skin-smoothing pipelines and resources.
	private readonly skinSmoothPreparePipeline: GPUComputePipeline;
	private readonly skinSmoothBoxPipeline: GPUComputePipeline;
	private readonly skinSmoothCoeffsPipeline: GPUComputePipeline;
	private readonly skinSmoothApplyPipeline: GPUComputePipeline;
	private readonly beautyWarpPipeline: GPUComputePipeline;
	private readonly skinSmoothGroupLayout: GPUBindGroupLayout;
	private readonly skinSmoothBoxGroupLayout: GPUBindGroupLayout;
	private readonly skinSmoothCoeffsGroupLayout: GPUBindGroupLayout;
	private readonly skinSmoothApplyGroupLayout: GPUBindGroupLayout;
	private readonly beautyWarpGroupLayout: GPUBindGroupLayout;
	private skinScratch0: GPUTexture | null = null;
	private skinScratch1: GPUTexture | null = null;
	private skinScratch0View: GPUTextureView | null = null;
	private skinScratch1View: GPUTextureView | null = null;
	private skinBoxUniformH: GPUBuffer | null = null;
	private skinBoxUniformV: GPUBuffer | null = null;
	private skinBoxUniformHeight: number | null = null;
	private readonly skinApplyUniforms: GPUBuffer[] = [];
	private readonly beautyUniforms: GPUBuffer[] = [];
	private readonly beautyLandmarkBuffers: GPUBuffer[] = [];

	// Phase 21: scopes SAB reference (set by worker for scope output).
	private scopeSab: Float32Array | null = null;
	private scopesEnabled = false;
	// Phase 21: scope compute pipelines + atomic storage buffers + staging pool.
	private readonly scopesPipeline: GPUComputePipeline;
	private readonly vectorscopePipeline: GPUComputePipeline;
	private readonly scopesGroupLayout: GPUBindGroupLayout;
	private readonly vectorscopeGroupLayout: GPUBindGroupLayout;
	private scopeHistogramBuf: GPUBuffer | null = null;
	private scopeWaveformBuf: GPUBuffer | null = null;
	private scopeParadeBuf: GPUBuffer | null = null;
	private scopeClipBuf: GPUBuffer | null = null;
	private scopeVecBuf: GPUBuffer | null = null;
	private scopeUniformBuf: GPUBuffer | null = null;
	private scopeVecUniformBuf: GPUBuffer | null = null;
	private scopeWaveformInit: Uint32Array | null = null;
	private scopeParadeInit: Uint32Array | null = null;
	// `scopeStagingFree` is the LIFO recycle pool — `pop()` for dispatch, `push()` back
	// from the mapAsync callback. `scopeStagingBuffers` is the master list used only by
	// `destroy()` so in-flight buffers (popped from `free` but mid-mapAsync) are still
	// reachable and don't leak when the renderer tears down.
	private readonly scopeStagingFree: GPUBuffer[] = [];
	private readonly scopeStagingBuffers: GPUBuffer[] = [];
	private scopeStagingTotalBytes = 0;
	private static readonly SCOPE_STAGING_POOL = 3;

	private presentBindGroup: GPUBindGroup | null = null;
	/** Accumulator view holding the most recent composited frame (preview + export). */
	private lastPresentView: GPUTextureView | null = null;
	/** Phase 21: pre-output-conversion accumulator for zebra overlay + scopes. */
	private _lastAccView: GPUTextureView | null = null;
	/** Per-layer transform uniform buffers (grown on demand; one submission, many layers). */
	private readonly transformBuffers: GPUBuffer[] = [];
	private width = 0;
	private height = 0;
	private submissionCount = 0;

	constructor(
		device: GPUDevice,
		context: GPUCanvasContext,
		format: GPUTextureFormat,
		canvas: OffscreenCanvas,
		useF16: boolean
	) {
		this.device = device;
		this.context = context;
		this.format = format;
		this.canvas = canvas;

		this.effectChain = new EffectChain(device, useF16);

		const presentModule = device.createShaderModule({ code: presentSource });
		this.presentPipeline = device.createRenderPipeline({
			layout: 'auto',
			vertex: { module: presentModule, entryPoint: 'vs' },
			fragment: { module: presentModule, entryPoint: 'fs', targets: [{ format }] },
			primitive: { topology: 'triangle-list' }
		});
		this.clearPipeline = createComputePipeline(device, clearSource, 'clear');
		this.transformPipeline = createComputePipeline(
			device,
			useF16 ? transformF16 : transformF32,
			'transform'
		);
		this.compositePipeline = createComputePipeline(
			device,
			useF16 ? compositeOverF16 : compositeOverF32,
			'composite-over'
		);

		// Phase 13: transition-mix pipeline for cut-point blends.
		this.transitionMixPipeline = createComputePipeline(
			device,
			useF16 ? transitionMixF16 : transitionMixF32,
			'transition-mix'
		);

		// Phase 21: new stage pipelines
		this.sourceNormalizePipeline = createComputePipeline(
			device,
			useF16 ? sourceNormalizeF16 : sourceNormalizeF32,
			'source-normalize'
		);
		this.outputConvertPipeline = createComputePipeline(
			device,
			useF16 ? outputConvertF16 : outputConvertF32,
			'output-convert'
		);
		this.opacityPipeline = createComputePipeline(
			device,
			useF16 ? opacityF16 : opacityF32,
			'opacity'
		);
		// Phase 31: matte-apply (remove/replace) + matte-blur passes.
		this.mattePipeline = createComputePipeline(
			device,
			useF16 ? matteApplyF16 : matteApplyF32,
			'matte-apply'
		);
		this.matteBlurPipeline = createComputePipeline(
			device,
			useF16 ? matteBlurF16 : matteBlurF32,
			'matte-blur'
		);
		this.spotlightPipeline = createComputePipeline(
			device,
			useF16 ? spotlightF16 : spotlightF32,
			'spotlight'
		);
		const blurRegionModule = device.createShaderModule({
			code: useF16 ? blurRegionF16 : blurRegionF32,
			label: 'blur-region'
		});
		this.blurRegionHorizontalPipeline = device.createComputePipeline({
			label: 'blur-region-horizontal',
			layout: 'auto',
			compute: { module: blurRegionModule, entryPoint: 'horizontal_pass' }
		});
		this.blurRegionVerticalPipeline = device.createComputePipeline({
			label: 'blur-region-vertical',
			layout: 'auto',
			compute: { module: blurRegionModule, entryPoint: 'vertical_pass' }
		});
		this.paddedBackgroundPipeline = createComputePipeline(
			device,
			useF16 ? paddedBackgroundF16 : paddedBackgroundF32,
			'padded-background'
		);
		this.clippingOverlayPipeline = (() => {
			try {
				return createComputePipeline(device, clippingOverlaySource, 'clipping-overlay');
			} catch {
				return null;
			}
		})();

		// Phase 32a: skin-smoothing pipelines (f32-only, no f16 variant).
		this.skinSmoothPreparePipeline = device.createComputePipeline({
			layout: 'auto',
			compute: {
				module: device.createShaderModule({ code: skinSmoothPrepareSource }),
				entryPoint: 'main'
			}
		});
		this.skinSmoothBoxPipeline = device.createComputePipeline({
			layout: 'auto',
			compute: {
				module: device.createShaderModule({ code: skinSmoothBoxSource }),
				entryPoint: 'main'
			}
		});
		this.skinSmoothCoeffsPipeline = device.createComputePipeline({
			layout: 'auto',
			compute: {
				module: device.createShaderModule({ code: skinSmoothCoeffsSource }),
				entryPoint: 'main'
			}
		});
		this.skinSmoothApplyPipeline = device.createComputePipeline({
			layout: 'auto',
			compute: {
				module: device.createShaderModule({ code: skinSmoothApplySource }),
				entryPoint: 'main'
			}
		});
		this.beautyWarpPipeline = device.createComputePipeline({
			layout: 'auto',
			compute: {
				module: device.createShaderModule({ code: beautyWarpSource }),
				entryPoint: 'main'
			}
		});

		// Phase 21: scope pipelines. The WGSL is f32-only (atomic<u32> accumulators)
		// so there is no f16 variant — `useF16` does not gate these.
		this.scopesPipeline = createComputePipeline(device, scopesSource, 'scopes');
		this.vectorscopePipeline = createComputePipeline(device, vectorscopeSource, 'vectorscope');
		this.scopesGroupLayout = this.scopesPipeline.getBindGroupLayout(0);
		this.vectorscopeGroupLayout = this.vectorscopePipeline.getBindGroupLayout(0);

		this.normalizeGroupLayout = this.sourceNormalizePipeline.getBindGroupLayout(0);
		this.outConvGroupLayout = this.outputConvertPipeline.getBindGroupLayout(0);
		this.opacityGroupLayout = this.opacityPipeline.getBindGroupLayout(0);
		this.matteGroupLayout = this.mattePipeline.getBindGroupLayout(0);
		this.matteBlurGroupLayout = this.matteBlurPipeline.getBindGroupLayout(0);
		this.spotlightGroupLayout = this.spotlightPipeline.getBindGroupLayout(0);
		this.blurRegionHorizontalGroupLayout = this.blurRegionHorizontalPipeline.getBindGroupLayout(0);
		this.blurRegionVerticalGroupLayout = this.blurRegionVerticalPipeline.getBindGroupLayout(0);
		this.paddedBackgroundGroupLayout = this.paddedBackgroundPipeline.getBindGroupLayout(0);
		this.transitionGroupLayout = this.transitionMixPipeline.getBindGroupLayout(0);
		this.skinSmoothGroupLayout = this.skinSmoothPreparePipeline.getBindGroupLayout(0);
		this.skinSmoothBoxGroupLayout = this.skinSmoothBoxPipeline.getBindGroupLayout(0);
		this.skinSmoothCoeffsGroupLayout = this.skinSmoothCoeffsPipeline.getBindGroupLayout(0);
		this.skinSmoothApplyGroupLayout = this.skinSmoothApplyPipeline.getBindGroupLayout(0);
		this.beautyWarpGroupLayout = this.beautyWarpPipeline.getBindGroupLayout(0);

		this.sampler = device.createSampler({
			magFilter: 'linear',
			minFilter: 'linear',
			addressModeU: 'clamp-to-edge',
			addressModeV: 'clamp-to-edge'
		});
	}

	get size(): { width: number; height: number } {
		return { width: this.width, height: this.height };
	}

	/** The compositor's device — title textures must be uploaded on it (Phase 14). */
	get gpuDevice(): GPUDevice {
		return this.device;
	}

	/** Submissions issued by the last `present()` call (always 1 when a frame rendered). */
	get lastFrameSubmissionCount(): number {
		return this.submissionCount;
	}

	/** Final composited view from the most recent frame (preview + export share this). */
	getProcessedTextureView(): GPUTextureView | null {
		return this.lastPresentView;
	}

	/** Phase 21: set the SAB used for scope output (written by worker, read by UI). */
	setScopeSab(sab: SharedArrayBuffer): void {
		this.scopeSab = new Float32Array(sab);
	}

	/** Phase 21: toggle the zebra clipping overlay on/off. */
	setZebraEnabled(enabled: boolean): void {
		this.zebraEnabled = enabled;
		if (enabled && !this.zebraTex && this.width > 0) {
			const usage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING;
			this.zebraTex = this.device.createTexture({
				size: { width: this.width, height: this.height },
				format: 'rgba8unorm',
				usage
			});
			this.zebraView = this.zebraTex.createView();
		}
	}

	/**
	 * Phase 21: enable/disable scope computation during the preview loop. Gated by
	 * the `SCOPES_FEATURE_ENABLED` flag (B7) — while the scope pipeline is unfinished
	 * this is a no-op, so no scope pass can ever run by default.
	 */
	setScopesEnabled(enabled: boolean): void {
		this.scopesEnabled = enabled && SCOPES_FEATURE_ENABLED;
	}

	/** Whether scope dispatch will actually run on the next frame (test/diagnostics). */
	get scopesActive(): boolean {
		return this.scopesEnabled;
	}

	importLut(lut: ClipLut): void {
		this.effectChain.importLut(lut);
	}

	pruneLuts(activeKeys: ReadonlySet<string>): void {
		this.effectChain.pruneLuts(activeKeys);
	}

	/**
	 * (Re)allocates the compute textures and resizes the canvas backing store.
	 * Cheap no-op when the size is unchanged.
	 */
	setPreviewSize(width: number, height: number): void {
		const w = Math.max(2, width);
		const h = Math.max(2, height);
		if (w === this.width && h === this.height && this.storageA) return;

		this.width = w;
		this.height = h;
		this.canvas.width = w;
		this.canvas.height = h;
		this.context.configure({
			device: this.device,
			format: this.format,
			alphaMode: 'premultiplied'
		});

		const usage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING;
		const size = { width: w, height: h };

		this.destroyTextures();

		this.storageA = this.device.createTexture({ size, format: 'rgba8unorm', usage });
		this.storageB = this.device.createTexture({ size, format: 'rgba8unorm', usage });
		this.storageC = this.device.createTexture({ size, format: 'rgba8unorm', usage });
		this.transformTex = this.device.createTexture({ size, format: 'rgba8unorm', usage });
		this.transformTexB = this.device.createTexture({ size, format: 'rgba8unorm', usage });
		// Phase 21: output-conversion scratch
		this.outConvTex = this.device.createTexture({ size, format: 'rgba8unorm', usage });
		// Phase 21: opacity scratch (dedicated to avoid aliasing)
		this.opacityTex = this.device.createTexture({ size, format: 'rgba8unorm', usage });
		this.accTex = [
			this.device.createTexture({ size, format: 'rgba8unorm', usage }),
			this.device.createTexture({ size, format: 'rgba8unorm', usage })
		];
		this.storageAView = this.storageA.createView();
		this.storageBView = this.storageB.createView();
		this.storageCView = this.storageC.createView();
		this.transformView = this.transformTex.createView();
		this.outConvView = this.outConvTex!.createView();
		this.opacityView = this.opacityTex!.createView();
		this.accView = [this.accTex[0].createView(), this.accTex[1].createView()];

		this.lastPresentView = null;
		this.transformViewB = this.transformTexB?.createView() ?? null;
		this.presentBindGroup = null;
	}

	/**
	 * Renders one frame from a layer stack (bottom → top). The caller owns every
	 * `frame` and must `.close()` it afterwards; external textures are valid only
	 * for the submission issued here. An empty stack clears to black.
	 */
	present(layers: readonly CompositeLayer[]): void {
		if (!this.accView || !this.storageAView || !this.storageBView || !this.storageCView) return;

		const encoder = this.device.createCommandEncoder();
		const finalView = this.compositeLayers(encoder, layers);

		// Phase 21: optional zebra clipping overlay — fed from pre-conversion
		// accumulator so isClipped() can detect out-of-range values.
		let presentView = finalView;
		if (this.zebraEnabled && this.clippingOverlayPipeline && this.zebraView && this._lastAccView) {
			presentView = this.encodeZebraOverlay(encoder, finalView, this._lastAccView);
		}

		// Phase 21: scope dispatch when enabled (post-composite, pre-present)
		if (this.scopesEnabled && this._lastAccView && this.scopeSab) {
			this.dispatchScopes(encoder, this._lastAccView);
		}

		if (presentView !== this.lastPresentView || !this.presentBindGroup) {
			this.presentBindGroup = this.device.createBindGroup({
				layout: this.presentPipeline.getBindGroupLayout(0),
				entries: [
					{ binding: 0, resource: presentView },
					{ binding: 1, resource: this.sampler }
				]
			});
			this.lastPresentView = presentView;
		}

		const render = encoder.beginRenderPass({
			colorAttachments: [
				{
					view: this.context.getCurrentTexture().createView(),
					loadOp: 'clear',
					storeOp: 'store',
					clearValue: { r: 0, g: 0, b: 0, a: 1 }
				}
			]
		});
		render.setPipeline(this.presentPipeline);
		render.setBindGroup(0, this.presentBindGroup);
		render.draw(3);
		render.end();

		// Single submission per frame: clear → N×(import → grade → transform → composite) → present.
		this.device.queue.submit([encoder.finish()]);
		this.submissionCount = 1;
	}

	/**
	 * Encodes the full layered composite into `encoder` and returns the final
	 * accumulator view (after compositing, before output-conversion). Clears the
	 * accumulator to opaque black, then composites each layer "over" it in array
	 * order (bottom track first).
	 *
	 * Stage order (single source of truth: PIPELINE_ORDER in colour.ts):
	 *   source-normalization → base-correction → lut-apply → opacity →
	 *   transform → compositing → output-conversion
	 *
	 * Returns the final output-converted view. The pre-conversion accumulator
	 * view is saved to `_lastAccView` for zebra overlay and scope diagnostics.
	 */
	private compositeLayers(
		encoder: GPUCommandEncoder,
		layers: readonly CompositeLayer[]
	): GPUTextureView {
		const accView = this.accView!;
		const wgX = Math.ceil(this.width / 8);
		const wgY = Math.ceil(this.height / 8);

		// Clear accumulator slot 0 to opaque black.
		{
			const bindGroup = this.device.createBindGroup({
				layout: this.clearPipeline.getBindGroupLayout(0),
				entries: [{ binding: 0, resource: accView[0] }]
			});
			const pass = encoder.beginComputePass();
			pass.setPipeline(this.clearPipeline);
			pass.setBindGroup(0, bindGroup);
			pass.dispatchWorkgroups(wgX, wgY);
			pass.end();
		}

		const storage = { a: this.storageAView!, b: this.storageBView!, c: this.storageCView! };
		let acc = 0;
		let transitionCount = 0;

		const processLayer = (
			layer: RenderableCompositeLayer,
			slot: number,
			transformDst: GPUTextureView
		): { srcWidth: number; srcHeight: number } => {
			const srcView =
				layer.kind === 'frame'
					? this.encodeSourceNormalize(encoder, layer, storage, slot)
					: layer.view;
			const srcWidth = layer.kind === 'frame' ? layer.frame.displayWidth : layer.sourceWidth;
			const srcHeight = layer.kind === 'frame' ? layer.frame.displayHeight : layer.sourceHeight;
			const correctedView =
				layer.kind === 'frame'
					? this.effectChain.encodeBaseCorrection(
							encoder,
							srcView,
							storage,
							this.width,
							this.height,
							layer.effects,
							slot
						)
					: srcView;
			let lutView = correctedView;
			if (layer.kind === 'frame' && layer.lut && layer.effects.lutStrength > 0) {
				const lutDst =
					correctedView === storage.a
						? storage.b
						: correctedView === storage.b
							? storage.c
							: storage.a;
				lutView = this.effectChain.encodeLut(
					encoder,
					correctedView,
					lutDst,
					layer.lut,
					layer.effects,
					slot,
					wgX,
					wgY
				);
			}
			// Phase 32a skin-smoothing then Phase 31 matte — both ride between LUT
			// and opacity; matte applies to the skin-smoothed output.
			let stageView = lutView;
			if (layer.kind === 'frame' && isSkinSmoothActive(layer.effects) && !layer.skinSmoothBypass) {
				const skinDst =
					stageView === storage.a ? storage.b : stageView === storage.b ? storage.c : storage.a;
				this.encodeSkinSmooth(
					encoder,
					stageView,
					skinDst,
					layer.effects.skinSmoothStrength,
					layer.skinMask,
					slot,
					wgX,
					wgY
				);
				stageView = skinDst;
			}
			// Phase 31: portrait matte (background removal/replace/blur).
			if (
				layer.kind === 'frame' &&
				layer.matteView &&
				layer.matteStrength !== undefined &&
				layer.matteStrength > 0
			) {
				const matteDst =
					stageView === storage.a ? storage.b : stageView === storage.b ? storage.c : storage.a;
				stageView = this.encodeMatte(
					encoder,
					stageView,
					layer.matteView,
					{
						strength: layer.matteStrength,
						mode: layer.matteMode ?? 'remove',
						blurRadius: layer.matteBlurRadius ?? 0,
						refine: layer.matteRefine ?? false
					},
					matteDst,
					slot,
					wgX,
					wgY
				);
			}
			// Phase 32b: landmark-driven beauty warp. Missing landmarks degrade to identity.
			if (
				layer.kind === 'frame' &&
				layer.beauty &&
				isBeautyActive(layer.beauty) &&
				layer.beautyLandmarks &&
				layer.beautyLandmarks.length > 0
			) {
				const beautyDst =
					stageView === storage.a ? storage.b : stageView === storage.b ? storage.c : storage.a;
				this.encodeBeautyWarp(
					encoder,
					stageView,
					beautyDst,
					layer.beauty,
					layer.beautyLandmarks,
					slot,
					wgX,
					wgY
				);
				stageView = beautyDst;
			}
			// Phase 38a: film looks (halation → grain → vignette) after LUT + skin
			// smooth + matte + beauty, before opacity. Fixed order documented on encodeFilmLooks.
			let filmView = stageView;
			if (layer.kind === 'frame') {
				const frameTimeSeed = layer.frame.timestamp / 1e6;
				filmView = this.effectChain.encodeFilmLooks(
					encoder,
					stageView,
					storage,
					this.width,
					this.height,
					layer.effects,
					slot,
					frameTimeSeed
				);
			}
			const paddedBackgroundDst = filmView === storage.a ? storage.b : storage.a;
			const paddedBackgroundView =
				layer.kind === 'frame' && layer.paddedBackground
					? this.encodePaddedBackground(
							encoder,
							filmView,
							paddedBackgroundDst,
							layer.paddedBackground,
							slot,
							wgX,
							wgY
						)
					: filmView;
			const transformSourceWidth =
				layer.kind === 'frame' && layer.paddedBackground ? this.width : srcWidth;
			const transformSourceHeight =
				layer.kind === 'frame' && layer.paddedBackground ? this.height : srcHeight;
			const opaqueView = this.encodeOpacity(
				encoder,
				paddedBackgroundView,
				layer.transform,
				slot,
				wgX,
				wgY
			);
			const xfParams =
				layer.transform.opacity < 1.0 && opaqueView !== paddedBackgroundView
					? { ...layer.transform, opacity: 1.0 }
					: layer.transform;
			this.encodeTransformDirect(
				encoder,
				xfParams,
				opaqueView,
				transformSourceWidth,
				transformSourceHeight,
				slot,
				wgX,
				wgY,
				transformDst,
				layer.kind === 'texture' ? layer.uvCropMax : undefined
			);
			return { srcWidth, srcHeight };
		};

		for (let i = 0; i < layers.length; i++) {
			const layer = layers[i]!;
			const nextLayer = layers[i + 1];
			if (layer.kind === 'spotlight') {
				const under = acc;
				const over = under === 0 ? 1 : 0;
				this.encodeSpotlightLayer(encoder, accView[under], accView[over], layer, i, wgX, wgY);
				acc = over;
				continue;
			}
			if (layer.kind === 'blur-region') {
				const under = acc;
				const over = under === 0 ? 1 : 0;
				this.encodeBlurRegionLayer(
					encoder,
					accView[under],
					storage.a,
					accView[over],
					layer,
					i,
					wgX,
					wgY
				);
				acc = over;
				continue;
			}
			if (!isRenderableLayer(layer)) continue;
			const isTransitionPair =
				layer.transition &&
				isRenderableLayer(nextLayer) &&
				nextLayer.transition &&
				layer.transition.transitionId === nextLayer.transition.transitionId;

			if (isTransitionPair) {
				const transition = layer.transition!;
				const isOutgoing = transition.role === 'outgoing';
				const outgoing = isOutgoing ? layer : nextLayer;
				const incoming = isOutgoing ? nextLayer : layer;

				processLayer(outgoing, i, this.transformViewB!);
				processLayer(incoming, i + 1, this.transformView!);

				const under = acc;
				const over = under === 0 ? 1 : 0;

				let transBuffer = this.transitionUniformBuffers[transitionCount];
				if (!transBuffer) {
					transBuffer = this.device.createBuffer({
						size: 16,
						usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
					});
					this.transitionUniformBuffers[transitionCount] = transBuffer;
				}
				transitionCount++;
				const direction = TRANSITION_DIR_MAP[transition.params?.direction ?? 'left'] ?? 0;
				const arrayBuffer = new ArrayBuffer(16);
				const floatView = new Float32Array(arrayBuffer);
				const uintView = new Uint32Array(arrayBuffer);
				floatView[0] = transition.mixT;
				uintView[1] = TRANSITION_KIND_MAP[transition.kind] ?? 0;
				uintView[2] = direction;
				this.device.queue.writeBuffer(transBuffer, 0, arrayBuffer);

				// Phase 13: blend the two transform outputs into a scratch texture
				// first, then composite that result over the accumulator so layers
				// below the transition track are preserved.
				// blendDst intentionally aliases storage.a.  This is safe only because the
				// transition-mix dispatch is recorded immediately after both processLayer calls
				// and before any subsequent layer's colour-chain pass could write storage.a.
				// Any future change to processLayer that writes storage.a after its transform
				// pass would silently corrupt the transition blend — update this invariant if so.
				const blendDst = storage.a;
				const transitionBindGroup = this.device.createBindGroup({
					layout: this.transitionGroupLayout,
					entries: [
						{ binding: 0, resource: { buffer: transBuffer } },
						{ binding: 1, resource: this.transformViewB! }, // outgoing
						{ binding: 2, resource: this.transformView! }, // incoming
						{ binding: 3, resource: this.sampler },
						{ binding: 4, resource: this.sampler },
						{ binding: 5, resource: blendDst }
					]
				});
				{
					const transPass = encoder.beginComputePass();
					transPass.setPipeline(this.transitionMixPipeline);
					transPass.setBindGroup(0, transitionBindGroup);
					transPass.dispatchWorkgroups(wgX, wgY);
					transPass.end();
				}

				// Composite the blended pair over the accumulator.
				{
					const compBindGroup = this.device.createBindGroup({
						layout: this.compositePipeline.getBindGroupLayout(0),
						entries: [
							{ binding: 0, resource: accView[under] },
							{ binding: 1, resource: blendDst },
							{ binding: 2, resource: accView[over] }
						]
					});
					const compPass = encoder.beginComputePass();
					compPass.setPipeline(this.compositePipeline);
					compPass.setBindGroup(0, compBindGroup);
					compPass.dispatchWorkgroups(wgX, wgY);
					compPass.end();
				}

				acc = over;
				i += 1;
			} else {
				processLayer(layer, i, this.transformView!);

				const under = acc;
				const over = under === 0 ? 1 : 0;
				const bindGroup = this.device.createBindGroup({
					layout: this.compositePipeline.getBindGroupLayout(0),
					entries: [
						{ binding: 0, resource: accView[under] },
						{ binding: 1, resource: this.transformView! },
						{ binding: 2, resource: accView[over] }
					]
				});
				const pass = encoder.beginComputePass();
				pass.setPipeline(this.compositePipeline);
				pass.setBindGroup(0, bindGroup);
				pass.dispatchWorkgroups(wgX, wgY);
				pass.end();
				acc = over;
			}
		}

		this._lastAccView = accView[acc];
		return this.encodeOutputConvert(encoder, accView[acc], wgX, wgY);
	}

	// ── Stage encoders (Phase 21) ──────────────────────────────────────────

	/** Stage 1: source-normalization — import + normalize to working linear space. */
	private encodeSourceNormalize(
		encoder: GPUCommandEncoder,
		layer: FrameCompositeLayer,
		storage: { a: GPUTextureView; b: GPUTextureView; c: GPUTextureView },
		slot: number
	): GPUTextureView {
		const wgX = Math.ceil(this.width / 8);
		const wgY = Math.ceil(this.height / 8);

		// Import external texture via passthrough into storage.a
		const imported = this.effectChain.encodeColourImport(
			encoder,
			this.device.importExternalTexture({ source: layer.frame }),
			storage,
			this.width,
			this.height
		);

		// Source normalization: decode transfer + convert colour space to working linear.
		// When per-clip colour metadata is available, the per-clip normalization params
		// are written to the uniform buffer; currently defaults to identity (sRGB→linear).
		let buffer = this.normalizeBuffers[slot];
		if (!buffer) {
			buffer = this.device.createBuffer({
				size: 8, // inverseTransfer: u32 + fullRange: u32
				usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
			});
			this.normalizeBuffers[slot] = buffer;
		}
		// Default: sRGB→linear, full range
		this.device.queue.writeBuffer(buffer, 0, new Uint32Array([2, 1]));

		// Normalize into storage.c (not storage.b — storage.a holds the imported
		// frame and storage.b is the first ping-pong slot in encodeBaseCorrection)
		const dstView = storage.c;
		const bindGroup = this.device.createBindGroup({
			layout: this.normalizeGroupLayout,
			entries: [
				{ binding: 0, resource: { buffer } },
				{ binding: 1, resource: imported },
				{ binding: 2, resource: dstView }
			]
		});
		const pass = encoder.beginComputePass();
		pass.setPipeline(this.sourceNormalizePipeline);
		pass.setBindGroup(0, bindGroup);
		pass.dispatchWorkgroups(wgX, wgY);
		pass.end();

		return dstView;
	}

	/** Stage 4: opacity — multiply alpha by per-layer opacity uniform. */
	private encodeOpacity(
		encoder: GPUCommandEncoder,
		srcView: GPUTextureView,
		transform: TransformParams,
		slot: number,
		wgX: number,
		wgY: number
	): GPUTextureView {
		if (transform.opacity >= 1.0 || !this.opacityView) return srcView;

		// Use dedicated opacity scratch texture to avoid aliasing with storage.c
		const dstView = this.opacityView;

		let buffer = this.opacityBuffers[slot];
		if (!buffer) {
			buffer = this.device.createBuffer({
				size: 4, // single f32
				usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
			});
			this.opacityBuffers[slot] = buffer;
		}
		this.device.queue.writeBuffer(buffer, 0, new Float32Array([transform.opacity]));

		const bindGroup = this.device.createBindGroup({
			layout: this.opacityGroupLayout,
			entries: [
				{ binding: 0, resource: { buffer } },
				{ binding: 1, resource: srcView },
				{ binding: 2, resource: dstView },
				{ binding: 3, resource: srcView },
				{ binding: 4, resource: this.sampler }
			]
		});
		const pass = encoder.beginComputePass();
		pass.setPipeline(this.opacityPipeline);
		pass.setBindGroup(0, bindGroup);
		pass.dispatchWorkgroups(wgX, wgY);
		pass.end();

		return dstView;
	}

	private ensureSkinBoxUniforms(): void {
		if (!this.skinBoxUniformH) {
			this.skinBoxUniformH = this.device.createBuffer({
				size: 16,
				usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
			});
			this.skinBoxUniformV = this.device.createBuffer({
				size: 16,
				usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
			});
			this.skinBoxUniformHeight = null;
		}
		if (this.skinBoxUniformHeight === this.height) return;
		const radius = radiusForHeight(this.height);
		this.device.queue.writeBuffer(this.skinBoxUniformH, 0, packSkinBoxUniform(radius, true));
		this.device.queue.writeBuffer(this.skinBoxUniformV!, 0, packSkinBoxUniform(radius, false));
		this.skinBoxUniformHeight = this.height;
	}

	/** Phase 32a: skin-smoothing — 7-pass guided filter on luma, gated by chroma mask. */
	private encodeSkinSmooth(
		encoder: GPUCommandEncoder,
		srcView: GPUTextureView,
		dstView: GPUTextureView,
		strength: number,
		mask: SkinMaskSnapshot | undefined,
		slot: number,
		wgX: number,
		wgY: number
	): void {
		// Lazily allocate scratch textures
		if (!this.skinScratch0) {
			const usage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING;
			const size = { width: this.width, height: this.height };
			this.skinScratch0 = this.device.createTexture({ size, format: 'rg32float', usage });
			this.skinScratch1 = this.device.createTexture({ size, format: 'rg32float', usage });
			this.skinScratch0View = this.skinScratch0.createView();
			this.skinScratch1View = this.skinScratch1.createView();
		}

		const s0 = this.skinScratch0View!;
		const s1 = this.skinScratch1View!;
		this.ensureSkinBoxUniforms();

		// Pass 1: prepare — compute (Y, Y²) from source
		{
			const bg = this.device.createBindGroup({
				layout: this.skinSmoothGroupLayout,
				entries: [
					{ binding: 0, resource: srcView },
					{ binding: 1, resource: s0 }
				]
			});
			const pass = encoder.beginComputePass();
			pass.setPipeline(this.skinSmoothPreparePipeline);
			pass.setBindGroup(0, bg);
			pass.dispatchWorkgroups(wgX, wgY);
			pass.end();
		}

		// Pass 2: box-H on (Y, Y²)
		{
			const bg = this.device.createBindGroup({
				layout: this.skinSmoothBoxGroupLayout,
				entries: [
					{ binding: 0, resource: { buffer: this.skinBoxUniformH! } },
					{ binding: 1, resource: s0 },
					{ binding: 2, resource: s1 }
				]
			});
			const pass = encoder.beginComputePass();
			pass.setPipeline(this.skinSmoothBoxPipeline);
			pass.setBindGroup(0, bg);
			pass.dispatchWorkgroups(wgX, wgY);
			pass.end();
		}

		// Pass 3: box-V on (Y, Y²) → (meanY, meanY²)
		{
			const bg = this.device.createBindGroup({
				layout: this.skinSmoothBoxGroupLayout,
				entries: [
					{ binding: 0, resource: { buffer: this.skinBoxUniformV! } },
					{ binding: 1, resource: s1 },
					{ binding: 2, resource: s0 }
				]
			});
			const pass = encoder.beginComputePass();
			pass.setPipeline(this.skinSmoothBoxPipeline);
			pass.setBindGroup(0, bg);
			pass.dispatchWorkgroups(wgX, wgY);
			pass.end();
		}

		// Pass 4: coefficients — compute (a, b) from moments
		{
			const bg = this.device.createBindGroup({
				layout: this.skinSmoothCoeffsGroupLayout,
				entries: [
					{ binding: 0, resource: s0 },
					{ binding: 1, resource: s1 }
				]
			});
			const pass = encoder.beginComputePass();
			pass.setPipeline(this.skinSmoothCoeffsPipeline);
			pass.setBindGroup(0, bg);
			pass.dispatchWorkgroups(wgX, wgY);
			pass.end();
		}

		// Pass 5: box-H on (a, b)
		{
			const bg = this.device.createBindGroup({
				layout: this.skinSmoothBoxGroupLayout,
				entries: [
					{ binding: 0, resource: { buffer: this.skinBoxUniformH! } },
					{ binding: 1, resource: s1 },
					{ binding: 2, resource: s0 }
				]
			});
			const pass = encoder.beginComputePass();
			pass.setPipeline(this.skinSmoothBoxPipeline);
			pass.setBindGroup(0, bg);
			pass.dispatchWorkgroups(wgX, wgY);
			pass.end();
		}

		// Pass 6: box-V on (a, b) → (meanA, meanB)
		{
			const bg = this.device.createBindGroup({
				layout: this.skinSmoothBoxGroupLayout,
				entries: [
					{ binding: 0, resource: { buffer: this.skinBoxUniformV! } },
					{ binding: 1, resource: s0 },
					{ binding: 2, resource: s1 }
				]
			});
			const pass = encoder.beginComputePass();
			pass.setPipeline(this.skinSmoothBoxPipeline);
			pass.setBindGroup(0, bg);
			pass.dispatchWorkgroups(wgX, wgY);
			pass.end();
		}

		// Per-layer apply uniform
		let applyBuffer = this.skinApplyUniforms[slot];
		if (!applyBuffer) {
			applyBuffer = this.device.createBuffer({
				size: 32,
				usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
			});
			this.skinApplyUniforms[slot] = applyBuffer;
		}
		this.device.queue.writeBuffer(applyBuffer, 0, packSkinApplyUniform(strength, mask));

		// Pass 7: apply — compose with mask and strength
		{
			// Destination is one of the chain's rgba8unorm ping-pong storage textures.
			const bg = this.device.createBindGroup({
				layout: this.skinSmoothApplyGroupLayout,
				entries: [
					{ binding: 0, resource: { buffer: applyBuffer } },
					{ binding: 1, resource: srcView },
					{ binding: 2, resource: s1 },
					{ binding: 3, resource: dstView }
				]
			});
			const pass = encoder.beginComputePass();
			pass.setPipeline(this.skinSmoothApplyPipeline);
			pass.setBindGroup(0, bg);
			pass.dispatchWorkgroups(wgX, wgY);
			pass.end();
		}
	}

	/**
	 * Stage 4b: matte pass. remove/replace multiply layer alpha by the matte
	 * (replace's background source is a UI composition recipe beneath the
	 * layer); blur defocuses the background where the matte is low. Rides the
	 * same per-frame encoder — no extra submission.
	 */
	private encodeMatte(
		encoder: GPUCommandEncoder,
		srcView: GPUTextureView,
		matteTexView: GPUTextureView,
		params: {
			strength: number;
			mode: 'remove' | 'replace' | 'blur';
			blurRadius: number;
			refine: boolean;
		},
		dstView: GPUTextureView,
		slot: number,
		wgX: number,
		wgY: number
	): GPUTextureView {
		let buffer = this.matteBuffers[slot];
		if (!buffer) {
			buffer = this.device.createBuffer({
				size: 8, // {strength: f32, refine: u32} | {strength: f32, radius: f32}
				usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
			});
			this.matteBuffers[slot] = buffer;
		}
		const isBlur = params.mode === 'blur';
		const uniform = new ArrayBuffer(8);
		new Float32Array(uniform, 0, 1)[0] = params.strength;
		if (isBlur) {
			new Float32Array(uniform, 4, 1)[0] = params.blurRadius;
		} else {
			new Uint32Array(uniform, 4, 1)[0] = params.refine ? 1 : 0;
		}
		this.device.queue.writeBuffer(buffer, 0, uniform);

		const bindGroup = this.device.createBindGroup({
			layout: isBlur ? this.matteBlurGroupLayout : this.matteGroupLayout,
			entries: [
				{ binding: 0, resource: { buffer } },
				{ binding: 1, resource: srcView },
				{ binding: 2, resource: dstView },
				{ binding: 3, resource: matteTexView },
				{ binding: 4, resource: this.sampler }
			]
		});
		const pass = encoder.beginComputePass();
		pass.setPipeline(isBlur ? this.matteBlurPipeline : this.mattePipeline);
		pass.setBindGroup(0, bindGroup);
		pass.dispatchWorkgroups(wgX, wgY);
		pass.end();

		return dstView;
	}

	private encodeBeautyWarp(
		encoder: GPUCommandEncoder,
		srcView: GPUTextureView,
		dstView: GPUTextureView,
		beauty: BeautyEffectSnapshot,
		landmarks: Float32Array,
		slot: number,
		wgX: number,
		wgY: number
	): void {
		let uniformBuffer = this.beautyUniforms[slot];
		if (!uniformBuffer) {
			uniformBuffer = this.device.createBuffer({
				size: 64,
				usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
			});
			this.beautyUniforms[slot] = uniformBuffer;
		}
		let landmarkBuffer = this.beautyLandmarkBuffers[slot];
		if (!landmarkBuffer) {
			landmarkBuffer = this.device.createBuffer({
				size: LANDMARK_FLOATS * Float32Array.BYTES_PER_ELEMENT,
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
			});
			this.beautyLandmarkBuffers[slot] = landmarkBuffer;
		}

		this.device.queue.writeBuffer(uniformBuffer, 0, packBeautyUniform(beauty));
		this.device.queue.writeBuffer(landmarkBuffer, 0, packLandmarkBuffer(landmarks));

		const bindGroup = this.device.createBindGroup({
			layout: this.beautyWarpGroupLayout,
			entries: [
				{ binding: 0, resource: srcView },
				{ binding: 1, resource: dstView },
				{ binding: 2, resource: { buffer: landmarkBuffer } },
				{ binding: 3, resource: { buffer: uniformBuffer } }
			]
		});
		const pass = encoder.beginComputePass();
		pass.setPipeline(this.beautyWarpPipeline);
		pass.setBindGroup(0, bindGroup);
		pass.dispatchWorkgroups(wgX, wgY);
		pass.end();
	}

	private ensureUniformBuffer(buffers: GPUBuffer[], slot: number, byteLength: number): GPUBuffer {
		let buffer = buffers[slot];
		if (!buffer) {
			buffer = this.device.createBuffer({
				size: byteLength,
				usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
			});
			buffers[slot] = buffer;
		}
		return buffer;
	}

	private encodeSpotlightLayer(
		encoder: GPUCommandEncoder,
		srcView: GPUTextureView,
		dstView: GPUTextureView,
		layer: SpotlightCompositeLayer,
		slot: number,
		wgX: number,
		wgY: number
	): void {
		const buffer = this.ensureUniformBuffer(this.spotlightUniformBuffers, slot, 32);
		this.device.queue.writeBuffer(buffer, 0, packSpotlightUniform(layer));
		const bindGroup = this.device.createBindGroup({
			layout: this.spotlightGroupLayout,
			entries: [
				{ binding: 0, resource: { buffer } },
				{ binding: 1, resource: srcView },
				{ binding: 2, resource: dstView }
			]
		});
		const pass = encoder.beginComputePass();
		pass.setPipeline(this.spotlightPipeline);
		pass.setBindGroup(0, bindGroup);
		pass.dispatchWorkgroups(wgX, wgY);
		pass.end();
	}

	private encodeBlurRegionLayer(
		encoder: GPUCommandEncoder,
		srcView: GPUTextureView,
		tmpView: GPUTextureView,
		dstView: GPUTextureView,
		layer: BlurRegionCompositeLayer,
		slot: number,
		wgX: number,
		wgY: number
	): void {
		const buffer = this.ensureUniformBuffer(this.blurRegionUniformBuffers, slot, 32);
		this.device.queue.writeBuffer(buffer, 0, packBlurRegionUniform(layer));
		{
			const bindGroup = this.device.createBindGroup({
				layout: this.blurRegionHorizontalGroupLayout,
				entries: [
					{ binding: 0, resource: { buffer } },
					{ binding: 1, resource: srcView },
					{ binding: 2, resource: tmpView }
				]
			});
			const pass = encoder.beginComputePass();
			pass.setPipeline(this.blurRegionHorizontalPipeline);
			pass.setBindGroup(0, bindGroup);
			pass.dispatchWorkgroups(wgX, wgY);
			pass.end();
		}
		{
			const bindGroup = this.device.createBindGroup({
				layout: this.blurRegionVerticalGroupLayout,
				entries: [
					{ binding: 0, resource: { buffer } },
					{ binding: 1, resource: srcView },
					{ binding: 3, resource: tmpView },
					{ binding: 4, resource: dstView }
				]
			});
			const pass = encoder.beginComputePass();
			pass.setPipeline(this.blurRegionVerticalPipeline);
			pass.setBindGroup(0, bindGroup);
			pass.dispatchWorkgroups(wgX, wgY);
			pass.end();
		}
	}

	private encodePaddedBackground(
		encoder: GPUCommandEncoder,
		srcView: GPUTextureView,
		dstView: GPUTextureView,
		params: PaddedBackgroundParams,
		slot: number,
		wgX: number,
		wgY: number
	): GPUTextureView {
		const buffer = this.ensureUniformBuffer(this.paddedBackgroundUniformBuffers, slot, 144);
		this.device.queue.writeBuffer(
			buffer,
			0,
			packPaddedBackgroundUniform(params, this.width, this.height)
		);
		const bindGroup = this.device.createBindGroup({
			layout: this.paddedBackgroundGroupLayout,
			entries: [
				{ binding: 0, resource: { buffer } },
				{ binding: 1, resource: srcView },
				{ binding: 2, resource: dstView }
			]
		});
		const pass = encoder.beginComputePass();
		pass.setPipeline(this.paddedBackgroundPipeline);
		pass.setBindGroup(0, bindGroup);
		pass.dispatchWorkgroups(wgX, wgY);
		pass.end();
		return dstView;
	}

	/** Stage 7: output-conversion — working linear → sRGB OETF for display/export. */
	private encodeOutputConvert(
		encoder: GPUCommandEncoder,
		accSrc: GPUTextureView,
		wgX: number,
		wgY: number
	): GPUTextureView {
		if (!this.outConvView) return accSrc;

		// Write output-conversion uniform
		if (!this.outConvUniform) {
			this.outConvUniform = this.device.createBuffer({
				size: 8, // transferOut: u32 + encodeFullRange: u32
				usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
			});
		}
		this.device.queue.writeBuffer(
			this.outConvUniform,
			0,
			new Uint32Array([OutputTransfer.SRGB, 1]) // full range
		);

		const bindGroup = this.device.createBindGroup({
			layout: this.outConvGroupLayout,
			entries: [
				{ binding: 0, resource: { buffer: this.outConvUniform } },
				{ binding: 1, resource: accSrc },
				{ binding: 2, resource: this.outConvView }
			]
		});
		const pass = encoder.beginComputePass();
		pass.setPipeline(this.outputConvertPipeline);
		pass.setBindGroup(0, bindGroup);
		pass.dispatchWorkgroups(wgX, wgY);
		pass.end();

		return this.outConvView;
	}

	/** Phase 13: transform encode with explicit destination view. */
	private encodeTransformDirect(
		encoder: GPUCommandEncoder,
		transform: TransformParams,
		srcView: GPUTextureView,
		srcWidth: number,
		srcHeight: number,
		slot: number,
		wgX: number,
		wgY: number,
		dstView: GPUTextureView,
		uvCropMax?: [number, number]
	): void {
		let buffer = this.transformBuffers[slot];
		if (!buffer) {
			buffer = this.device.createBuffer({
				size: TRANSFORM_UNIFORM_BYTES,
				usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
			});
			this.transformBuffers[slot] = buffer;
		}
		const packed = packTransformUniform(
			transform,
			this.width,
			this.height,
			srcWidth,
			srcHeight,
			uvCropMax
		);
		this.device.queue.writeBuffer(buffer, 0, packed);
		const bindGroup = this.device.createBindGroup({
			layout: this.transformPipeline.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: { buffer } },
				{ binding: 1, resource: srcView },
				{ binding: 2, resource: this.sampler },
				{ binding: 3, resource: dstView }
			]
		});
		const pass = encoder.beginComputePass();
		pass.setPipeline(this.transformPipeline);
		pass.setBindGroup(0, bindGroup);
		pass.dispatchWorkgroups(wgX, wgY);
		pass.end();
	}

	/**
	 * Renders a layer stack through the same compositor as preview, then captures
	 * the compositor-backed canvas as the frame handed to the encoder.
	 */
	async renderLayeredForExport(
		layers: readonly CompositeLayer[],
		timestamp: number,
		duration: number
	): Promise<VideoFrame> {
		this.present(layers);
		await this.device.queue.onSubmittedWorkDone();
		return this.captureCanvasFrame(timestamp, duration);
	}

	/** Emits a GPU-cleared black frame for gaps in the timeline (empty stack). */
	async renderBlackForExport(timestamp: number, duration: number): Promise<VideoFrame> {
		if (this.width <= 0 || this.height <= 0) {
			throw new Error('Export renderer has not been sized.');
		}
		return this.renderLayeredForExport([], timestamp, duration);
	}

	/** Phase 21: encodes the zebra clipping overlay composited on top of the frame. */
	private encodeZebraOverlay(
		encoder: GPUCommandEncoder,
		compositedView: GPUTextureView,
		preClampView: GPUTextureView
	): GPUTextureView {
		if (!this.clippingOverlayPipeline || !this.zebraView) return compositedView;

		const wgX = Math.ceil(this.width / 8);
		const wgY = Math.ceil(this.height / 8);

		// Reusable uniform buffer — avoid per-frame allocation
		if (!this._zebraUniform) {
			this._zebraUniform = this.device.createBuffer({
				size: 12, // width: u32, height: u32, stripePeriod: u32
				usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
			});
		}
		this.device.queue.writeBuffer(
			this._zebraUniform,
			0,
			new Uint32Array([this.width, this.height, 4])
		);

		const bindGroup = this.device.createBindGroup({
			layout: this.clippingOverlayPipeline.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: { buffer: this._zebraUniform } },
				{ binding: 1, resource: compositedView },
				{ binding: 2, resource: preClampView },
				{ binding: 3, resource: this.zebraView }
			]
		});
		const pass = encoder.beginComputePass();
		pass.setPipeline(this.clippingOverlayPipeline);
		pass.setBindGroup(0, bindGroup);
		pass.dispatchWorkgroups(wgX, wgY);
		pass.end();

		return this.zebraView;
	}

	/**
	 * Phase 21: scope dispatch. Inside the single per-frame command encoder,
	 * resets GPU atomic accumulators (histogram bins, waveform/parade min/max,
	 * clip counter, vectorscope hits), dispatches the two scope compute passes
	 * against the pre-output-conversion accumulator, then `copyBufferToBuffer`
	 * the storage into a pooled staging buffer. After `queue.submit` returns
	 * we `mapAsync` the staging buffer and stream the results into the SAB
	 * under per-slot seqlock guards. No extra `queue.submit` and no CPU pixel
	 * readback (the architecture invariant): the only main-side touch is a
	 * GPU→CPU buffer mapping of the integer scope summaries.
	 */
	private dispatchScopes(encoder: GPUCommandEncoder, accView: GPUTextureView): void {
		const sab = this.scopeSab;
		if (!sab) return;
		// SAB must be large enough to hold every slot's header + data at the agreed
		// SCOPE_RES_X. A smaller SAB (test stubs, mis-sized producers) is a no-op
		// rather than a crash so the renderer keeps one queue.submit per frame.
		if (sab.length < scopeTotalBufferFloats(SCOPE_RES_X)) return;
		if (this.width <= 0 || this.height <= 0) return;

		this.ensureScopeResources();

		const staging = this.scopeStagingFree.pop();
		// Pool exhausted → skip this frame's scopes. Old frame's SAB data remains
		// readable; the scope panel updates next frame when a slot frees up.
		if (!staging) return;

		const device = this.device;
		const histBytes = SCOPE_HISTOGRAM_DATA_FLOATS * 4;
		const wfBytes = scopeWaveformDataFloats(SCOPE_RES_X) * 4;
		const paradeBytes = scopeParadeDataFloats(SCOPE_RES_X) * 4;
		const vecBytes = scopeVectorscopeDataFloats() * 4;

		// Reset accumulators BEFORE the dispatch:
		//   histogram + vectorscope + clip use atomicAdd → zero-init via
		//   encoder.clearBuffer (in-encoder; no CPU→GPU upload).
		//   waveform/parade use atomicMin/Max → upload sentinel pattern
		//   (U32_MAX/0 alternating) via writeBuffer because clearBuffer can
		//   only zero.
		encoder.clearBuffer(this.scopeHistogramBuf!, 0, histBytes);
		encoder.clearBuffer(this.scopeVecBuf!, 0, vecBytes);
		encoder.clearBuffer(this.scopeClipBuf!, 0, 4);
		device.queue.writeBuffer(this.scopeWaveformBuf!, 0, this.scopeWaveformInit!);
		device.queue.writeBuffer(this.scopeParadeBuf!, 0, this.scopeParadeInit!);

		// Scope-pass uniforms: input dims (informational) + scopeResX/Y.
		const scopeUni = new Uint32Array([this.width, this.height, SCOPE_RES_X, SCOPE_RES_X]);
		device.queue.writeBuffer(this.scopeUniformBuf!, 0, scopeUni);
		const vecUni = new Uint32Array([this.width, this.height, SCOPE_VECTORSCOPE_SIZE, 0]);
		device.queue.writeBuffer(this.scopeVecUniformBuf!, 0, vecUni);

		const wgX = Math.ceil(this.width / 8);
		const wgY = Math.ceil(this.height / 8);

		// Combined scope pass: histogram + waveform + parade + clip counter.
		{
			const bg = device.createBindGroup({
				layout: this.scopesGroupLayout,
				entries: [
					{ binding: 0, resource: { buffer: this.scopeUniformBuf! } },
					{ binding: 1, resource: accView },
					{ binding: 2, resource: { buffer: this.scopeHistogramBuf! } },
					{ binding: 3, resource: { buffer: this.scopeWaveformBuf! } },
					{ binding: 4, resource: { buffer: this.scopeParadeBuf! } },
					{ binding: 5, resource: { buffer: this.scopeClipBuf! } }
				]
			});
			const pass = encoder.beginComputePass();
			pass.setPipeline(this.scopesPipeline);
			pass.setBindGroup(0, bg);
			pass.dispatchWorkgroups(wgX, wgY);
			pass.end();
		}

		// Vectorscope pass — separate shader because the 2D hits buffer is too
		// large to fold into the combined struct cleanly.
		{
			const bg = device.createBindGroup({
				layout: this.vectorscopeGroupLayout,
				entries: [
					{ binding: 0, resource: { buffer: this.scopeVecUniformBuf! } },
					{ binding: 1, resource: accView },
					{ binding: 2, resource: { buffer: this.scopeVecBuf! } }
				]
			});
			const pass = encoder.beginComputePass();
			pass.setPipeline(this.vectorscopePipeline);
			pass.setBindGroup(0, bg);
			pass.dispatchWorkgroups(wgX, wgY);
			pass.end();
		}

		// Concatenate all atomic buffers into the staging buffer in a fixed layout
		// the mapAsync callback unpacks. Offsets must be 4-byte aligned (u32 sizes
		// satisfy this trivially).
		let off = 0;
		encoder.copyBufferToBuffer(this.scopeHistogramBuf!, 0, staging, off, histBytes);
		off += histBytes;
		encoder.copyBufferToBuffer(this.scopeWaveformBuf!, 0, staging, off, wfBytes);
		off += wfBytes;
		encoder.copyBufferToBuffer(this.scopeParadeBuf!, 0, staging, off, paradeBytes);
		off += paradeBytes;
		encoder.copyBufferToBuffer(this.scopeClipBuf!, 0, staging, off, 4);
		off += 4;
		encoder.copyBufferToBuffer(this.scopeVecBuf!, 0, staging, off, vecBytes);

		// Async readback. mapAsync resolves after the still-pending queue.submit
		// completes, so the staging contents reflect the GPU writes. Capture the
		// SAB reference so a destroy()/SAB-swap mid-flight drops the result
		// instead of writing into a stale view.
		const sabRef = sab;
		void staging
			.mapAsync(GPUMapMode.READ)
			.then(() => {
				try {
					if (this.scopeSab === sabRef) {
						const u32 = new Uint32Array(staging.getMappedRange());
						this.writeScopeFrameToSab(u32);
					}
				} finally {
					try {
						staging.unmap();
					} catch {
						// Buffer destroyed during/after destroy(); pool entry is gone too.
					}
					this.scopeStagingFree.push(staging);
				}
			})
			.catch(() => {
				// Device lost, buffer destroyed, or other mapping failure. Return the
				// buffer to the pool so subsequent frames keep flowing.
				this.scopeStagingFree.push(staging);
			});
	}

	/**
	 * Lazily allocates GPU storage backing each scope binding, plus a small pool
	 * of staging buffers for GPU→CPU readback. Sized once for SCOPE_RES_X; never
	 * resizes (changing preview size doesn't change scope column count).
	 */
	private ensureScopeResources(): void {
		if (this.scopeHistogramBuf) return;

		const device = this.device;
		const storageUsage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;
		const uniformUsage = GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST;

		const histBytes = SCOPE_HISTOGRAM_DATA_FLOATS * 4;
		const wfBytes = scopeWaveformDataFloats(SCOPE_RES_X) * 4;
		const paradeBytes = scopeParadeDataFloats(SCOPE_RES_X) * 4;
		const vecBytes = scopeVectorscopeDataFloats() * 4;

		this.scopeHistogramBuf = device.createBuffer({
			label: 'scope-histogram',
			size: histBytes,
			usage: storageUsage
		});
		this.scopeWaveformBuf = device.createBuffer({
			label: 'scope-waveform',
			size: wfBytes,
			usage: storageUsage
		});
		this.scopeParadeBuf = device.createBuffer({
			label: 'scope-parade',
			size: paradeBytes,
			usage: storageUsage
		});
		this.scopeClipBuf = device.createBuffer({
			label: 'scope-clip',
			size: 4,
			usage: storageUsage
		});
		this.scopeVecBuf = device.createBuffer({
			label: 'scope-vectorscope',
			size: vecBytes,
			usage: storageUsage
		});
		this.scopeUniformBuf = device.createBuffer({
			label: 'scope-uniform',
			size: 16,
			usage: uniformUsage
		});
		this.scopeVecUniformBuf = device.createBuffer({
			label: 'scope-vectorscope-uniform',
			size: 16,
			usage: uniformUsage
		});

		// Sentinel init templates for atomicMin/Max columns — cached so the
		// per-frame writeBuffer is a small upload, not a fresh allocation.
		// (Histogram + vectorscope + clip zero-init via encoder.clearBuffer.)
		const wfInit = new Uint32Array(scopeWaveformDataFloats(SCOPE_RES_X));
		for (let i = 0; i < wfInit.length; i += 2) {
			wfInit[i] = 0xffffffff; // min sentinel
			wfInit[i + 1] = 0; // max sentinel
		}
		this.scopeWaveformInit = wfInit;

		const paradeInit = new Uint32Array(scopeParadeDataFloats(SCOPE_RES_X));
		for (let i = 0; i < paradeInit.length; i += 2) {
			paradeInit[i] = 0xffffffff; // *min sentinel
			paradeInit[i + 1] = 0; // *max sentinel
		}
		this.scopeParadeInit = paradeInit;

		this.scopeStagingTotalBytes = histBytes + wfBytes + paradeBytes + 4 + vecBytes;
		for (let i = 0; i < PreviewRenderer.SCOPE_STAGING_POOL; i++) {
			const buf = device.createBuffer({
				label: `scope-staging-${i}`,
				size: this.scopeStagingTotalBytes,
				usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
			});
			this.scopeStagingFree.push(buf);
			this.scopeStagingBuffers.push(buf);
		}
	}

	/**
	 * Unpacks a mapped staging buffer (laid out histogram → waveform → parade →
	 * clip → vectorscope, all `u32`) into the four scope slots in the SAB. Each
	 * slot is published under its own seqlock so a concurrent main-thread reader
	 * either sees a fully-written frame or retries cleanly.
	 */
	private writeScopeFrameToSab(u32: Uint32Array): void {
		const sab = this.scopeSab;
		if (!sab) return;

		const X = SCOPE_RES_X;
		const histLen = SCOPE_HISTOGRAM_DATA_FLOATS;
		const wfLen = scopeWaveformDataFloats(X);
		const paradeLen = scopeParadeDataFloats(X);
		const vecLen = scopeVectorscopeDataFloats();

		let off = 0;
		const hist = u32.subarray(off, off + histLen);
		off += histLen;
		const wf = u32.subarray(off, off + wfLen);
		off += wfLen;
		const parade = u32.subarray(off, off + paradeLen);
		off += paradeLen;
		const clipCount = u32[off]!;
		off += 1;
		const vec = u32.subarray(off, off + vecLen);

		// Histogram: raw u32 bin counts → f32. TypedArray.set() does the u32→f32
		// element conversion in native code.
		{
			const slot = histogramSlotOffset();
			beginScopeWrite(sab, slot);
			writeScopeHeader(sab, slot, 0, clipCount);
			sab.set(hist, slot + 3);
			endScopeWrite(sab, slot);
		}

		// Waveform: alternating (min, max) per column. Quantized to 16-bit; dequant
		// to 0..1 floats. Untouched columns (min sentinel still U32_MAX) become 0.
		{
			const slot = waveformSlotOffset(X);
			beginScopeWrite(sab, slot);
			writeScopeHeader(sab, slot, 0, clipCount);
			const dataStart = slot + 3;
			for (let i = 0; i < wfLen; i++) {
				const v = wf[i]!;
				sab[dataStart + i] = v === 0xffffffff ? 0 : v / 65535;
			}
			endScopeWrite(sab, slot);
		}

		// Parade: 6 alternating min/max columns (R,G,B). Same dequant as waveform.
		{
			const slot = paradeSlotOffset(X);
			beginScopeWrite(sab, slot);
			writeScopeHeader(sab, slot, 0, clipCount);
			const dataStart = slot + 3;
			for (let i = 0; i < paradeLen; i++) {
				const v = parade[i]!;
				sab[dataStart + i] = v === 0xffffffff ? 0 : v / 65535;
			}
			endScopeWrite(sab, slot);
		}

		// Vectorscope: 128×128 hit counts → f32. Native u32→f32 conversion via set().
		{
			const slot = vectorscopeSlotOffset(X);
			beginScopeWrite(sab, slot);
			writeScopeHeader(sab, slot, 0, clipCount);
			sab.set(vec, slot + 3);
			endScopeWrite(sab, slot);
		}
	}

	destroy(): void {
		this.effectChain.destroy();
		this.destroyTextures();
		for (const buffer of this.transformBuffers) buffer.destroy();
		this.transformBuffers.length = 0;
		for (const buffer of this.normalizeBuffers) buffer.destroy();
		this.normalizeBuffers.length = 0;
		// Slot arrays are sparse (a slot is only filled when that layer needed
		// the pass), so skip holes to avoid destroying undefined.
		for (const buffer of this.opacityBuffers) buffer?.destroy();
		this.opacityBuffers.length = 0;
		for (const buffer of this.matteBuffers) buffer?.destroy();
		this.matteBuffers.length = 0;
		for (const buffer of this.spotlightUniformBuffers) buffer?.destroy();
		this.spotlightUniformBuffers.length = 0;
		for (const buffer of this.blurRegionUniformBuffers) buffer?.destroy();
		this.blurRegionUniformBuffers.length = 0;
		for (const buffer of this.paddedBackgroundUniformBuffers) buffer?.destroy();
		this.paddedBackgroundUniformBuffers.length = 0;
		for (const buffer of this.transitionUniformBuffers) buffer?.destroy();
		this.transitionUniformBuffers.length = 0;
		this.outConvUniform?.destroy();
		this.outConvUniform = null;
		this.skinBoxUniformH?.destroy();
		this.skinBoxUniformH = null;
		this.skinBoxUniformV?.destroy();
		this.skinBoxUniformV = null;
		this.skinBoxUniformHeight = null;
		for (const buffer of this.skinApplyUniforms) buffer.destroy();
		this.skinApplyUniforms.length = 0;
		for (const buffer of this.beautyUniforms) buffer.destroy();
		this.beautyUniforms.length = 0;
		for (const buffer of this.beautyLandmarkBuffers) buffer.destroy();
		this.beautyLandmarkBuffers.length = 0;
		this.presentBindGroup = null;
		this.lastPresentView = null;
		this.scopeSab = null;
		this.scopeHistogramBuf?.destroy();
		this.scopeHistogramBuf = null;
		this.scopeWaveformBuf?.destroy();
		this.scopeWaveformBuf = null;
		this.scopeParadeBuf?.destroy();
		this.scopeParadeBuf = null;
		this.scopeClipBuf?.destroy();
		this.scopeClipBuf = null;
		this.scopeVecBuf?.destroy();
		this.scopeVecBuf = null;
		this.scopeUniformBuf?.destroy();
		this.scopeUniformBuf = null;
		this.scopeVecUniformBuf?.destroy();
		this.scopeVecUniformBuf = null;
		// Destroy via the master list so in-flight buffers (popped from `free`
		// but mid-mapAsync) are released too — not just whatever happens to be
		// idle in `scopeStagingFree` at teardown time.
		for (const buf of this.scopeStagingBuffers) buf.destroy();
		this.scopeStagingBuffers.length = 0;
		this.scopeStagingFree.length = 0;
		this.device.destroy();
	}

	private destroyTextures(): void {
		this.storageA?.destroy();
		this.storageB?.destroy();
		this.storageC?.destroy();
		this.transformTex?.destroy();
		this.transformTexB?.destroy();
		this.outConvTex?.destroy();
		this.opacityTex?.destroy();
		this.zebraTex?.destroy();
		this.accTex?.[0]?.destroy();
		this.accTex?.[1]?.destroy();
		this.skinScratch0?.destroy();
		this.skinScratch1?.destroy();
		this.storageA = null;
		this.storageB = null;
		this.storageC = null;
		this.transformTex = null;
		this.transformTexB = null;
		this.outConvTex = null;
		this.outConvView = null;
		this.opacityTex = null;
		this.opacityView = null;
		this.zebraTex = null;
		this.zebraView = null;
		this._zebraUniform?.destroy();
		this._zebraUniform = null;
		this.accTex = null;
		this.storageAView = null;
		this.storageBView = null;
		this.storageCView = null;
		this.transformView = null;
		this.transformViewB = null;
		this.accView = null;
		this.skinScratch0 = null;
		this.skinScratch1 = null;
		this.skinScratch0View = null;
		this.skinScratch1View = null;
	}

	private captureCanvasFrame(timestamp: number, duration: number): VideoFrame {
		return new VideoFrame(this.canvas, {
			timestamp: Math.round(timestamp * 1_000_000),
			duration: Math.max(1, Math.round(duration * 1_000_000))
		});
	}
}

type AdapterOptionsWithFeatureLevel = GPURequestAdapterOptions & {
	featureLevel?: 'core' | 'compatibility';
};

async function initGpuWithOptions(
	canvas: OffscreenCanvas,
	adapterOptions: AdapterOptionsWithFeatureLevel,
	options: { optionalFeatures: boolean; unavailableLabel: string }
): Promise<GpuInit> {
	if (!navigator.gpu) {
		return unavailable(
			'This browser does not expose the WebGPU API. Use a recent Chromium-based desktop browser (Chrome/Edge 113+).'
		);
	}

	const adapter = await navigator.gpu.requestAdapter(adapterOptions);
	if (!adapter) {
		return unavailable(
			`No ${options.unavailableLabel} adapter was found. Enable hardware acceleration and update your GPU drivers, then reload.`
		);
	}

	const wantedFeatures: GPUFeatureName[] = [];
	const useF16 = options.optionalFeatures && adapter.features.has('shader-f16');
	const hasSubgroups = adapter.features.has('subgroups');
	const hasTimestampQuery = adapter.features.has('timestamp-query');
	if (useF16) wantedFeatures.push('shader-f16');
	if (options.optionalFeatures && hasSubgroups) wantedFeatures.push('subgroups');
	if (options.optionalFeatures && hasTimestampQuery) wantedFeatures.push('timestamp-query');

	let device: GPUDevice;
	try {
		device = await adapter.requestDevice({ requiredFeatures: wantedFeatures });
	} catch (e) {
		const detail = e instanceof Error ? e.message : String(e);
		return unavailable(`WebGPU device request failed: ${detail}`);
	}

	const context = canvas.getContext('webgpu') as GPUCanvasContext | null;
	if (!context) {
		device.destroy();
		return unavailable('Could not acquire a WebGPU context for the preview canvas.');
	}

	const format = navigator.gpu.getPreferredCanvasFormat();
	context.configure({
		device,
		format,
		alphaMode: 'premultiplied'
	});

	const limits: Record<string, number> = {};
	for (const key of DIAGNOSTIC_LIMIT_KEYS) {
		const val = (device.limits as unknown as Record<string, unknown>)[key];
		if (typeof val === 'number') limits[key] = val;
	}

	const deviceLost = device.lost.then((info) => ({
		reason: info.reason,
		message: info.message
	}));

	return {
		renderer: new PreviewRenderer(device, context, format, canvas, useF16),
		features: [...wantedFeatures],
		unavailableReason: null,
		limits,
		deviceLost
	};
}

export async function initGpu(canvas: OffscreenCanvas): Promise<GpuInit> {
	return initGpuWithOptions(
		canvas,
		{ powerPreference: 'high-performance' },
		{ optionalFeatures: true, unavailableLabel: 'WebGPU' }
	);
}

export async function initCompatibilityGpu(canvas: OffscreenCanvas): Promise<GpuInit> {
	return initGpuWithOptions(
		canvas,
		{ powerPreference: 'low-power', featureLevel: 'compatibility' },
		{ optionalFeatures: false, unavailableLabel: 'WebGPU compatibility' }
	);
}

export { DEFAULT_TRANSFORM };
