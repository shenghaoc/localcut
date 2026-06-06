// Phase 12 accumulator clear. Resets the composite accumulator to opaque black
// once per frame before any layer composites over it, so an empty stack reads
// black and the final frame stays opaque for export.

@group(0) @binding(0) var dstTexture : texture_storage_2d<rgba8unorm, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let size = textureDimensions(dstTexture);
  if (gid.x >= size.x || gid.y >= size.y) {
    return;
  }
  textureStore(dstTexture, vec2<i32>(gid.xy), vec4<f32>(0.0, 0.0, 0.0, 1.0));
}
