// Phase 12 composite pass. Premultiplied "over": result = over + under·(1 − over.a).
// Both inputs are premultiplied (the accumulator is cleared to opaque black and
// each layer arrives premultiplied from the transform pass), so the output stays
// premultiplied and the accumulator ping-pongs one layer at a time.

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
  let over = textureLoad(overTexture, coord, 0);
  let under = textureLoad(underTexture, coord, 0);
  let inv = 1.0 - over.a;
  textureStore(dstTexture, coord, over + under * inv);
}
