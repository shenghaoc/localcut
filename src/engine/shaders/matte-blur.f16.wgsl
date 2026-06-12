// F16 variant: Phase 31 matte-blur pass. Behaviour-matched to the f32 variant;
// gaussian weights stay f32, the final mix narrows to f16.
enable f16;

struct Uniforms {
  strength: f32,   // 0..1
  radius: f32,     // px at compositor resolution
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

  let bg = f16((1.0 - matte) * clamp(u.strength, 0.0, 1.0));
  let radius = clamp(u.radius, 0.0, 64.0);

  if (bg < f16(0.001) || radius < 0.5) {
    textureStore(dst, coord, color);
    return;
  }

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
  let blurred = vec3<f16>(total / weightSum);

  textureStore(dst, coord, vec4(vec3<f32>(mix(vec3<f16>(color.rgb), blurred, bg)), color.a));
}
