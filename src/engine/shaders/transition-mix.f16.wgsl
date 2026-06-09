enable f16;

// Phase 13 transition-mix compute shader (f16 variant).
// Blends two premultiplied layers (outgoing + incoming) according to the active
// transition kind and mixT uniform. Intermediate arithmetic runs in f16.

struct TransitionUniforms {
    mixT: f32,
    kind: u32,
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

    let outColor = vec4<f16>(textureLoad(outgoingTexture, coord, 0));
    let inColor = vec4<f16>(textureLoad(incomingTexture, coord, 0));
    let t = f16(uniforms.mixT);

    var result: vec4<f16>;

    switch uniforms.kind {
        case 0u: {
            // cross-dissolve
            result = mix(outColor, inColor, t);
        }
        case 1u: {
            // dip-to-black
            if (t < 0.5h) {
                result = mix(outColor, vec4<f16>(0.0h), t * 2.0h);
            } else {
                result = mix(vec4<f16>(0.0h), inColor, (t - 0.5h) * 2.0h);
            }
        }
        case 2u: {
            // wipe
            let edge = uniforms.direction == 0u ? f16(uv.x) : f16(uv.y);
            let visible = select(0.0h, 1.0h, edge < t);
            result = mix(outColor, inColor, visible);
        }
        case 3u: {
            // slide
            let slideT = 1.0h - t;
            var slideInUV = uv;
            var slideOutUV = uv;
            if uniforms.direction == 0u {
                slideInUV.x = uv.x - f32(slideT);
                slideOutUV.x = uv.x + f32(t);
            } else {
                slideInUV.y = uv.y - f32(slideT);
                slideOutUV.y = uv.y + f32(t);
            }
            let inSlide = vec4<f16>(textureSampleLevel(incomingTexture, inSampler, slideInUV, 0.0));
            let outSlide = vec4<f16>(textureSampleLevel(outgoingTexture, outSampler, slideOutUV, 0.0));
            let inBounds = slideInUV.x >= 0.0 && slideInUV.x <= 1.0 && slideInUV.y >= 0.0 && slideInUV.y <= 1.0;
            let outBounds = slideOutUV.x >= 0.0 && slideOutUV.x <= 1.0 && slideOutUV.y >= 0.0 && slideOutUV.y <= 1.0;
            let inWeight = select(0.0h, 1.0h, inBounds);
            let outWeight = select(0.0h, 1.0h, outBounds);
            result = outSlide * outWeight + inSlide * inWeight * (1.0h - outWeight);
        }
        default: {
            result = mix(outColor, inColor, t);
        }
    }

    textureStore(dstTexture, coord, vec4<f32>(result));
}
