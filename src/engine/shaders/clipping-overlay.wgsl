// Clipping zebra overlay — Phase 21.
// Composites a zebra-stripe pattern over the composited frame for pixels
// detected as out-of-range in the pre-clamp accumulator. Non-clipped pixels
// pass through the composited frame unchanged.

struct Uniforms {
  width: u32,
  height: u32,
  stripePeriod: u32,   // zebra stripe period in pixels (e.g. 4)
}

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var srcFrame: texture_2d<f32>;           // composited output frame
@group(0) @binding(2) var clipSrc: texture_2d<f32>;            // pre-clamp accumulator (for clip detection)
@group(0) @binding(3) var dst: texture_storage_2d<rgba8unorm, write>;

fn isClipped(color: vec3<f32>) -> bool {
  return color.r < 0.0 || color.r > 1.0 ||
         color.g < 0.0 || color.g > 1.0 ||
         color.b < 0.0 || color.b > 1.0;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= u.width || gid.y >= u.height) { return; }

  let coord = vec2<u32>(gid.x, gid.y);
  let framePixel = textureLoad(srcFrame, coord, 0);
  let clipPixel = textureLoad(clipSrc, coord, 0);

  if (!isClipped(clipPixel.rgb)) {
    // Passthrough composited frame unchanged
    textureStore(dst, coord, framePixel);
    return;
  }

  // Zebra pattern composited on top of frame
  let stripe = ((gid.x + gid.y) / u.stripePeriod) % 2u;
  var overlay = framePixel;
  if (stripe == 0u) {
    // Blend magenta 50% over the frame
    let zebra = vec4(1.0, 0.0, 1.0, 0.5);
    let invA = 1.0 - zebra.a;
    overlay = vec4(framePixel.rgb * invA + zebra.rgb * zebra.a, 1.0);
  } else {
    // Darken
    overlay = vec4(framePixel.rgb * 0.5, 1.0);
  }
  textureStore(dst, coord, overlay);
}
