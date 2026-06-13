// Phase 12 transform pass. Maps each output texel back to a layer-local sample
// coordinate via the inverse affine packed on the host (position/scale/rotation/
// anchor + fit), samples the colour-graded source, and writes a PREMULTIPLIED
// result so the composite-over pass is a straight "over". Out-of-source texels
// are transparent (fit) or opaque black (letterbox, fitFlag = 1).
//
// `u.m` holds the inverse 2x2 (m00, m01, m10, m11); `u.params` holds
// (t0, t1, opacity, fitFlag). l = M·o + t, with o the output-normalized coord.
// `u.card` holds (rectW, rectH, anchorX, anchorY): the layer "card" coordinate
// k = 0.5 + (l − anchor)·rect bounds letterbox bars to the transformed layer.

struct Transform {
  m : vec4<f32>,
  params : vec4<f32>,
  card : vec4<f32>,
  // Phase 30: UV crop max for typewriter reveal. Default (1.0, 1.0) = no crop.
  // Only U (x) is typically cropped; V (y) stays at 1.0.
  cropMax : vec2<f32>,
}

@group(0) @binding(0) var<uniform> u : Transform;
@group(0) @binding(1) var srcTexture : texture_2d<f32>;
@group(0) @binding(2) var srcSampler : sampler;
@group(0) @binding(3) var dstTexture : texture_storage_2d<rgba8unorm, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let dstSize = textureDimensions(dstTexture);
  if (gid.x >= dstSize.x || gid.y >= dstSize.y) {
    return;
  }

  let coord = vec2<i32>(gid.xy);
  let o = (vec2<f32>(gid.xy) + vec2<f32>(0.5, 0.5)) / vec2<f32>(dstSize);
  let l = vec2<f32>(
    u.m.x * o.x + u.m.y * o.y + u.params.x,
    u.m.z * o.x + u.m.w * o.y + u.params.y,
  );

  let inside = l.x >= 0.0 && l.x <= 1.0 && l.y >= 0.0 && l.y <= 1.0;
  if (inside) {
    // Phase 30: typewriter UV crop. Texels right of cropMax must be transparent
    // (the line is being "typed" in), NOT the clamped boundary sample — clamping
    // would smear the edge texel (often opaque text) across the un-revealed area.
    if (l.x > u.cropMax.x || l.y > u.cropMax.y) {
      textureStore(dstTexture, coord, vec4<f32>(0.0, 0.0, 0.0, 0.0));
      return;
    }
    let c = textureSampleLevel(srcTexture, srcSampler, l, 0.0);
    let a = c.a * u.params.z;
    textureStore(dstTexture, coord, vec4<f32>(c.rgb * a, a));
    return;
  }

  // Letterbox bars: opaque black, but only within the transformed layer card so
  // lower layers stay visible everywhere outside this layer. Anything else is
  // transparent (fit/fill, or beyond a letterbox card).
  if (u.params.w > 0.5) {
    let k = vec2<f32>(0.5, 0.5) + (l - u.card.zw) * u.card.xy;
    let inCard = k.x >= 0.0 && k.x <= 1.0 && k.y >= 0.0 && k.y <= 1.0;
    if (inCard) {
      textureStore(dstTexture, coord, vec4<f32>(0.0, 0.0, 0.0, 1.0));
      return;
    }
  }
  textureStore(dstTexture, coord, vec4<f32>(0.0, 0.0, 0.0, 0.0));
}
