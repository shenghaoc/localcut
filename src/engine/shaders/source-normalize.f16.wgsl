// F16 variant: source → working linear normalization.
// Half-precision compute; behaviour-matched with source-normalize.wgsl.
enable f16;

struct Uniforms {
  inverseTransfer: u32,
  fullRange: u32,
}

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var dst: texture_storage_2d<rgba8unorm, write>;

fn inverseTransferSRGB(lin: vec3<f16>) -> vec3<f16> {
  var result: vec3<f16>;
  for (var i = 0u; i < 3u; i++) {
    let c = clamp(lin[i], f16(0.0), f16(1.0));
    if (c <= f16(0.04045)) {
      result[i] = c / f16(12.92);
    } else {
      result[i] = pow((c + f16(0.055)) / f16(1.055), f16(2.4));
    }
  }
  return result;
}

fn linearizeBT709(color: vec3<f16>) -> vec3<f16> {
  return inverseTransferSRGB(color);
}

fn inversePQ(pq: vec3<f16>) -> vec3<f16> {
  let m1 = f16(0.1593017578125);
  let m2 = f16(78.84375);
  let c1 = f16(0.8359375);
  let c2 = f16(18.8515625);
  let c3 = f16(18.6875);
  var result: vec3<f16>;
  for (var i = 0u; i < 3u; i++) {
    let v = max(pq[i], f16(0.0));
    let vp = pow(v, f16(1.0) / m2);
    let lin = pow(max(vp - c1, f16(0.0)) / (c2 - c3 * vp), f16(1.0) / m1);
    result[i] = lin / (f16(1.0) + lin);
  }
  return result;
}

fn inverseHLG(hlg: vec3<f16>) -> vec3<f16> {
  let a: f16 = f16(0.17883277);
  let b: f16 = f16(1.0) - f16(4.0) * a;
  let c: f16 = f16(0.5) - a * log(f16(4.0) * a);
  var result: vec3<f16>;
  for (var i = 0u; i < 3u; i++) {
    let v = max(hlg[i], f16(0.0));
    if (v <= f16(0.5)) {
      result[i] = v * v / f16(3.0);
    } else {
      result[i] = (exp((v - c) / a) + b) / f16(12.0);
    }
  }
  return result;
}

fn inverseBT2020_10(color: vec3<f16>) -> vec3<f16> {
  var result: vec3<f16>;
  for (var i = 0u; i < 3u; i++) {
    let c = color[i];
    let a: f16 = f16(1.0993);
    let b: f16 = f16(0.0181);
    if (c < b * f16(4.5)) {
      result[i] = c / f16(4.5);
    } else {
      result[i] = pow((c + a - f16(1.0)) / a, f16(1.0) / f16(0.45));
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

  if (u.fullRange == 0u) {
    color = (color - f16(16.0 / 255.0)) / f16(219.0 / 255.0);
  }

  switch (u.inverseTransfer) {
    case 1u: { color = linearizeBT709(color); }
    case 2u: { color = inverseTransferSRGB(color); }
    case 3u: { color = inversePQ(color); }
    case 4u: { color = inverseHLG(color); }
    case 5u: { color = inverseBT2020_10(color); }
    default: { }
  }

  color = clamp(color, vec3<f16>(0.0), vec3<f16>(1.0));

  let alpha = textureLoad(src, coord, 0).a;
  textureStore(dst, coord, vec4(vec3<f32>(color), alpha));
}
