enable f16;

// f16 variant — behaviourally identical to lut-apply.wgsl.

struct Params {
  strength : f32,
  _pad0 : f32,
  _pad1 : f32,
  _pad2 : f32,
  domainMin : vec3<f32>,
  _pad3 : f32,
  domainMax : vec3<f32>,
  _pad4 : f32,
}

@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var srcTexture : texture_2d<f32>;
@group(0) @binding(2) var dstTexture : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(3) var lutTexture : texture_3d<f32>;
@group(0) @binding(4) var lutSampler : sampler;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let size = textureDimensions(srcTexture);
  if (gid.x >= size.x || gid.y >= size.y) {
    return;
  }

  let coord = vec2<i32>(gid.xy);
  let color = textureLoad(srcTexture, coord, 0);
  let domainSpan = max(params.domainMax - params.domainMin, vec3<f32>(0.000001));
  let lutUv = clamp((color.rgb - params.domainMin) / domainSpan, vec3<f32>(0.0), vec3<f32>(1.0));
  let sampled = textureSampleLevel(lutTexture, lutSampler, lutUv, 0.0);
  let rgb = vec3<f16>(color.rgb);
  let lutRgb = vec3<f16>(sampled.rgb);
  let strength = f16(clamp(params.strength, 0.0, 1.0));
  textureStore(dstTexture, coord, vec4<f32>(vec3<f32>(mix(rgb, lutRgb, vec3<f16>(strength))), color.a));
}
