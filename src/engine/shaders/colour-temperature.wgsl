// Colour-temperature tint. 6500 K is neutral; lower is warmer, higher is cooler.

struct Params {
  temperature : f32,
  strength : f32,
  _pad : vec2<f32>,
}

@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var srcTexture : texture_2d<f32>;
@group(0) @binding(2) var dstTexture : texture_storage_2d<rgba8unorm, write>;

const NEUTRAL_K : f32 = 6500.0;

fn temperatureTint(kelvin : f32) -> vec3<f32> {
  let k = clamp(kelvin, 2000.0, 10000.0);
  let warm = vec3<f32>(1.08, 0.96, 0.82);
  let cool = vec3<f32>(0.88, 0.96, 1.12);
  let neutral = vec3<f32>(1.0, 1.0, 1.0);
  if (k < NEUTRAL_K) {
    let t = (k - 2000.0) / (NEUTRAL_K - 2000.0);
    return mix(warm, neutral, clamp(t, 0.0, 1.0));
  }
  let t = (k - NEUTRAL_K) / (10000.0 - NEUTRAL_K);
  return mix(neutral, cool, clamp(t, 0.0, 1.0));
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
  let amount = clamp(params.strength, 0.0, 1.0);
  let weight = amount * (abs(params.temperature - NEUTRAL_K) / NEUTRAL_K);
  color = vec4<f32>(color.rgb * mix(vec3<f32>(1.0), tint, weight), color.a);
  textureStore(dstTexture, coord, color);
}
