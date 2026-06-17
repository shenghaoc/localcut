enable f16;

// f16 variant — behaviourally identical to brightness-contrast.wgsl.

struct Params {
  brightness : f32,
  contrast : f32,
  _pad : vec2<f32>,
}

@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var srcTexture : texture_2d<f32>;
@group(0) @binding(2) var dstTexture : texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let size = textureDimensions(srcTexture);
  if (gid.x >= size.x || gid.y >= size.y) {
    return;
  }

  let coord = vec2<i32>(gid.xy);
  var color = textureLoad(srcTexture, coord, 0);
  let brightness = f16(params.brightness);
  let contrast = f16(params.contrast);
  let half = f16(0.5);
  let rgb = vec3<f16>(color.rgb);
  let adjusted = (rgb - vec3<f16>(half)) * vec3<f16>(contrast) + vec3<f16>(half) + vec3<f16>(brightness);
  color = vec4<f32>(vec3<f32>(adjusted), color.a);
  textureStore(dstTexture, coord, color);
}
