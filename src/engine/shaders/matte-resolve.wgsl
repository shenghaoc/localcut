// Phase 31 matte resolve pass.
// Reads the raw alpha tensor produced by the inference session (NCHW [1,1,H,W]
// float32 GPU buffer — never read back to the CPU) and writes the temporally
// smoothed alpha into the per-clip history texture (r8unorm).
//
// Temporal stability (recurrent surrogate for single-frame models like MODNet):
//   alpha_t = mix(alpha_raw, alpha_{t-1}, k)
// `reset` is 1 on discontinuities (seek, clip boundary, toggle, model swap) per
// the R4.2 policy, in which case the raw alpha passes through and history
// restarts.

struct Uniforms {
  modelWidth: u32,
  modelHeight: u32,
  // EMA history weight k in [0,1); fixed in test mode for determinism.
  smoothing: f32,
  // 1 = discontinuity: ignore history this frame.
  reset: u32,
}

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> alphaTensor: array<f32>;
@group(0) @binding(2) var history: texture_2d<f32>;
@group(0) @binding(3) var dst: texture_storage_2d<r8unorm, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= u.modelWidth || gid.y >= u.modelHeight) { return; }

  let raw = clamp(alphaTensor[gid.y * u.modelWidth + gid.x], 0.0, 1.0);
  let prev = textureLoad(history, vec2<u32>(gid.x, gid.y), 0).r;
  let k = select(clamp(u.smoothing, 0.0, 0.95), 0.0, u.reset == 1u);
  let smoothed = mix(raw, prev, k);

  textureStore(dst, vec2<u32>(gid.x, gid.y), vec4(smoothed, 0.0, 0.0, 1.0));
}
