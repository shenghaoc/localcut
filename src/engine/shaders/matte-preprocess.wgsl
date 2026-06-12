// Phase 31 matte preprocess pass (zero-copy inference input).
// Samples the decoded VideoFrame (external texture) at model input resolution
// and writes a normalized NCHW float32 tensor into a storage buffer that the
// onnxruntime-web WebGPU session consumes directly via Tensor.fromGpuBuffer.
// MODNet normalization: (x - 0.5) / 0.5  →  [-1, 1].

struct Uniforms {
  modelWidth: u32,
  modelHeight: u32,
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

  let planeSize = u.modelWidth * u.modelHeight;
  let pixel = gid.y * u.modelWidth + gid.x;
  tensorOut[pixel] = (rgb.r - 0.5) / 0.5;
  tensorOut[planeSize + pixel] = (rgb.g - 0.5) / 0.5;
  tensorOut[2u * planeSize + pixel] = (rgb.b - 0.5) / 0.5;
}
