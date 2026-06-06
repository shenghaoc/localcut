// Scopes compute shader — Phase 21.
//
// Combined compute pass that produces histogram bins, luma waveform min/max,
// RGB parade min/max, and vectorscope hit counts from the composited frame.
// Clipping counter is accumulated alongside the histogram.

struct Uniforms {
  inputWidth: u32,
  inputHeight: u32,
  scopeResX: u32,   // reduced horizontal resolution for waveform/parade
  scopeResY: u32,
  vecSize: u32,      // vectorscope output size (e.g. 128)
}

// Output buffers
struct HistogramBin {
  counts: array<atomic<u32>, 1024>,  // 4 channels × 256 bins
}

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var<storage, read_write> histogram: HistogramBin;
@group(0) @binding(3) var<storage, read_write> waveform: array<atomic<u32>>;   // 2 × scopeResX: even=min accumulator, odd=max
@group(0) @binding(4) var<storage, read_write> parade: array<atomic<u32>>;     // 6 × scopeResX: Rmin,Rmax,Gmin,Gmax,Bmin,Bmax
@group(0) @binding(5) var vecTex: texture_storage_2d<rgba32uint, read_write>;
@group(0) @binding(6) var<storage, read_write> clipCounter: atomic<u32>;

fn rgbToLuma(rgb: vec3<f32>) -> f32 {
  return 0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b;
}

fn rgbToCbCr(rgb: vec3<f32>) -> vec2<f32> {
  // BT.709 Y'CbCr coefficients
  let y = rgbToLuma(rgb);
  let cb = (rgb.b - y) / 1.8556 + 0.5;
  let cr = (rgb.r - y) / 1.5748 + 0.5;
  return vec2(cb, cr);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let dims = textureDimensions(src);

  // Clamp to input resolution
  if (gid.x >= dims.x || gid.y >= dims.y) { return; }

  let coord = vec2<u32>(gid.x, gid.y);
  let color = textureLoad(src, coord, 0);

  // ── Clipping detection ──
  if (color.r < 0.0 || color.r > 1.0 || color.g < 0.0 || color.g > 1.0 || color.b < 0.0 || color.b > 1.0) {
    atomicAdd(&clipCounter, 1u);
  }

  // ── Histogram accumulation (scaled to 0..255 bins) ──
  let rBin = u32(clamp(color.r, 0.0, 0.9999) * 256.0);
  let gBin = u32(clamp(color.g, 0.0, 0.9999) * 256.0);
  let bBin = u32(clamp(color.b, 0.0, 0.9999) * 256.0);
  let y = rgbToLuma(color.rgb);
  let yBin = u32(clamp(y, 0.0, 0.9999) * 256.0);

  atomicAdd(&histogram.counts[rBin], 1u);           // R: 0..255
  atomicAdd(&histogram.counts[256u + gBin], 1u);    // G: 256..511
  atomicAdd(&histogram.counts[512u + bBin], 1u);    // B: 512..767
  atomicAdd(&histogram.counts[768u + yBin], 1u);    // Y: 768..1023

  // ── Waveform accumulation (luma per column) ──
  let wfCol = u32(f32(gid.x) / f32(dims.x) * f32(u.scopeResX));
  let wfColClamped = min(wfCol, u.scopeResX - 1u);
  let lumaQ = u32(y * 65535.0);  // quantized luma for min/max tracking

  // Min: store as ~luma (lower is darker); we use atomicMin on the quantized value
  atomicMin(&waveform[wfColClamped * 2u], lumaQ);
  // Max: store as ~luma
  atomicMax(&waveform[wfColClamped * 2u + 1u], lumaQ);

  // ── RGB Parade accumulation ──
  let pCol = wfColClamped;
  let rQ = u32(color.r * 65535.0);
  let gQ = u32(color.g * 65535.0);
  let bQ = u32(color.b * 65535.0);

  atomicMin(&parade[pCol * 6u + 0u], rQ);  // R min
  atomicMax(&parade[pCol * 6u + 1u], rQ);  // R max
  atomicMin(&parade[pCol * 6u + 2u], gQ);  // G min
  atomicMax(&parade[pCol * 6u + 3u], gQ);  // G max
  atomicMin(&parade[pCol * 6u + 4u], bQ);  // B min
  atomicMax(&parade[pCol * 6u + 5u], bQ);  // B max

  // ── Vectorscope accumulation ──
  let cbcr = rgbToCbCr(color.rgb);
  let vecX = u32(clamp(cbcr.x, 0.0, 0.9999) * f32(u.vecSize));
  let vecY = u32(clamp(cbcr.y, 0.0, 0.9999) * f32(u.vecSize));
  // Atomic add on storage texture
  let old = textureLoad(vecTex, vec2(vecX, vecY), 0);
  textureStore(vecTex, vec2(vecX, vecY), old + vec4(1u, 0u, 0u, 0u));
}
