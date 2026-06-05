// Per-pixel brightness and contrast adjustment. Reads/writes rgba8unorm storage textures.

struct Params {
  brightness : f32,
  contrast : f32,
  _pad : vec2<f32>,
}

@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var srcTexture : texture_2d<f32>;
@group(0) @binding(2) var dstTexture : texture_storage_2d<rgba8unorm, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let size = textureDimensions(srcTexture);
  if (gid.x >= size.x || gid.y >= size.y) {
    return;
  }

  let coord = vec2<i32>(gid.xy);
  var color = textureLoad(srcTexture, coord, 0);
  color = vec4<f32>((color.rgb - 0.5) * params.contrast + 0.5 + params.brightness, color.a);
  textureStore(dstTexture, coord, color);
}
