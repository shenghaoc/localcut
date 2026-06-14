// Skin-smooth passes 2, 3, 5, 6: separable 1-D box blur of rg32float textures.
// Phase 32a. f32-only (no f16 variant).

struct SkinBoxUniform {
  radius : u32,
  dirX   : u32,   // 1 for horizontal, 0 for vertical
  dirY   : u32,   // 0 for horizontal, 1 for vertical
  pad    : u32,
};

@group(0) @binding(0) var<uniform> u : SkinBoxUniform;
@group(0) @binding(1) var src : texture_2d<f32>;
@group(0) @binding(2) var dst : texture_storage_2d<rg32float, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let dims = textureDimensions(dst);
  if (gid.x >= dims.x || gid.y >= dims.y) {
    return;
  }

  let coord = vec2<i32>(i32(gid.x), i32(gid.y));
  let radius = i32(u.radius);
  let dir = vec2<i32>(i32(u.dirX), i32(u.dirY));
  let dimSize = vec2<i32>(i32(dims.x), i32(dims.y));

  var sum = vec2<f32>(0.0, 0.0);
  var count : f32 = 0.0;
  for (var k = -radius; k <= radius; k++) {
    let sampleCoord = clamp(coord + dir * k, vec2<i32>(0, 0), dimSize - vec2<i32>(1, 1));
    sum += textureLoad(src, vec2<u32>(u32(sampleCoord.x), u32(sampleCoord.y)), 0).rg;
    count += 1.0;
  }

  let avg = sum / count;
  textureStore(dst, coord, vec4<f32>(avg, 0.0, 0.0));
}
