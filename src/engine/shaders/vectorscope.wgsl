// Vectorscope compute shader — Phase 21.
//
// Accumulates Cb/Cr hit counts into an atomic storage buffer (flat 2D array)
// because WebGPU storage textures do not support atomic operations.
// Dispatched after the combined scopes pass, reading from the same source.

struct Uniforms {
  inputWidth: u32,
  inputHeight: u32,
  vecSize: u32,       // vectorscope output size (e.g. 128)
}

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var<storage, read_write> hits: array<atomic<u32>>;

fn rgbToLuma(rgb: vec3<f32>) -> f32 {
  return 0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b;
}

fn rgbToCbCr(rgb: vec3<f32>) -> vec2<f32> {
  // BT.709 Y'CbCr coefficients
  let y = rgbToLuma(rgb);
  let cb = (rgb.b - y) / 1.8556 + 0.5;
  let cr = (rgb.r - y) / 1.5748 + 0.5;
  return vec2(cb, cr);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let dims = textureDimensions(src);
  if (gid.x >= dims.x || gid.y >= dims.y) { return; }

  let coord = vec2<u32>(gid.x, gid.y);
  let color = textureLoad(src, coord, 0).rgb;

  let cbcr = rgbToCbCr(color);
  let vecX = u32(clamp(cbcr.x, 0.0, 0.9999) * f32(u.vecSize));
  let vecY = u32(clamp(cbcr.y, 0.0, 0.9999) * f32(u.vecSize));
  let idx = vecY * u.vecSize + vecX;

  atomicAdd(&hits[idx], 1u);
}
