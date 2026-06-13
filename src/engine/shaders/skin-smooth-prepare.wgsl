// Skin-smooth pass 1: prepare — compute (Y, Y²) from working-linear source.
// Phase 32a. f32-only (no f16 variant).

const LUMA_BT709 : vec3<f32> = vec3<f32>(0.2126, 0.7152, 0.0722);

@group(0) @binding(0) var src : texture_2d<f32>;
@group(0) @binding(1) var dst : texture_storage_2d<rg32float, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let dims = textureDimensions(dst);
  if (gid.x >= dims.x || gid.y >= dims.y) {
    return;
  }
  let coord = vec2<u32>(gid.x, gid.y);
  let rgba = textureLoad(src, coord, 0);
  let Y = dot(rgba.rgb, LUMA_BT709);
  textureStore(dst, coord, vec2<f32>(Y, Y * Y));
}
