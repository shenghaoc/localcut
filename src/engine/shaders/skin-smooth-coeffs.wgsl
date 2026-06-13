// Skin-smooth pass 4: compute guided-filter coefficients (a, b) from moments.
// Phase 32a. f32-only (no f16 variant).

const SKIN_EPSILON : f32 = 0.01;

@group(0) @binding(0) var moments : texture_storage_2d<rg32float, read>;
@group(0) @binding(1) var dst : texture_storage_2d<rg32float, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let dims = textureDimensions(dst);
  if (gid.x >= dims.x || gid.y >= dims.y) {
    return;
  }
  let coord = vec2<u32>(gid.x, gid.y);
  let m = textureLoad(moments, coord);
  let meanY = m.r;
  let meanY2 = m.g;
  let variance = max(0.0, meanY2 - meanY * meanY);
  let a = variance / (variance + SKIN_EPSILON);
  let b = (1.0 - a) * meanY;
  textureStore(dst, coord, vec2<f32>(a, b));
}
