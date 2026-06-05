// Phase 2 passthrough: sample the decoder's external texture and write it into a
// storage texture. This establishes the compute + ping-pong-storage path that the
// Phase 4 effect chain will extend — the effect chain is a sequence of compute
// passes over storage textures inside a single command submission.
//
// The external texture is imported fresh every frame (valid only for the current
// submission), so the bind group referencing it is rebuilt per frame on the host.

@group(0) @binding(0) var srcTexture : texture_external;
@group(0) @binding(1) var dstTexture : texture_storage_2d<rgba8unorm, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let dstSize = textureDimensions(dstTexture);
  if (gid.x >= dstSize.x || gid.y >= dstSize.y) {
    return;
  }

  // Map the destination texel to a source pixel. When the preview is downscaled
  // (adaptive resolution) the source is larger than the destination, so we sample
  // a nearest source pixel. textureLoad is used (not textureSample) because
  // external-texture sampling with a sampler is fragment-only in WGSL.
  let srcSize = textureDimensions(srcTexture);
  let uv = (vec2<f32>(gid.xy) + vec2<f32>(0.5, 0.5)) / vec2<f32>(dstSize);
  let srcCoord = vec2<u32>(uv * vec2<f32>(srcSize));
  let clamped = min(srcCoord, srcSize - vec2<u32>(1u, 1u));

  let color = textureLoad(srcTexture, vec2<i32>(clamped));
  textureStore(dstTexture, gid.xy, color);
}
