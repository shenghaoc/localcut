// Saturation adjustment via luminance mix.

struct Params {
  saturation : f32,
  _pad : vec3<f32>,
}

@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var srcTexture : texture_2d<f32>;
@group(0) @binding(2) var dstTexture : texture_storage_2d<rgba8unorm, write>;

const LUMA : vec3<f32> = vec3<f32>(0.2126, 0.7152, 0.0722);

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let size = textureDimensions(srcTexture);
  if (gid.x >= size.x || gid.y >= size.y) {
    return;
  }

  let coord = vec2<i32>(gid.xy);
  var color = textureLoad(srcTexture, coord, 0);
  let luma = dot(color.rgb, LUMA);
  color = vec4<f32>(mix(vec3<f32>(luma), color.rgb, params.saturation), color.a);
  textureStore(dstTexture, coord, color);
}
