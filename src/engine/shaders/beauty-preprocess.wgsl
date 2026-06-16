// Phase 32b beauty preprocess pass (zero-copy inference input).
// Samples a normalized sub-region (ROI) of the decoded VideoFrame (external
// texture) at model input resolution and writes an NHWC float32 tensor into a
// storage buffer that the ORT WebGPU detector/landmark model consumes directly
// as a GPU-buffer Tensor — no CPU readback of pixels.
//
// The ROI is in normalized full-frame coords [0,1]: the detector pass uses the
// whole frame (0,0,1,1); the landmark pass uses the primary face box. Inputs are
// `rgb * normScale + normBias`; FaceMesh-derived ONNX graphs take [0,1] RGB
// (normScale = 1, normBias = 0).

struct Uniforms {
  modelWidth: u32,
  modelHeight: u32,
  normScale: f32,
  normBias: f32,
  roiX0: f32,
  roiY0: f32,
  roiX1: f32,
  roiY1: f32,
}

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var srcFrame: texture_external;
@group(0) @binding(2) var<storage, read_write> tensorOut: array<f32>;
@group(0) @binding(3) var frameSampler: sampler;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= u.modelWidth || gid.y >= u.modelHeight) { return; }

  // Map the model-space pixel to a normalized coordinate inside the ROI, then
  // bilinearly sample the external texture (clamped to edge). Works at any source
  // resolution (P19 proxy in preview, full-res in export) with no CPU resize.
  let t = (vec2<f32>(f32(gid.x), f32(gid.y)) + 0.5)
    / vec2<f32>(f32(u.modelWidth), f32(u.modelHeight));
  let uv = vec2<f32>(
    mix(u.roiX0, u.roiX1, t.x),
    mix(u.roiY0, u.roiY1, t.y)
  );
  let rgb = textureSampleBaseClampToEdge(srcFrame, frameSampler, uv).rgb;

  // NHWC: 3 interleaved channels per pixel.
  let base = (gid.y * u.modelWidth + gid.x) * 3u;
  tensorOut[base] = rgb.r * u.normScale + u.normBias;
  tensorOut[base + 1u] = rgb.g * u.normScale + u.normBias;
  tensorOut[base + 2u] = rgb.b * u.normScale + u.normBias;
}
