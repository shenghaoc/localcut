// F16 variant: working linear → sRGB output conversion.
enable f16;

struct Uniforms {
  transferOut: u32,
  encodeFullRange: u32,
}

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var dst: texture_storage_2d<rgba8unorm, write>;

fn encodeSRGB(linear: vec3<f16>) -> vec3<f16> {
  var result: vec3<f16>;
  for (var i = 0u; i < 3u; i++) {
    let c = linear[i];
    if (c <= f16(0.0031308)) {
      result[i] = f16(12.92) * c;
    } else {
      result[i] = f16(1.055) * pow(c, f16(1.0 / 2.4)) - f16(0.055);
    }
  }
  return result;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let dims = textureDimensions(src);
  if (gid.x >= dims.x || gid.y >= dims.y) { return; }

  let coord = vec2<u32>(gid.x, gid.y);
  var color = vec3<f16>(textureLoad(src, coord, 0).rgb);

  switch (u.transferOut) {
    default: { color = encodeSRGB(color); }
  }

  if (u.encodeFullRange == 0u) {
    color = color * f16(219.0 / 255.0) + f16(16.0 / 255.0);
  }

  color = clamp(color, vec3<f16>(0.0), vec3<f16>(1.0));

  let alpha = textureLoad(src, coord, 0).a;
  textureStore(dst, coord, vec4(vec3<f32>(color), alpha));
}
