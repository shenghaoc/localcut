/**
 * VRAM-bound tiling for frame interpolation (Phase 37, R4). Pure, GPU-free
 * functions that plan overlapping tiles for synthesis, compute halo/overlap,
 * verify stitch coverage, and estimate peak GPU working-set bytes.
 *
 * All functions operate on plain numbers and are fully unit-testable without
 * an actual GPU device (R4.3).
 */

/** VRAM budget derived from WebGPU probe limits × safety factor. */
export interface VramBudget {
	/** Usable VRAM in bytes for the interpolation working set. */
	maxBytes: number;
	/** Safety factor applied to the raw probe limit (e.g. 0.75). */
	safety: number;
}

/** Model I/O contract relevant to tiling. */
export interface ModelIoContract {
	/** Model input width in pixels. */
	inputWidth: number;
	/** Model input height in pixels. */
	inputHeight: number;
	/** Number of channels per input (typically 3 for RGB). */
	inputChannels: number;
	/** Bytes per channel element (2 for FP16, 4 for FP32). */
	bytesPerElement: number;
	/** Whether the model outputs a flow field (adds output memory). */
	flowOutput: boolean;
	/** Maximum pixel displacement the model handles (determines halo size). */
	maxDisplacement: number;
}

/** A single tile with its position and halo. */
export interface Tile {
	/** X offset in the full frame. */
	x: number;
	/** Y offset in the full frame. */
	y: number;
	/** Tile width (excluding halo). */
	w: number;
	/** Tile height (excluding halo). */
	h: number;
	/** Halo/overlap on each side in pixels. */
	halo: number;
}

/** Result of tile planning. */
export interface TilePlan {
	/** The tiles covering the frame. */
	tiles: readonly Tile[];
	/** Estimated peak GPU working set in bytes. */
	workingSetBytes: number;
	/** Width of each model-input tile (tile + 2×halo). */
	modelInputWidth: number;
	/** Height of each model-input tile (tile + 2×halo). */
	modelInputHeight: number;
}

/** Refusal when even a minimum tile won't fit. */
export interface TileRefuse {
	refuse: string;
}

/** Minimum tile dimension in pixels (must be at least model input size). */
const MIN_TILE_DIM = 64;

/**
 * Plan overlapping tiles for frame synthesis.
 *
 * For inputs ≥1080p (or when the working set exceeds the VRAM budget),
 * splits the frame into overlapping tiles. Halo/overlap is sized to the
 * model's max displacement so edge flow has context. Tiles are stitched
 * seam-free by dropping halos.
 *
 * Returns a TilePlan on success or a TileRefuse if even a minimum tile
 * cannot fit the budget (R4.4).
 */
export function planTiles(
	width: number,
	height: number,
	model: ModelIoContract,
	budget: VramBudget
): TilePlan | TileRefuse {
	const halo = model.maxDisplacement;
	const modelInputW = model.inputWidth;
	const modelInputH = model.inputHeight;

	// Effective tile size (excluding halo) = model input minus 2×halo
	const tileW = Math.max(MIN_TILE_DIM, modelInputW - 2 * halo);
	const tileH = Math.max(MIN_TILE_DIM, modelInputH - 2 * halo);

	// Estimate working set for a single tile
	const singleTileBytes = estimateWorkingSetBytes(modelInputW, modelInputH, model);

	// If a single tile exceeds budget, refuse
	const usableBytes = budget.maxBytes * budget.safety;
	if (singleTileBytes > usableBytes) {
		return {
			refuse: `A single ${modelInputW}×${modelInputH} tile requires ${formatBytes(singleTileBytes)} but only ${formatBytes(usableBytes)} VRAM is available (with ${budget.safety} safety factor). Try a lower resolution export or a proxy.`
		};
	}

	// If the frame fits in one tile, return a single tile
	if (width <= modelInputW && height <= modelInputH) {
		return {
			tiles: [{ x: 0, y: 0, w: width, h: height, halo: 0 }],
			workingSetBytes: singleTileBytes,
			modelInputWidth: modelInputW,
			modelInputHeight: modelInputH
		};
	}

	// Compute how many tiles fit in the budget
	const maxTilesInBudget = Math.max(1, Math.floor(usableBytes / singleTileBytes));

	// Compute tile grid needed to cover the frame
	const tilesX = Math.ceil(width / tileW);
	const tilesY = Math.ceil(height / tileH);
	const totalTiles = tilesX * tilesY;

	// If we can't fit enough tiles, try to reduce tile count by using fewer,
	// larger tiles (up to what the budget allows)
	const tilesToUse = Math.min(totalTiles, maxTilesInBudget);

	if (tilesToUse < 1) {
		return {
			refuse: `Cannot fit any tiles in the VRAM budget (${formatBytes(usableBytes)}). Try a lower resolution export.`
		};
	}

	// Generate tile positions
	// When we need more tiles than fit in budget, we must process in passes
	// For now, plan all needed tiles and let the caller handle multi-pass
	const tiles: Tile[] = [];
	const stepX = tileW;
	const stepY = tileH;

	for (let ty = 0; ty < tilesY; ty++) {
		for (let tx = 0; tx < tilesX; tx++) {
			const x = tx * stepX;
			const y = ty * stepY;
			// Tile size: full tile width except at edges
			const w = Math.min(tileW, width - x);
			const h = Math.min(tileH, height - y);
			tiles.push({ x, y, w, h, halo });
		}
	}

	// Working set: at most tilesToUse tiles in memory at once
	const peakTiles = Math.min(tiles.length, tilesToUse);
	const workingSetBytes = peakTiles * singleTileBytes;

	return {
		tiles,
		workingSetBytes,
		modelInputWidth: modelInputW,
		modelInputHeight: modelInputH
	};
}

/**
 * Estimate peak GPU working-set bytes for one model-input tile.
 *
 * Includes: 2 input textures (F0, F1) + 2 preprocessed tensors + flow output
 * (if model produces it) + output RGBA texture. All at the model input
 * resolution.
 */
export function estimateWorkingSetBytes(
	modelInputW: number,
	modelInputH: number,
	model: ModelIoContract
): number {
	const pixels = modelInputW * modelInputH;
	const inputBytes = pixels * model.inputChannels * model.bytesPerElement;
	// 2 input textures (F0, F1)
	const inputTextures = 2 * inputBytes;
	// 2 preprocessed tensors (img0, img1 normalized)
	const preprocessedTensors = 2 * inputBytes;
	// Flow output (if model produces it, typically 2 channels: dx, dy)
	const flowBytes = model.flowOutput ? pixels * 2 * model.bytesPerElement : 0;
	// Output RGBA texture (4 channels, FP16 or RGBA8)
	const outputBytes = pixels * 4 * model.bytesPerElement;
	// Halo overlap copies (conservative: 2× halo perimeter per tile edge)
	const haloBytes = 0; // halos are part of the tile, not separate allocations

	return inputTextures + preprocessedTensors + flowBytes + outputBytes + haloBytes;
}

/**
 * Compute the stitch region for a tile (the area to keep after dropping halos).
 * Returns the rectangle in full-frame coordinates that this tile contributes.
 */
export function stitchRegion(
	tile: Tile,
	frameWidth: number,
	frameHeight: number
): { x: number; y: number; w: number; h: number } {
	// The tile covers [tile.x - halo, tile.x + tile.w + halo) in the frame,
	// but we only keep [tile.x, tile.x + tile.w) (the non-halo part).
	// Clamp to frame bounds.
	const x = Math.max(0, tile.x);
	const y = Math.max(0, tile.y);
	const x2 = Math.min(frameWidth, tile.x + tile.w);
	const y2 = Math.min(frameHeight, tile.y + tile.h);
	return { x, y, w: x2 - x, h: y2 - y };
}

/**
 * Verify that the stitch regions of all tiles fully cover the frame.
 * Pure, unit-testable.
 *
 * **Note:** Allocates a `Uint8Array(width * height)` bitmap. For 4K (8.3M pixels)
 * this is ~8.3MB; for 8K (33M pixels) it's ~33MB. Called in the worker at plan time.
 * If this becomes a memory concern at extreme resolutions, switch to geometric
 * tile-overlap verification (O(n-tiles) instead of O(width*height)).
 */
export function verifyStitchCoverage(
	tiles: readonly Tile[],
	frameWidth: number,
	frameHeight: number
): { complete: boolean; uncoveredPixels: number } {
	// Create a bitmap to track coverage
	const covered = new Uint8Array(frameWidth * frameHeight);

	for (const tile of tiles) {
		const region = stitchRegion(tile, frameWidth, frameHeight);
		for (let y = region.y; y < region.y + region.h; y++) {
			for (let x = region.x; x < region.x + region.w; x++) {
				covered[y * frameWidth + x] = 1;
			}
		}
	}

	let uncovered = 0;
	for (let i = 0; i < covered.length; i++) {
		if (covered[i] === 0) uncovered++;
	}

	return { complete: uncovered === 0, uncoveredPixels: uncovered };
}

function formatBytes(bytes: number): string {
	if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${bytes} B`;
}
