// Phase 31 matte-apply pass (modes: remove / replace — replace is the same
// alpha math; the background source is a UI composition recipe beneath this
// layer). Samples the matte texture and multiplies the layer's alpha by the
// matte value scaled by a per-clip strength uniform. RGB passes through.
//
// `refine == 1` (export path) upgrades the plain bilinear matte sample to a
// 3x3 joint-bilateral upsample guided by full-resolution luma — recovers edge
// quality from the model-resolution alpha without full-resolution inference
// (Phase 31 resolution policy, R5.2).

struct Uniforms {
  strength: f32,  // 0..1
  refine: u32,    // 0 = bilinear (preview), 1 = guided upsample (export)
}

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var dst: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(3) var matteTex: texture_2d<f32>;
@group(0) @binding(4) var matteSampler: sampler;

fn luma(rgb: vec3<f32>) -> f32 {
  return dot(rgb, vec3<f32>(0.2126, 0.7152, 0.0722));
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let dims = textureDimensions(src);
  if (gid.x >= dims.x || gid.y >= dims.y) { return; }

  let coord = vec2<u32>(gid.x, gid.y);
  let color = textureLoad(src, coord, 0);
  let uv = (vec2<f32>(coord) + 0.5) / vec2<f32>(dims);

  var matte = textureSampleLevel(matteTex, matteSampler, uv, 0.0).r;

  if (u.refine == 1u) {
    // Joint bilateral upsample: 3x3 taps in matte-texel units, weighted by a
    // fixed spatial kernel and luma similarity against the guide (the
    // full-resolution frame). sigma_range^2 * 2 = 0.02.
    let matteDims = vec2<f32>(textureDimensions(matteTex));
    let centerLuma = luma(color.rgb);
    var totalWeight = 0.0;
    var totalMatte = 0.0;
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        let offset = vec2<f32>(f32(dx), f32(dy));
        let tapUv = uv + offset / matteDims;
        let tapMatte = textureSampleLevel(matteTex, matteSampler, tapUv, 0.0).r;
        let guideCoord = vec2<u32>(clamp(
          vec2<i32>(tapUv * vec2<f32>(dims)),
          vec2<i32>(0),
          vec2<i32>(dims) - 1
        ));
        let tapLuma = luma(textureLoad(src, guideCoord, 0).rgb);
        let spatial = exp(-0.5 * dot(offset, offset));
        let dl = centerLuma - tapLuma;
        let range = exp(-(dl * dl) / 0.02);
        let weight = spatial * range;
        totalWeight += weight;
        totalMatte += weight * tapMatte;
      }
    }
    matte = select(matte, totalMatte / totalWeight, totalWeight > 1e-5);
  }

  let strength = clamp(u.strength, 0.0, 1.0);
  let alpha = color.a * mix(1.0, matte, strength);

  textureStore(dst, coord, vec4(color.rgb, alpha));
}
