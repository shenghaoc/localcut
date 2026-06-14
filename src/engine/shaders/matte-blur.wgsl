// Phase 31 matte-blur pass (mode: blur).
// Mask-driven background blur: where the matte says background (low alpha),
// the pixel is replaced by a gaussian-weighted neighbourhood average; the
// subject (high alpha) stays sharp. Layer alpha is unchanged — the clip stays
// opaque, only the background is defocused.

struct Uniforms {
  strength: f32,   // 0..1 — how strongly the matte drives the effect
  radius: f32,     // background blur radius in px at compositor resolution
}

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var dst: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(3) var matteTex: texture_2d<f32>;
@group(0) @binding(4) var matteSampler: sampler;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let dims = textureDimensions(src);
  if (gid.x >= dims.x || gid.y >= dims.y) { return; }

  let coord = vec2<u32>(gid.x, gid.y);
  let color = textureLoad(src, coord, 0);
  let uv = (vec2<f32>(coord) + 0.5) / vec2<f32>(dims);
  let matte = textureSampleLevel(matteTex, matteSampler, uv, 0.0).r;

  // Background weight: 1 where the subject is absent.
  let bg = (1.0 - matte) * clamp(u.strength, 0.0, 1.0);
  let radius = clamp(u.radius, 0.0, 64.0);

  if (bg < 0.001 || radius < 0.5) {
    textureStore(dst, coord, color);
    return;
  }

  // 5x5 gaussian taps spaced by radius/2 — a cheap disc approximation that
  // stays a single pass inside the per-frame submission.
  let step = max(1.0, radius * 0.5);
  var total = vec3<f32>(0.0);
  var weightSum = 0.0;
  for (var dy = -2; dy <= 2; dy++) {
    for (var dx = -2; dx <= 2; dx++) {
      let offset = vec2<f32>(f32(dx), f32(dy)) * step;
      let tap = vec2<i32>(vec2<f32>(coord) + offset);
      let clamped = vec2<u32>(clamp(tap, vec2<i32>(0), vec2<i32>(dims) - 1));
      let w = exp(-0.5 * dot(offset / max(radius, 1.0), offset / max(radius, 1.0)) * 4.0);
      total += textureLoad(src, clamped, 0).rgb * w;
      weightSum += w;
    }
  }
  let blurred = total / weightSum;

  textureStore(dst, coord, vec4(mix(color.rgb, blurred, bg), color.a));
}
