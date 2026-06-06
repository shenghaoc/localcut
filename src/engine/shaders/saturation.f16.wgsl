enable f16;

// f16 variant — behaviourally identical to saturation.wgsl.

struct Params {
  saturation : f32,
  _pad0 : f32,
  _pad1 : f32,
  _pad2 : f32,
}

@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var srcTexture : texture_2d<f32>;
@group(0) @binding(2) var dstTexture : texture_storage_2d<rgba8unorm, write>;

const LUMA : vec3<f16> = vec3<f16>(0.2126h, 0.7152h, 0.0722h);

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let size = textureDimensions(srcTexture);
  if (gid.x >= size.x || gid.y >= size.y) {
    return;
  }

  let coord = vec2<i32>(gid.xy);
  var color = textureLoad(srcTexture, coord, 0);
  let saturation = f16(params.saturation);
  let rgb = vec3<f16>(color.rgb);
  let luma = dot(rgb, LUMA);
  let mixed = mix(vec3<f16>(luma), rgb, vec3<f16>(saturation));
  color = vec4<f32>(vec3<f32>(mixed), color.a);
  textureStore(dstTexture, coord, color);
}
