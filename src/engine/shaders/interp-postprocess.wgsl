// Phase 37 frame-interpolation postprocess pass (zero-copy ORT output).
//
// Reads the model's synthesized-frame output straight from ORT's `gpu-buffer`
// output tensor (no readback) and writes the tile's CORE region (halo excluded)
// into the full-resolution output texture, denormalizing `value * outScale +
// outBias`. The output buffer layout matches the manifest `io.layout`: NCHW
// (planar, layout=0) or NHWC (interleaved, layout=1). One dispatch per tile;
// `destX/destY` place the core region so tiles stitch seam-free.

struct Uniforms {
  modelWidth : u32,
  modelHeight : u32,
  layout : u32, // 0 = NCHW, 1 = NHWC
  _pad0 : u32,
  outScale : f32,
  outBias : f32,
  destX : u32,
  destY : u32,
  destWidth : u32,
  destHeight : u32,
  coreU0 : f32,
  coreV0 : f32,
  coreU1 : f32,
  coreV1 : f32,
}

@group(0) @binding(0) var<uniform> u : Uniforms;
@group(0) @binding(1) var<storage, read> modelOut : array<f32>;
@group(0) @binding(2) var outTex : texture_storage_2d<rgba8unorm, write>;

fn readChannels(mx : u32, my : u32) -> vec3<f32> {
  if (u.layout == 0u) {
    let plane = u.modelWidth * u.modelHeight;
    let idx = my * u.modelWidth + mx;
    return vec3<f32>(modelOut[idx], modelOut[plane + idx], modelOut[2u * plane + idx]);
  }
  let base = (my * u.modelWidth + mx) * 3u;
  return vec3<f32>(modelOut[base], modelOut[base + 1u], modelOut[base + 2u]);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  if (gid.x >= u.destWidth || gid.y >= u.destHeight) {
    return;
  }

  // Map the destination core pixel into the model-output core region.
  let fx = (f32(gid.x) + 0.5) / f32(u.destWidth);
  let fy = (f32(gid.y) + 0.5) / f32(u.destHeight);
  let mu = mix(u.coreU0, u.coreU1, fx);
  let mv = mix(u.coreV0, u.coreV1, fy);
  let mx = min(u32(mu * f32(u.modelWidth)), u.modelWidth - 1u);
  let my = min(u32(mv * f32(u.modelHeight)), u.modelHeight - 1u);

  let rgb = readChannels(mx, my);
  let outRgb = clamp(rgb * u.outScale + u.outBias, vec3<f32>(0.0), vec3<f32>(1.0));
  textureStore(outTex, vec2<i32>(i32(u.destX + gid.x), i32(u.destY + gid.y)), vec4<f32>(outRgb, 1.0));
}
