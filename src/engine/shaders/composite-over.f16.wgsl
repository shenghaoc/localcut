enable f16;

// f16 variant — behaviourally identical to composite-over.wgsl. Premultiplied
// "over" blend evaluated in f16.

@group(0) @binding(0) var underTexture : texture_2d<f32>;
@group(0) @binding(1) var overTexture : texture_2d<f32>;
@group(0) @binding(2) var dstTexture : texture_storage_2d<rgba8unorm, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let size = textureDimensions(dstTexture);
  if (gid.x >= size.x || gid.y >= size.y) {
    return;
  }

  let coord = vec2<i32>(gid.xy);
  let over = vec4<f16>(textureLoad(overTexture, coord, 0));
  let under = vec4<f16>(textureLoad(underTexture, coord, 0));
  let inv = 1.0h - over.a;
  textureStore(dstTexture, coord, vec4<f32>(over + under * inv));
}
