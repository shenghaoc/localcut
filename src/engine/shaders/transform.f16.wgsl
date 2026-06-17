enable f16;

// f16 variant — behaviourally identical to transform.wgsl. The inverse-affine
// mapping stays in f32 (coordinate precision matters for sampling); only the
// premultiply blend math runs in f16.

struct Transform {
  m : vec4<f32>,
  params : vec4<f32>,
  card : vec4<f32>,
  // Phase 30: UV crop max for typewriter reveal. Default (1.0, 1.0) = no crop.
  cropMax : vec2<f32>,
}

@group(0) @binding(0) var<uniform> u : Transform;
@group(0) @binding(1) var srcTexture : texture_2d<f32>;
@group(0) @binding(2) var srcSampler : sampler;
@group(0) @binding(3) var dstTexture : texture_storage_2d<rgba16float, write>;

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
    // — clamping would smear the boundary text texel across the un-revealed area.
    if (l.x > u.cropMax.x || l.y > u.cropMax.y) {
      textureStore(dstTexture, coord, vec4<f32>(0.0, 0.0, 0.0, 0.0));
      return;
    }
    let c = textureSampleLevel(srcTexture, srcSampler, l, 0.0);
    let a = f16(c.a) * f16(u.params.z);
    let rgb = vec3<f16>(c.rgb) * a;
    textureStore(dstTexture, coord, vec4<f32>(vec3<f32>(rgb), f32(a)));
    return;
  }

  // Letterbox bars only within the transformed layer card; transparent elsewhere.
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
