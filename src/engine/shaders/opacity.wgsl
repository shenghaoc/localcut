// Opacity pass — Phase 21.
// Multiplies alpha by the per-layer opacity uniform in working linear space.

struct Uniforms {
  opacity: f32,  // 0..1
}

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var dst: texture_storage_2d<rgba8unorm, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let dims = textureDimensions(src);
  if (gid.x >= dims.x || gid.y >= dims.y) { return; }

  let coord = vec2<u32>(gid.x, gid.y);
  let color = textureLoad(src, coord, 0);
  let newAlpha = color.a * u.opacity;

  textureStore(dst, coord, vec4(color.rgb, newAlpha));
}
