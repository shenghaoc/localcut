// Phase 13 transition-mix compute shader.
// Blends two premultiplied layers (outgoing + incoming) according to the active
// transition kind and mixT uniform.  Replaces the regular over-blend for the
// transition pair, keeping the composite inside one submission per frame.

struct TransitionUniforms {
    mixT: f32,
    kind: u32,  // 0 = cross-dissolve, 1 = dip-to-black, 2 = wipe, 3 = slide
    // direction: 0 = left, 1 = right, 2 = up, 3 = down (for wipe + slide)
    direction: u32,
}

@group(0) @binding(0) var<uniform> uniforms : TransitionUniforms;
@group(0) @binding(1) var outgoingTexture : texture_2d<f32>;
@group(0) @binding(2) var incomingTexture : texture_2d<f32>;
@group(0) @binding(3) var outSampler : sampler;
@group(0) @binding(4) var inSampler : sampler;
@group(0) @binding(5) var dstTexture : texture_storage_2d<rgba8unorm, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
    let size = textureDimensions(dstTexture);
    if (gid.x >= size.x || gid.y >= size.y) {
        return;
    }

    let coord = vec2<i32>(gid.xy);
    let uv = (vec2<f32>(gid.xy) + vec2<f32>(0.5)) / vec2<f32>(size);

    let outColor = textureLoad(outgoingTexture, coord, 0);
    let inColor = textureLoad(incomingTexture, coord, 0);
    let t = uniforms.mixT;

    var result: vec4<f32>;

    switch uniforms.kind {
        case 0u: {
            // cross-dissolve: simple lerp between outgoing and incoming
            result = mix(outColor, inColor, t);
        }
        case 1u: {
            // dip-to-black: lerp to black first, then from black to incoming
            if (t < 0.5) {
                result = mix(outColor, vec4<f32>(0.0), t * 2.0);
            } else {
                result = mix(vec4<f32>(0.0), inColor, (t - 0.5) * 2.0);
            }
        }
        case 2u: {
            // wipe: hard edge sweeping across the frame
            // 0=left, 1=right, 2=up, 3=down
            let isHorizontal = uniforms.direction <= 1u;
            let edge = isHorizontal ? uv.x : uv.y;
            let flip = uniforms.direction == 1u || uniforms.direction == 3u;
            let visible = select(
                select(0.0, 1.0, edge < t),
                select(0.0, 1.0, edge > 1.0 - t),
                flip
            );
            result = mix(outColor, inColor, visible);
        }
        case 3u: {
            // slide: incoming slides in while outgoing slides out
            // 0=left (incoming from left), 1=right, 2=up, 3=down
            let isHorizontal = uniforms.direction <= 1u;
            let slideT = 1.0 - t;
            var slideInUV = uv;
            var slideOutUV = uv;
            let signVal = (uniforms.direction == 1u || uniforms.direction == 3u) ? -1.0 : 1.0;
            if isHorizontal {
                slideInUV.x = uv.x + signVal * slideT;
                slideOutUV.x = uv.x + signVal * t * -1.0;
            } else {
                slideInUV.y = uv.y + signVal * slideT;
                slideOutUV.y = uv.y + signVal * t * -1.0;
            }
            let inSlide = textureSampleLevel(incomingTexture, inSampler, slideInUV, 0.0);
            let outSlide = textureSampleLevel(outgoingTexture, outSampler, slideOutUV, 0.0);
            let inBounds = select(0.0, 1.0, slideInUV.x >= 0.0 && slideInUV.x <= 1.0 && slideInUV.y >= 0.0 && slideInUV.y <= 1.0);
            let outBounds = select(0.0, 1.0, slideOutUV.x >= 0.0 && slideOutUV.x <= 1.0 && slideOutUV.y >= 0.0 && slideOutUV.y <= 1.0);
            result = outSlide * outBounds + inSlide * inBounds * (1.0 - outBounds);
        }
        default: {
            result = mix(outColor, inColor, t);
        }
    }

    textureStore(dstTexture, coord, result);
}
