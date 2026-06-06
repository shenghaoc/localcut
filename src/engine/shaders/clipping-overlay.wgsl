// Clipping zebra overlay — Phase 21.
// Produces a zebra-stripe pattern for pixels outside [0, 1] in linear working space.
// Toggleable — only dispatched when the user enables the zebra overlay.

struct Uniforms {
  width: u32,
  height: u32,
  stripePeriod: u32,   // zebra stripe period in pixels (e.g. 4)
}

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var dst: texture_storage_2d<rgba8unorm, write>;

fn isClipped(color: vec3<f32>) -> bool {
  return color.r < 0.0 || color.r > 1.0 ||
         color.g < 0.0 || color.g > 1.0 ||
         color.b < 0.0 || color.b > 1.0;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= u.width || gid.y >= u.height) { return; }

  let coord = vec2<u32>(gid.x, gid.y);
  let color = textureLoad(src, coord, 0).rgb;

  if (!isClipped(color)) {
    textureStore(dst, coord, vec4(0.0, 0.0, 0.0, 0.0));  // transparent
    return;
  }

  // Zebra pattern: alternating stripes
  let stripe = ((gid.x + gid.y) / u.stripePeriod) % 2u;
  if (stripe == 0u) {
    textureStore(dst, coord, vec4(1.0, 0.0, 1.0, 0.5));  // magenta, semi-transparent
  } else {
    textureStore(dst, coord, vec4(0.0, 0.0, 0.0, 0.3));  // dark, semi-transparent
  }
}
