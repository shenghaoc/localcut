// Phase 31 ORT/ONNX matte preprocess pass (zero-copy inference input).
// Samples the decoded VideoFrame (external texture) at model input resolution and
// writes a normalized float32 tensor into a storage buffer that ORT consumes
// directly as a GPU-buffer Tensor (`ort.Tensor.fromGpuBuffer`) — no CPU upload.
//
// Unlike the LiteRT preprocess (NHWC-only), ONNX matting models are commonly
// NCHW ([1, 3, H, W], PyTorch/MODNet convention), so the output layout is
// selectable. Normalization is parameterized as `rgb * normScale + normBias`,
// derived from the manifest `io.inputRange`:
//   signed-unit, [-1, 1]:  normScale = 2,  normBias = -1   (== (x - 0.5) / 0.5)
//   unit,        [0, 1]:   normScale = 1,  normBias =  0

struct Uniforms {
  modelWidth: u32,
  modelHeight: u32,
  // 0 = NCHW (planar [1,3,H,W]); 1 = NHWC (interleaved [1,H,W,3]).
  layout: u32,
  _pad: u32,
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

  // textureSampleBaseClampToEdge handles arbitrary source resolution (the P19
  // proxy feed in preview, full resolution in export) with bilinear filtering —
  // no CPU resize anywhere.
  let uv = (vec2<f32>(f32(gid.x), f32(gid.y)) + 0.5)
    / vec2<f32>(f32(u.modelWidth), f32(u.modelHeight));
  let rgb = textureSampleBaseClampToEdge(srcFrame, frameSampler, uv).rgb;
  let n = rgb * u.normScale + u.normBias;

  let pixel = gid.y * u.modelWidth + gid.x;
  if (u.layout == 0u) {
    // NCHW: three contiguous channel planes of W*H each.
    let plane = u.modelWidth * u.modelHeight;
    tensorOut[pixel] = n.r;
    tensorOut[plane + pixel] = n.g;
    tensorOut[2u * plane + pixel] = n.b;
  } else {
    // NHWC: 3 interleaved channels per pixel.
    let base = pixel * 3u;
    tensorOut[base] = n.r;
    tensorOut[base + 1u] = n.g;
    tensorOut[base + 2u] = n.b;
  }
}
