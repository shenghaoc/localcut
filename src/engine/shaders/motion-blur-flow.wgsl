// Phase 37: Motion blur synthesis from optical flow.
// Takes the flow field output from the interpolation model and applies
// directional blur to the synthesised frame based on flow magnitude/direction.
//
// **Stub:** the actual flow-directed blur depends on T3 (frame synthesis
// pipeline producing the flow field). This shader defines the binding layout.

struct Params {
  // Output frame dimensions.
  size : vec2<u32>,
  // Blur strength multiplier (0 = off, 1 = normal).
  strength : f32,
  // Maximum blur kernel radius (in pixels).
  maxRadius : u32,
}

@group(0) @binding(0) var<uniform> params : Params;
// Synthesised frame (from interpolation).
@group(0) @binding(1) var srcFrame : texture_2d<f32>;
// Optical flow field (2 channels: dx, dy per pixel, rgba16float).
@group(0) @binding(2) var flowField : texture_2d<f32>;
// Output frame with motion blur applied (rgba16float to match pipeline precision).
@group(0) @binding(3) var dstTexture : texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  if (gid.x >= params.size.x || gid.y >= params.size.y) {
    return;
  }

  let coord = vec2<i32>(i32(gid.x), i32(gid.y));

  // Read flow vector for this pixel.
  let flow = textureLoad(flowField, coord, 0);
  let dx = flow.r * params.strength;
  let dy = flow.g * params.strength;
  let magnitude = sqrt(dx * dx + dy * dy);

  // If flow is negligible, pass through.
  if (magnitude < 0.5) {
    let color = textureLoad(srcFrame, coord, 0);
    textureStore(dstTexture, coord, color);
    return;
  }

  // Sample along the flow direction for directional blur.
  let radius = min(u32(magnitude), params.maxRadius);
  var sum = vec4<f32>(0.0, 0.0, 0.0, 0.0);
  var weightSum = 0.0;

  for (var i = -i32(radius); i <= i32(radius); i++) {
    let t = f32(i) / max(f32(radius), 1.0);
    let sampleCoord = vec2<i32>(
      i32(clamp(f32(coord.x) + dx * t, 0.0, f32(params.size.x - 1))),
      i32(clamp(f32(coord.y) + dy * t, 0.0, f32(params.size.y - 1)))
    );
    let w = 1.0 - abs(t);
    sum += textureLoad(srcFrame, sampleCoord, 0) * w;
    weightSum += w;
  }

  textureStore(dstTexture, coord, sum / max(weightSum, 0.001));
}
