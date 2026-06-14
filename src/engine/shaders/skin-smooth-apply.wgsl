// Skin-smooth pass 7: apply — compose smoothed luma with chroma mask and strength.
// Phase 32a. f32-only (no f16 variant).

struct SkinApplyUniform {
  strength : f32,
  cbMin    : f32,
  cbMax    : f32,
  crMin    : f32,
  crMax    : f32,
  softness : f32,
  pad0     : f32,
  pad1     : f32,
};

const LUMA_BT709 : vec3<f32> = vec3<f32>(0.2126, 0.7152, 0.0722);
const LUMA_BT601 : vec3<f32> = vec3<f32>(0.299, 0.587, 0.114);
const CB_SCALE : f32 = 0.564;
const CR_SCALE : f32 = 0.713;

@group(0) @binding(0) var<uniform> u : SkinApplyUniform;
@group(0) @binding(1) var src : texture_2d<f32>;
@group(0) @binding(2) var meanCoeffs : texture_2d<f32>;
@group(0) @binding(3) var dst : texture_storage_2d<rgba8unorm, write>;

// sRGB OETF: linear → gamma-encoded (per-channel).
fn linear_to_srgb(l : f32) -> f32 {
  if (l <= 0.0031308) {
    return 12.92 * l;
  }
  return 1.055 * pow(l, 1.0 / 2.4) - 0.055;
}

// Hermite smoothstep: 3t² − 2t³, clamped to [0,1].
fn sstep(edge0 : f32, edge1 : f32, x : f32) -> f32 {
  let d = edge1 - edge0;
  if (d == 0.0) {
    return select(0.0, 1.0, x >= edge1);
  }
  let t = clamp((x - edge0) / d, 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

// Soft band-pass: full weight inside [lo, hi], smooth falloff of width s outside.
fn band(v : f32, lo : f32, hi : f32, s : f32) -> f32 {
  return sstep(lo - s, lo, v) * (1.0 - sstep(hi, hi + s, v));
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let dims = textureDimensions(src);
  if (gid.x >= dims.x || gid.y >= dims.y) {
    return;
  }
  let coord = vec2<u32>(gid.x, gid.y);
  let rgba = textureLoad(src, coord, 0);
  let rgb = rgba.rgb;
  let alpha = rgba.a;

  // Guided-filter output luma
  let Y = dot(rgb, LUMA_BT709);
  let ab = textureLoad(meanCoeffs, coord, 0);
  let Yprime = ab.r * Y + ab.g;

  // Chroma mask — gamma-encode first, then compute Cb/Cr
  let rgbG = vec3<f32>(linear_to_srgb(rgb.r), linear_to_srgb(rgb.g), linear_to_srgb(rgb.b));
  let Y601 = dot(rgbG, LUMA_BT601);
  let Cb = (rgbG.b - Y601) * CB_SCALE;
  let Cr = (rgbG.r - Y601) * CR_SCALE;
  let m = band(Cb, u.cbMin, u.cbMax, u.softness)
        * band(Cr, u.crMin, u.crMax, u.softness);

  let outRgb = clamp(rgb + vec3<f32>(u.strength * m * (Yprime - Y)), vec3<f32>(0.0), vec3<f32>(1.0));
  textureStore(dst, coord, vec4<f32>(outRgb, alpha));
}
