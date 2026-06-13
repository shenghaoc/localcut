// Phase 31 matte preprocess pass (zero-copy inference input).
// Samples the decoded VideoFrame (external texture) at model input resolution
// and writes a normalized float32 tensor into a storage buffer consumed directly
// by LiteRT from the shared GPUDevice.
// MODNet normalization: (x - 0.5) / 0.5  →  [-1, 1].

struct Uniforms {
  modelWidth: u32,
  modelHeight: u32,
  // 0 = NCHW, 1 = NHWC.
  inputLayout: u32,
  _pad: u32,
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
  let r = (rgb.r - 0.5) / 0.5;
  let g = (rgb.g - 0.5) / 0.5;
  let b = (rgb.b - 0.5) / 0.5;

  if (u.inputLayout == 1u) {
    let offset = pixel * 3u;
    tensorOut[offset] = r;
    tensorOut[offset + 1u] = g;
    tensorOut[offset + 2u] = b;
  } else {
    tensorOut[pixel] = r;
    tensorOut[planeSize + pixel] = g;
    tensorOut[2u * planeSize + pixel] = b;
  }
}
