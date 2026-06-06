// Working linear → sRGB output conversion — Phase 21.
// Final stage: applies sRGB OETF for display/export output after compositing.

struct Uniforms {
  transferOut: u32,       // 0=sRGB OETF, 1=PQ (future), 2=HLG (future)
  encodeFullRange: u32,   // 0=limited (16-235), 1=full (0-255)
}

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var dst: texture_storage_2d<rgba8unorm, write>;

fn encodeSRGB(linear: vec3<f32>) -> vec3<f32> {
  // sRGB OETF: linear RGB → sRGB non-linear.
  // Clamp to [0, 1] before pow() to prevent NaN from negative inputs.
  var result: vec3<f32>;
  for (var i = 0u; i < 3u; i++) {
    let c = clamp(linear[i], 0.0, 1.0);
    if (c <= 0.0031308) {
      result[i] = 12.92 * c;
    } else {
      result[i] = 1.055 * pow(c, 1.0 / 2.4) - 0.055;
    }
  }
  return result;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let dims = textureDimensions(src);
  if (gid.x >= dims.x || gid.y >= dims.y) { return; }

  let coord = vec2<u32>(gid.x, gid.y);
  var color = textureLoad(src, coord, 0).rgb;

  // Output transfer (currently only sRGB)
  switch (u.transferOut) {
    default: { color = encodeSRGB(color); }
  }

  // Limited range encoding: 0-1 → 16-235
  if (u.encodeFullRange == 0u) {
    color = color * (219.0 / 255.0) + (16.0 / 255.0);
  }

  color = clamp(color, vec3(0.0), vec3(1.0));

  let alpha = textureLoad(src, coord, 0).a;
  textureStore(dst, coord, vec4(color, alpha));
}
