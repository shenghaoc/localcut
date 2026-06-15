// Phase 37 frame-interpolation preprocess pass (zero-copy ORT input).
//
// Samples a tile region (core + halo) of TWO decoded VideoFrames (external
// textures) at the model's input resolution and writes two normalized float32
// tensors into storage buffers that ORT consumes directly as GPU-buffer input
// tensors (`ort.Tensor.fromGpuBuffer`). The buffer layout matches the ONNX
// model: NCHW (planar, layout=0 — RIFE/FILM convention) or NHWC (interleaved,
// layout=1), declared in the manifest `io.layout`.
//
// The tile's source region is in normalized [0,1] source coordinates (srcUV0..1,
// halo included), so arbitrary source resolutions resize with bilinear filtering
// on the GPU — no CPU resize, no readback. Normalization is `rgb * normScale +
// normBias` (unit [0,1] for RIFE/FILM).

struct Uniforms {
  modelWidth : u32,
  modelHeight : u32,
  layout : u32, // 0 = NCHW (planar), 1 = NHWC (interleaved)
  _pad0 : u32,
  normScale : f32,
  normBias : f32,
  srcU0 : f32,
  srcV0 : f32,
  srcU1 : f32,
  srcV1 : f32,
}

@group(0) @binding(0) var<uniform> u : Uniforms;
@group(0) @binding(1) var frame0 : texture_external;
@group(0) @binding(2) var frame1 : texture_external;
@group(0) @binding(3) var<storage, read_write> tensor0 : array<f32>;
@group(0) @binding(4) var<storage, read_write> tensor1 : array<f32>;
@group(0) @binding(5) var frameSampler : sampler;

fn writeChannels(buf : ptr<storage, array<f32>, read_write>, x : u32, y : u32, rgb : vec3<f32>) {
  let v = rgb * u.normScale + u.normBias;
  if (u.layout == 0u) {
    // NCHW planar: channel c plane at offset c * (W*H).
    let plane = u.modelWidth * u.modelHeight;
    let idx = y * u.modelWidth + x;
    (*buf)[idx] = v.r;
    (*buf)[plane + idx] = v.g;
    (*buf)[2u * plane + idx] = v.b;
  } else {
    // NHWC interleaved: 3 channels per pixel.
    let base = (y * u.modelWidth + x) * 3u;
    (*buf)[base] = v.r;
    (*buf)[base + 1u] = v.g;
    (*buf)[base + 2u] = v.b;
  }
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  if (gid.x >= u.modelWidth || gid.y >= u.modelHeight) {
    return;
  }

  // Map the model-input pixel to a point inside the tile's source region.
  let fx = (f32(gid.x) + 0.5) / f32(u.modelWidth);
  let fy = (f32(gid.y) + 0.5) / f32(u.modelHeight);
  let uv = vec2<f32>(mix(u.srcU0, u.srcU1, fx), mix(u.srcV0, u.srcV1, fy));

  // importExternalTexture requires textureSampleBaseClampToEdge (bilinear).
  let rgb0 = textureSampleBaseClampToEdge(frame0, frameSampler, uv).rgb;
  let rgb1 = textureSampleBaseClampToEdge(frame1, frameSampler, uv).rgb;

  writeChannels(&tensor0, gid.x, gid.y, rgb0);
  writeChannels(&tensor1, gid.x, gid.y, rgb1);
}
