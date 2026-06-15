// Phase 31 matte preprocess pass (zero-copy inference input).
// Samples the decoded VideoFrame (external texture) at model input resolution
// and writes a normalized NHWC float32 tensor into a storage buffer that the
// LiteRT WebGPU model consumes directly as a GPU-buffer Tensor.
//
// TFLite/LiteRT models are NHWC ([1, H, W, 3]). The input range differs per
// model, so normalization is parameterized as `rgb * normScale + normBias`:
//   MODNet, [-1, 1]:                 normScale = 2,  normBias = -1  (== (x-0.5)/0.5)
//   MediaPipe Selfie, [0, 1]:        normScale = 1,  normBias =  0
// The engine derives these from the manifest's `inputRange` field.

struct Uniforms {
  modelWidth: u32,
  modelHeight: u32,
  normScale: f32,
  normBias: f32,
}

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var srcFrame: texture_external;
@group(0) @binding(2) var<storage, read_write> tensorOut: array<f32>;
@group(0) @binding(3) var frameSampler: sampler;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= u.modelWidth || gid.y >= u.modelHeight) { return; }

  // textureSampleBaseClampToEdge handles arbitrary source resolution (the
  // P19 proxy feed in preview, full resolution in export) with bilinear
  // filtering — no CPU resize anywhere.
  let uv = (vec2<f32>(f32(gid.x), f32(gid.y)) + 0.5)
    / vec2<f32>(f32(u.modelWidth), f32(u.modelHeight));
  let rgb = textureSampleBaseClampToEdge(srcFrame, frameSampler, uv).rgb;

  // NHWC: 3 interleaved channels per pixel.
  let base = (gid.y * u.modelWidth + gid.x) * 3u;
  tensorOut[base] = rgb.r * u.normScale + u.normBias;
  tensorOut[base + 1u] = rgb.g * u.normScale + u.normBias;
  tensorOut[base + 2u] = rgb.b * u.normScale + u.normBias;
}
