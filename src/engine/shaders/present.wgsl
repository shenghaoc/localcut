// Presents the processed storage texture to the OffscreenCanvas via a fullscreen
// triangle. This is the zero-copy preview path: the pixels never leave the GPU
// (no getImageData / Canvas2D readback). A linear sampler lets the canvas scale
// the (possibly downscaled) preview texture to its display size.

@group(0) @binding(0) var srcTexture : texture_2d<f32>;
@group(0) @binding(1) var srcSampler : sampler;

struct VsOut {
  @builtin(position) position : vec4<f32>,
  @location(0) uv : vec2<f32>,
};

@vertex
fn vs(@builtin(vertex_index) idx : u32) -> VsOut {
  // Oversized triangle covering the clip volume; clipped to the viewport.
  var positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0),
  );
  // UVs with v flipped so texel (0,0) maps to the top-left of the canvas.
  var uvs = array<vec2<f32>, 3>(
    vec2<f32>(0.0, 1.0),
    vec2<f32>(2.0, 1.0),
    vec2<f32>(0.0, -1.0),
  );

  var out : VsOut;
  out.position = vec4<f32>(positions[idx], 0.0, 1.0);
  out.uv = uvs[idx];
  return out;
}

@fragment
fn fs(in : VsOut) -> @location(0) vec4<f32> {
  return textureSample(srcTexture, srcSampler, in.uv);
}
