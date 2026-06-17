enable f16;

// f16 variant — behaviourally identical to colour-temperature.wgsl.

struct Params {
  temperature : f32,
  strength : f32,
  _pad : vec2<f32>,
}

@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var srcTexture : texture_2d<f32>;
@group(0) @binding(2) var dstTexture : texture_storage_2d<rgba16float, write>;

const NEUTRAL_K : f32 = 6500.0;

fn temperatureTint(kelvin : f32) -> vec3<f16> {
  let k = clamp(kelvin, 2000.0, 10000.0);
  let warm = vec3<f16>(1.08h, 0.96h, 0.82h);
  let cool = vec3<f16>(0.88h, 0.96h, 1.12h);
  let neutral = vec3<f16>(1.0h, 1.0h, 1.0h);
  if (k < NEUTRAL_K) {
    let t = (k - 2000.0) / (NEUTRAL_K - 2000.0);
    return mix(warm, neutral, clamp(f16(t), f16(0.0), f16(1.0)));
  }
  let t = (k - NEUTRAL_K) / (10000.0 - NEUTRAL_K);
  return mix(neutral, cool, clamp(f16(t), f16(0.0), f16(1.0)));
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let size = textureDimensions(srcTexture);
  if (gid.x >= size.x || gid.y >= size.y) {
    return;
  }

  let coord = vec2<i32>(gid.xy);
  var color = textureLoad(srcTexture, coord, 0);
  let tint = temperatureTint(params.temperature);
  let amount = clamp(f16(params.strength), f16(0.0), f16(1.0));
  let weight = amount * f16(abs(params.temperature - NEUTRAL_K) / NEUTRAL_K);
  let rgb = vec3<f16>(color.rgb);
  let one = vec3<f16>(1.0);
  let mixed = rgb * mix(one, tint, vec3<f16>(weight));
  color = vec4<f32>(vec3<f32>(mixed), color.a);
  textureStore(dstTexture, coord, color);
}
